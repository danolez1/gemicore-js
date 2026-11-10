/**
 * Error codes of the OpenID Connect sign-in routes. They arrive as `GemicoreApiError.code` from
 * `oidcProviders` and `oidcExchange`, and as the `error` query parameter when a sign-in that
 * reached the provider is refused and Gemicore sends the browser back to the app.
 */
export const OidcErrorCode = {
  OIDC_PROVIDER_NOT_FOUND: "OIDC_PROVIDER_NOT_FOUND",
  OIDC_PROVIDER_NOT_ENABLED: "OIDC_PROVIDER_NOT_ENABLED",
  OIDC_PROVIDER_DISABLED: "OIDC_PROVIDER_DISABLED",
  OIDC_PROVIDER_MODE_MISMATCH: "OIDC_PROVIDER_MODE_MISMATCH",
  OIDC_STATE_INVALID: "OIDC_STATE_INVALID",
  OIDC_STATE_REPLAYED: "OIDC_STATE_REPLAYED",
  OIDC_STATE_EXPIRED: "OIDC_STATE_EXPIRED",
  OIDC_BROWSER_MISMATCH: "OIDC_BROWSER_MISMATCH",
  OIDC_PROVIDER_ERROR: "OIDC_PROVIDER_ERROR",
  OIDC_DISCOVERY_FAILED: "OIDC_DISCOVERY_FAILED",
  OIDC_TOKEN_EXCHANGE_FAILED: "OIDC_TOKEN_EXCHANGE_FAILED",
  OIDC_ID_TOKEN_INVALID: "OIDC_ID_TOKEN_INVALID",
  OIDC_URL_BLOCKED: "OIDC_URL_BLOCKED",
  OIDC_EMAIL_NOT_VERIFIED: "OIDC_EMAIL_NOT_VERIFIED",
  OIDC_EMAIL_DOMAIN_NOT_ALLOWED: "OIDC_EMAIL_DOMAIN_NOT_ALLOWED",
  OIDC_LINK_REFUSED: "OIDC_LINK_REFUSED",
  OIDC_LINK_UNVERIFIED_ACCOUNT: "OIDC_LINK_UNVERIFIED_ACCOUNT",
  OIDC_SIGNUP_CLOSED: "OIDC_SIGNUP_CLOSED",
  OIDC_USER_DISABLED: "OIDC_USER_DISABLED",
  OIDC_CODE_INVALID: "OIDC_CODE_INVALID",
  OIDC_CONNECTION_EXISTS: "OIDC_CONNECTION_EXISTS",
  OIDC_CONNECTION_LIMIT: "OIDC_CONNECTION_LIMIT",
} as const;

/** Union of the OIDC error code string values. */
export type OidcErrorCode = (typeof OidcErrorCode)[keyof typeof OidcErrorCode];

/** One sign-in provider the app has turned on for the key's mode (`GET /v1/auth/oidc/providers`). */
export interface OidcProvider {
  providerKey: string;
  displayName: string;
}

/** Options for {@link AuthClient.oidcStartUrl}. */
export interface OidcStartOptions {
  /** Where Gemicore sends the browser back with `gemicore_code`; must be one of the app's redirect URLs. */
  redirect: string;
  /** Your own value, returned unchanged as `state` on the redirect (1 to 512 characters). */
  state?: string;
  /** The S256 challenge from {@link createOidcPkce}; keep its verifier for {@link AuthClient.oidcExchange}. */
  codeChallenge: string;
}

/** A PKCE pair between your page and Gemicore, so a leaked `gemicore_code` is useless without the verifier. */
export interface OidcPkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * The single-use code from the redirect back to your page. Reads `gemicore_code`, then `keel_code`,
 * which Gemicore still appends for a transition. Returns null when the redirect carries neither.
 */
export function oidcCodeFromUrl(url: string | URL): string | null {
  const params = new URL(url).searchParams;
  // compat: redirects from before the rename carry only keel_code.
  return params.get("gemicore_code") ?? params.get("keel_code");
}

/** Why a provider sign-in that reached the provider came back refused (see {@link oidcErrorFromUrl}). */
export interface OidcRedirectError {
  /** An {@link OidcErrorCode} value, or another string such as `INTERNAL_ERROR` that the api can also send. */
  code: string;
  /**
   * The finer cause, forwarded for any code that carries one (`OIDC_PROVIDER_ERROR`, `OIDC_ID_TOKEN_INVALID`,
   * `OIDC_DISCOVERY_FAILED`, `OIDC_TOKEN_EXCHANGE_FAILED`, `OIDC_URL_BLOCKED`, `OIDC_EMAIL_DOMAIN_NOT_ALLOWED`), else null.
   */
  reason: string | null;
  /** Your own `state`, as the redirect returned it, else null. */
  state: string | null;
}

/** The refusal on the redirect back to your page, or null when the redirect carries no `error`. */
export function oidcErrorFromUrl(url: string | URL): OidcRedirectError | null {
  const params = new URL(url).searchParams;
  const code = params.get("error");
  if (!code) return null;
  return { code, reason: params.get("error_reason"), state: params.get("state") };
}

// RFC 7636 4.1 and 4.2 bound both at 43 to 128; Gemicore takes only the base64url alphabet.
export const OIDC_PKCE_VALUE = /^[A-Za-z0-9_-]{43,128}$/;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The S256 challenge (base64url SHA-256) of a verifier, with Web Crypto so it runs in browsers and Bun. */
export async function oidcPkceChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64url(new Uint8Array(digest));
}

/** A fresh verifier (32 random bytes, 43 characters) and its challenge. Store the verifier until the exchange. */
export async function createOidcPkce(): Promise<OidcPkcePair> {
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { codeVerifier, codeChallenge: await oidcPkceChallenge(codeVerifier) };
}
