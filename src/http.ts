/**
 * Thin `fetch` transport for the Gemicore SDK with a request timeout and typed errors.
 *
 * Uses `globalThis.fetch` by default (this is a standalone client library with no
 * dependency on any internal HTTP wrapper) and throws {@link GemicoreApiError} on any
 * non-2xx response, decoding the platform's `{ error: { code, message } }` envelope, and
 * on a 2xx response whose body cannot be read as JSON.
 */

/**
 * The codes an app developer can meet from the public API, plus `NETWORK_ERROR` and `TIMEOUT`, which the SDK
 * raises itself when no usable response arrives. The server may send other codes too; `GemicoreApiError.code` is a plain string.
 */
export const GemicoreErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DB_ERROR: "DB_ERROR",
  TX_DEADLOCK: "TX_DEADLOCK",
  TX_SERIALIZATION_FAILURE: "TX_SERIALIZATION_FAILURE",
  TX_TIMEOUT: "TX_TIMEOUT",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  AUTH_INVALID_API_KEY: "AUTH_INVALID_API_KEY",
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN",
  AUTH_REFRESH_REUSED: "AUTH_REFRESH_REUSED",
  AUTH_EMAIL_TAKEN: "AUTH_EMAIL_TAKEN",
  AUTH_TOTP_INVALID: "AUTH_TOTP_INVALID",
  AUTH_TOTP_NOT_ENROLLED: "AUTH_TOTP_NOT_ENROLLED",
  AUTH_TOTP_ALREADY_ENABLED: "AUTH_TOTP_ALREADY_ENABLED",
  GATEWAY_ERROR: "GATEWAY_ERROR",
  CREDENTIAL_UNREADABLE: "CREDENTIAL_UNREADABLE",
  PLAN_LIMIT_EXCEEDED: "PLAN_LIMIT_EXCEEDED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  INVALID_PLAN: "INVALID_PLAN",
  SUBSCRIPTION_NOT_FOUND: "SUBSCRIPTION_NOT_FOUND",
  SUBSCRIPTION_CANCELED: "SUBSCRIPTION_CANCELED",
  ALREADY_SUBSCRIBED: "ALREADY_SUBSCRIBED",
  PROMO_CODE_INVALID: "PROMO_CODE_INVALID",
  PROMO_CODE_EXPIRED: "PROMO_CODE_EXPIRED",
  PROMO_CODE_EXHAUSTED: "PROMO_CODE_EXHAUSTED",
  PRICE_UNAVAILABLE: "PRICE_UNAVAILABLE",
  AUTO_RENEW_UNAVAILABLE: "AUTO_RENEW_UNAVAILABLE",
  PLAN_CHANGE_NOT_ALLOWED: "PLAN_CHANGE_NOT_ALLOWED",
  NOTIFICATIONS_PUSH_DISABLED: "NOTIFICATIONS_PUSH_DISABLED",
  NOTIFICATION_RECIPIENT_UNKNOWN: "NOTIFICATION_RECIPIENT_UNKNOWN",
  MAIL_NOT_CONFIGURED: "MAIL_NOT_CONFIGURED",
  MARKETING_OPTED_OUT: "MARKETING_OPTED_OUT",
  MARKETING_WORDING_REQUIRED: "MARKETING_WORDING_REQUIRED",
  APP_SUPPRESSION_LIMIT_REACHED: "APP_SUPPRESSION_LIMIT_REACHED",
  CRYPTO_KYC_POLICY_MISSING: "CRYPTO_KYC_POLICY_MISSING",
  CRYPTO_KYC_REQUIRED: "CRYPTO_KYC_REQUIRED",
  CRYPTO_TREASURY_INSUFFICIENT: "CRYPTO_TREASURY_INSUFFICIENT",
  CRYPTO_TREASURY_BUSY: "CRYPTO_TREASURY_BUSY",
  CRYPTO_REFUND_UNRESOLVED: "CRYPTO_REFUND_UNRESOLVED",
  CRYPTO_NO_PAYER: "CRYPTO_NO_PAYER",
  CRYPTO_SANCTIONED_ADDRESS: "CRYPTO_SANCTIONED_ADDRESS",
  CRYPTO_MULTIPLE_PAYERS: "CRYPTO_MULTIPLE_PAYERS",
  CRYPTO_TREASURY_MISMATCH: "CRYPTO_TREASURY_MISMATCH",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
} as const;

/** Union of Gemicore error code string values. */
export type GemicoreErrorCode = (typeof GemicoreErrorCode)[keyof typeof GemicoreErrorCode];

/** Error thrown when the SDK is misconfigured (missing credential or base URL). */
export class GemicoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GemicoreConfigError";
  }
}

/** Optional fields of a {@link GemicoreApiError} that only some failures have. */
export interface GemicoreApiErrorExtra {
  retryAfter?: number | undefined;
  apiDetails?: unknown;
}

/** Error thrown by the SDK on a non-2xx response, an unusable 2xx body, a network failure or a timeout. */
export class GemicoreApiError extends Error {
  /** Seconds to wait before retrying, from the `Retry-After` header or else the API's `retryAfter`; undefined when neither came. */
  readonly retryAfter: number | undefined;
  /** The API's own `error.details` (for example `{ field }` on a 422), or undefined when the response had none. */
  readonly apiDetails: unknown;

  constructor(
    message: string,
    /** Gemicore error code from the response envelope, or a transport code. */
    public readonly code: string,
    /** HTTP status (0 when no response arrived) and the raw response body, decoded when it was JSON. */
    public readonly details: { status: number; body: unknown },
    extra: GemicoreApiErrorExtra = {},
  ) {
    super(message);
    this.name = "GemicoreApiError";
    this.retryAfter = extra.retryAfter;
    this.apiDetails = extra.apiDetails;
  }
}

/**
 * True for a `GemicoreApiError` from any copy of this package. Use it when an app can load
 * both the ESM and the CommonJS build, because each build has its own class and `instanceof` will fail across them.
 */
export function isGemicoreApiError(error: unknown): error is GemicoreApiError {
  if (error instanceof GemicoreApiError) return true;
  if (!(error instanceof Error) || error.name !== "GemicoreApiError") return false;
  const { code, details } = error as Partial<GemicoreApiError>;
  return typeof code === "string" && typeof details?.status === "number";
}

/** Shape of a Gemicore error response body. */
interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

/** Per-request credentials layered on top of the ambient app key. */
export interface RequestAuth {
  /** End-user access token, sent as `x-user-token` for signed-in routes. */
  userToken?: string | undefined;
  /** Sent as `Idempotency-Key`; required by checkout and refunds. */
  idempotencyKey?: string | undefined;
  /** A device customer's token, sent as `x-customer-token` on purchases routes. */
  customerToken?: string | undefined;
}

/** Options for {@link GemicoreHttpClient.request}. */
interface RequestInitLite {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: RequestAuth;
  /** Extra headers; credentials set by the client itself win over a header of the same name. */
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
}

/** The subset of `fetch` the client calls, so tests and edge runtimes can inject their own. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Configuration for a {@link GemicoreHttpClient} bound to one base URL. */
export interface HttpClientConfig {
  baseUrl: string;
  /** App key sent as `Authorization: Bearer`. Omit for key-less routes. */
  apiKey?: string;
  timeout: number;
  fetch?: FetchLike;
  /** End user's IP, sent as `X-Gemicore-Client-IP` so per-IP limits see the user, not this server (secret keys only). */
  clientIp?: string;
}

// Node rejects a larger delay in a timer, or silently shrinks it to 1 ms.
const MAX_TIMEOUT_MS = 2_147_483_647;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON = MONTHS.join("|");
const TIME = "(?<h>\\d{2}):(?<m>\\d{2}):(?<s>\\d{2})";
// The three date formats HTTP allows, matched strictly because Date.parse reads things like "1.5" as a year.
const HTTP_DATES = [
  new RegExp(
    `^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?<day>\\d{2}) (?<mon>${MON}) (?<year>\\d{4}) ${TIME} GMT$`,
  ),
  new RegExp(
    `^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (?<day>\\d{2})-(?<mon>${MON})-(?<year>\\d{2}) ${TIME} GMT$`,
  ),
  new RegExp(
    `^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?<mon>${MON}) (?<day>[ \\d]\\d) ${TIME} (?<year>\\d{4})$`,
  ),
];

const DAY_MS = 86_400_000;
const FIFTY_YEARS_MS = 50 * 365.25 * DAY_MS;

/** Milliseconds since the epoch for a well-formed HTTP date, else undefined. */
function httpDateMs(value: string, now: number): number | undefined {
  for (const pattern of HTTP_DATES) {
    const g = pattern.exec(value)?.groups;
    if (!g) continue;
    const month = MONTHS.indexOf(g.mon ?? "");
    const day = Number(g.day?.trim());
    const [h, m, s] = [Number(g.h), Number(g.m), Number(g.s)];
    if (h > 23 || m > 59 || s > 60) return undefined;
    const at = (year: number) => Date.UTC(year, month, day, h, m, s);
    let year = Number(g.year);
    if (g.year?.length === 2) {
      year += 2000;
      // RFC 9110: a two digit year that lands more than 50 years ahead means the century before.
      if (at(year) > now + FIFTY_YEARS_MS) year -= 100;
    }
    const daysInMonth = (Date.UTC(year, month + 1, 1) - Date.UTC(year, month, 1)) / DAY_MS;
    return day >= 1 && day <= daysInMonth ? at(year) : undefined;
  }
  return undefined;
}

/** Seconds from a `Retry-After` header (plain digits or an HTTP date), else from the body's `error.details.retryAfter`. */
function retryAfterSeconds(res: Response, body: ErrorEnvelope | null): number | undefined {
  const header = res.headers.get("retry-after")?.trim();
  if (header && /^\d+$/.test(header)) {
    const seconds = Number(header);
    if (Number.isSafeInteger(seconds)) return seconds;
  } else if (header) {
    const at = httpDateMs(header, Date.now());
    if (at !== undefined) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }
  const details = body?.error?.details;
  if (details && typeof details === "object" && "retryAfter" in details) {
    const value = details.retryAfter;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

/**
 * A failure with no usable response. The message names only the error's kind, never the runtime's own text,
 * because undici quotes a rejected header value there and that value can be the app key.
 */
function transportError(e: unknown, method: string, path: string, status: number) {
  const timedOut = e instanceof Error && e.name === "TimeoutError";
  const kind =
    e instanceof Error ? e.name.replace(/[^\w.]/g, "").slice(0, 40) || "Error" : "non-Error";
  return new GemicoreApiError(
    timedOut
      ? `Request to ${method} ${path} timed out`
      : `Request to ${method} ${path} failed (${kind})`,
    timedOut ? GemicoreErrorCode.TIMEOUT : GemicoreErrorCode.NETWORK_ERROR,
    { status, body: null },
  );
}

/** A line break or other control character in a header value makes the runtime reject the request and quote the value. */
function assertHeaderSafe(label: string, value: string | undefined): void {
  if (value === undefined) return;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new GemicoreConfigError(
        `The ${label} contains a control character, such as a line break`,
      );
    }
  }
}

/** Rejects when `signal` aborts even if `work` ignores it, as a custom `fetch` or a stalled body can. */
function until<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Build a query string (with leading `?`) from defined params, or "" when empty. */
function buildQuery(query: Record<string, string | number | undefined> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * A `fetch` wrapper bound to one base URL. Sends `Authorization: Bearer <app key>` when an
 * api key is configured and `x-user-token` / `Idempotency-Key` when supplied per request.
 * Unwraps the `{ data }` envelope via {@link GemicoreHttpClient.requestData}.
 */
export class GemicoreHttpClient {
  constructor(private readonly config: HttpClientConfig) {
    const { timeout } = config;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
      throw new GemicoreConfigError(
        `Gemicore \`timeout\` must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}, got ${String(timeout)}`,
      );
    }
    assertHeaderSafe("api key", config.apiKey);
    assertHeaderSafe("client IP", config.clientIp);
  }

  /** Absolute URL of `path` on this client's base URL, for pages a browser navigates to itself. */
  url(path: string, query?: Record<string, string | number | undefined>): string {
    return `${this.config.baseUrl}${path}${buildQuery(query)}`;
  }

  /** The configured app key when it is a publishable `pk_*` key, else null. */
  publishableKey(): string | null {
    const key = this.config.apiKey;
    return key && /^pk_(test|live)_/.test(key) ? key : null;
  }

  /** Perform a request and return the parsed JSON body typed as `T`. */
  async request<T>(path: string, init: RequestInitLite): Promise<T> {
    return (await this.exchange(path, init)).body as T;
  }

  /** Perform a request and return the unwrapped `data` field of the `{ data }` envelope. */
  async requestData<T>(path: string, init: RequestInitLite): Promise<T> {
    const { body, status } = await this.exchange(path, init);
    if (!("data" in body)) {
      throw new GemicoreApiError(
        `${init.method} ${path}: HTTP ${status} came back without a data field`,
        GemicoreErrorCode.INTERNAL_ERROR,
        { status, body },
      );
    }
    return body.data as T;
  }

  private async exchange(
    path: string,
    init: RequestInitLite,
  ): Promise<{ body: Record<string, unknown>; status: number }> {
    assertHeaderSafe("user token", init.auth?.userToken);
    assertHeaderSafe("idempotency key", init.auth?.idempotencyKey);
    assertHeaderSafe("customer token", init.auth?.customerToken);
    for (const [name, value] of Object.entries(init.headers ?? {})) assertHeaderSafe(name, value);
    const headers: Record<string, string> = { ...init.headers, Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    if (this.config.clientIp) headers["X-Gemicore-Client-IP"] = this.config.clientIp;
    if (init.auth?.userToken) headers["x-user-token"] = init.auth.userToken;
    if (init.auth?.customerToken) headers["x-customer-token"] = init.auth.customerToken;
    if (init.auth?.idempotencyKey) headers["Idempotency-Key"] = init.auth.idempotencyKey;

    const url = this.url(path, init.query);
    // A plain timer, not AbortSignal.timeout: Node unrefs that one, so a fetch that never settles would let the process exit first.
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(
      () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
      this.config.timeout,
    );
    const requestInit: RequestInit = { method: init.method, headers, signal };
    if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);

    try {
      const fetchFn = this.config.fetch ?? globalThis.fetch;
      let res: Response;
      try {
        res = await until(signal, Promise.resolve(fetchFn(url, requestInit)));
      } catch (e) {
        throw transportError(e, init.method, path, 0);
      }

      if (!res.ok) {
        const body = (await until(signal, res.text())
          .then(JSON.parse)
          .catch(() => null)) as ErrorEnvelope | null;
        throw new GemicoreApiError(
          `${init.method} ${path}: ${body?.error?.message ?? `HTTP ${res.status}`}`,
          body?.error?.code ?? GemicoreErrorCode.INTERNAL_ERROR,
          { status: res.status, body },
          { retryAfter: retryAfterSeconds(res, body), apiDetails: body?.error?.details },
        );
      }

      let text: string;
      try {
        text = await until(signal, res.text());
      } catch (e) {
        throw transportError(e, init.method, path, res.status);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new GemicoreApiError(
          `${init.method} ${path}: HTTP ${res.status} came back without a JSON object`,
          GemicoreErrorCode.INTERNAL_ERROR,
          { status: res.status, body: text.slice(0, 500) },
        );
      }
      return { body: parsed as Record<string, unknown>, status: res.status };
    } finally {
      clearTimeout(timer);
    }
  }
}
