import type { FetchLike } from "./http.ts";

const ALG = "ES256";
const TYP = "at+jwt";
const MAX_TOKEN_CHARS = 8192;
const JWKS_BODY_MAX_BYTES = 1_000_000;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 10;
const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_REFETCH_COOLDOWN_SECONDS = 10;
const FETCH_TIMEOUT_MS = 5000;

/** Why {@link verifyAccessToken} refused a token. `jwks_unavailable` is the only one that is not the token's fault. */
export type AccessTokenErrorReason =
  | "malformed"
  | "algorithm"
  | "type"
  | "unknown_key"
  | "signature"
  | "issuer"
  | "audience"
  | "expired"
  | "not_yet_valid"
  | "claims"
  | "jwks_unavailable";

/** Thrown by {@link verifyAccessToken}. Answer a `jwks_unavailable` with a 5xx and every other reason with a 401. */
export class AccessTokenError extends Error {
  constructor(
    readonly reason: AccessTokenErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "AccessTokenError";
  }
}

export interface VerifyAccessTokenOptions {
  /** Your instance's `AUTH_ISSUER`; the token's `iss` must equal it exactly. */
  issuer: string;
  /** Your app's id (`GET /v1/app`); the token's `aud` must name it. */
  appId: string;
  /** Where the public keys are. Defaults to `/.well-known/jwks.json` on the `issuer`. */
  jwksUrl?: string;
  /** Seconds of clock difference to forgive on `exp` and `nbf`. Defaults to 10. */
  clockToleranceSeconds?: number;
  /** How long a fetched key set is trusted, in seconds. Defaults to 300, the age the api allows caches. */
  cacheTtlSeconds?: number;
  /** The fewest seconds between two fetches triggered by an unknown `kid`. Defaults to 10. */
  refetchCooldownSeconds?: number;
  /** How long one key set request may take, in milliseconds, body included. Defaults to 5000. */
  fetchTimeoutMs?: number;
  /** A custom `fetch`, for tests or edge runtimes. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** The current time in milliseconds since the epoch. Defaults to `Date.now`, and exists for tests. */
  now?: () => number;
}

/** The user and session an access token was issued for. */
export interface VerifiedAccessToken {
  userId: string;
  sessionId: string;
}

interface Jwk {
  kty?: unknown;
  crv?: unknown;
  x?: unknown;
  y?: unknown;
  kid?: unknown;
  use?: unknown;
  alg?: unknown;
}

interface KeySet {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

interface CacheEntry {
  set: KeySet | null;
  lastFetchAt: number;
  lastError: AccessTokenError | null;
  inflight: Promise<KeySet> | null;
}

// One entry per key set URL, so many calls share one fetch. The keys are public, so sharing them leaks nothing.
const caches = new Map<string, CacheEntry>();

/** Forgets every cached key set. For tests and for a process that wants to start clean. */
export function clearAccessTokenKeyCache(): void {
  caches.clear();
}

function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> {
  try {
    const padded = text.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new AccessTokenError("malformed", "The token is not valid base64url");
  }
}

function decodeJsonPart(part: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(part)));
  } catch {
    throw new AccessTokenError("malformed", `The token ${what} is not JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AccessTokenError("malformed", `The token ${what} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function importKey(jwk: Jwk): Promise<CryptoKey | null> {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") return null;
  if (jwk.use !== undefined && jwk.use !== "sig") return null;
  if (jwk.alg !== undefined && jwk.alg !== ALG) return null;
  try {
    // Only the public coordinates are passed on, so a stray `key_ops` or `d` in the document changes nothing.
    return await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
}

// Rejects when `signal` aborts even if `work` ignores it, as a custom `fetch` or a stalled body can.
function until<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("timed out"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// Reads at most `max` bytes and cancels the stream past that, so a hostile endpoint cannot make us buffer its answer.
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchKeySet(url: string, options: VerifyAccessTokenOptions): Promise<KeySet> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const unavailable = (why: string) =>
    new AccessTokenError("jwks_unavailable", `The signing keys could not be loaded: ${why}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS);
  let text: string | null;
  try {
    text = await until(
      controller.signal,
      (async () => {
        const res = await fetchFn(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) throw unavailable(`HTTP ${res.status}`);
        return readCapped(res, JWKS_BODY_MAX_BYTES);
      })(),
    );
  } catch (error) {
    if (error instanceof AccessTokenError) throw error;
    throw unavailable("the request failed");
  } finally {
    clearTimeout(timer);
  }
  if (text === null) throw unavailable("the answer is too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw unavailable("the answer is not JSON");
  }
  const list = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) throw unavailable("the answer has no keys list");
  const keys = new Map<string, CryptoKey>();
  for (const entry of list as Jwk[]) {
    if (entry === null || typeof entry !== "object" || typeof entry.kid !== "string") continue;
    const key = await importKey(entry);
    if (key) keys.set(entry.kid, key);
  }
  return { keys, fetchedAt: (options.now ?? Date.now)() };
}

// One request serves every caller waiting on it, and a failed one leaves the older set in place.
function refresh(url: string, entry: CacheEntry, options: VerifyAccessTokenOptions) {
  entry.inflight ??= (async () => {
    entry.lastFetchAt = (options.now ?? Date.now)();
    try {
      const set = await fetchKeySet(url, options);
      entry.set = set;
      entry.lastError = null;
      return set;
    } catch (error) {
      entry.lastError = error as AccessTokenError;
      throw error;
    } finally {
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

async function findKey(
  kid: string,
  url: string,
  options: VerifyAccessTokenOptions,
): Promise<CryptoKey> {
  const now = options.now ?? Date.now;
  let entry = caches.get(url);
  if (!entry) {
    entry = { set: null, lastFetchAt: 0, lastError: null, inflight: null };
    caches.set(url, entry);
  }
  const ttl = (options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS) * 1000;
  const cooldown = (options.refetchCooldownSeconds ?? DEFAULT_REFETCH_COOLDOWN_SECONDS) * 1000;
  const mayStartFetch = () => !entry.inflight && now() - entry.lastFetchAt >= cooldown;

  if (!entry.set) {
    const set = await refresh(url, entry, options);
    const first = set.keys.get(kid);
    if (first) return first;
    throw new AccessTokenError("unknown_key", "No published signing key matches the token's kid");
  }

  const known = entry.set.keys.get(kid);
  if (known) {
    // Served from the held set at once; an old set is renewed behind the request so a slow endpoint costs nobody a wait.
    if (now() - entry.set.fetchedAt > ttl && mayStartFetch()) {
      refresh(url, entry, options).catch(() => undefined);
    }
    return known;
  }

  // A kid the set lacks may be a rotation. A fetch already under way is joined, and a new one starts at most once per cooldown.
  if (entry.inflight || mayStartFetch()) {
    const set = await refresh(url, entry, options);
    const found = set.keys.get(kid);
    if (found) return found;
  } else if (entry.lastError) {
    // The last attempt failed, so an unknown kid may only be a key we could not load: that is an outage, not a bad token.
    throw entry.lastError;
  }
  throw new AccessTokenError("unknown_key", "No published signing key matches the token's kid");
}

function checkAudience(aud: unknown, appId: string): boolean {
  if (typeof aud === "string") return aud === appId;
  return Array.isArray(aud) && aud.includes(appId);
}

function numericClaim(claims: Record<string, unknown>, name: string): number | undefined {
  const value = claims[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AccessTokenError("claims", `The token's ${name} is not a number`);
  }
  return value;
}

/**
 * Checks a Gemicore access token without calling Gemicore: the ES256 signature against the published keys,
 * `typ`, `iss`, `aud`, `exp` and `nbf`. Throws {@link AccessTokenError} when the token fails a check.
 *
 * This cannot see a session that was revoked after the token was issued; Gemicore's own routes check that.
 */
export async function verifyAccessToken(
  token: string,
  options: VerifyAccessTokenOptions,
): Promise<VerifiedAccessToken> {
  if (!options.issuer || !options.appId) {
    throw new TypeError("verifyAccessToken needs an `issuer` and an `appId`");
  }
  if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS) {
    throw new AccessTokenError("malformed", "The token is missing or too long");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => BASE64URL.test(part))) {
    throw new AccessTokenError("malformed", "The token is not three base64url parts");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = decodeJsonPart(encodedHeader, "header");
  // Exact match: no `none`, no HMAC (which would turn a public key into a shared secret), no other curve.
  if (header.alg !== ALG) {
    throw new AccessTokenError("algorithm", `The token's alg must be ${ALG}`);
  }
  if (header.typ !== TYP) {
    throw new AccessTokenError("type", `The token's typ must be ${TYP}`);
  }
  if ("crit" in header) {
    throw new AccessTokenError("malformed", "The token names critical header fields");
  }
  if (typeof header.kid !== "string" || header.kid.length === 0) {
    throw new AccessTokenError("unknown_key", "The token has no kid");
  }

  const jwksUrl = options.jwksUrl ?? `${options.issuer.replace(/\/+$/, "")}/.well-known/jwks.json`;
  const key = await findKey(header.kid, jwksUrl, options);

  const signature = decodeBase64Url(encodedSignature);
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const valid = await crypto.subtle
    .verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, signed)
    .catch(() => false);
  if (!valid) throw new AccessTokenError("signature", "The token's signature does not verify");

  const claims = decodeJsonPart(encodedPayload, "payload");
  if (claims.iss !== options.issuer) {
    throw new AccessTokenError("issuer", "The token was issued by another issuer");
  }
  if (!checkAudience(claims.aud, options.appId)) {
    throw new AccessTokenError("audience", "The token is for another app");
  }
  const exp = numericClaim(claims, "exp");
  if (exp === undefined) throw new AccessTokenError("claims", "The token has no exp");
  const nbf = numericClaim(claims, "nbf");
  numericClaim(claims, "iat");
  const tolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  const nowSeconds = (options.now ?? Date.now)() / 1000;
  if (exp + tolerance <= nowSeconds) throw new AccessTokenError("expired", "The token has expired");
  if (nbf !== undefined && nbf - tolerance > nowSeconds) {
    throw new AccessTokenError("not_yet_valid", "The token is not valid yet");
  }
  const { sub, sid } = claims;
  if (typeof sub !== "string" || sub.length === 0 || typeof sid !== "string" || sid.length === 0) {
    throw new AccessTokenError("claims", "The token has no sub or sid");
  }
  return { userId: sub, sessionId: sid };
}
