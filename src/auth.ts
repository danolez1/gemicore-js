import { GemicoreConfigError, type GemicoreHttpClient } from "./http.ts";
import { OIDC_PKCE_VALUE, type OidcProvider, type OidcStartOptions } from "./oidc.ts";
import type {
  AppUser,
  Credentials,
  ExternalUser,
  MfaChallenge,
  SignupConsent,
  TokenResponse,
} from "./types.ts";

// The start route's own pattern, so a bad key fails here and never becomes a path segment.
const PROVIDER_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** True when a sign-in answer is the TOTP step and not a session; finish it with `loginTotp` or `loginBackupCode`. */
export function isMfaChallenge(result: TokenResponse | MfaChallenge): result is MfaChallenge {
  return "mfaRequired" in result;
}

/** End-user auth for one app: `/v1/auth/*`. Signed-in calls take the user's access token. */
export class AuthClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** Creates an account and signs it in. Rejects with `AUTH_EMAIL_TAKEN` (409) when the address already has one. */
  signup(credentials: Credentials & SignupConsent): Promise<TokenResponse> {
    return this.http.request("/v1/auth/signup", { method: "POST", body: credentials });
  }

  /** Returns an {@link MfaChallenge} and no tokens when the user has TOTP enabled. */
  login(credentials: Credentials): Promise<TokenResponse | MfaChallenge> {
    return this.http.request("/v1/auth/login", { method: "POST", body: credentials });
  }

  /** Finishes a sign-in with the 6 digit code. A wrong code is `AUTH_TOTP_INVALID` (401) and can be retried inside the challenge's 5 minutes. */
  loginTotp(challengeToken: string, code: string): Promise<TokenResponse> {
    return this.http.request("/v1/auth/login/totp", {
      method: "POST",
      body: { challengeToken, code },
    });
  }

  /** Signs in with one of the single-use backup codes shown at TOTP activation. */
  loginBackupCode(challengeToken: string, backupCode: string): Promise<TokenResponse> {
    return this.http.request("/v1/auth/login/totp", {
      method: "POST",
      body: { challengeToken, backupCode },
    });
  }

  /** Mails a sign-in link. Answers `{ sent: true }` for an address with an account and for one without. */
  sendMagicLink(email: string): Promise<{ sent: true }> {
    return this.http.request("/v1/auth/magic-link", { method: "POST", body: { email } });
  }

  /** Trades the token from a magic link for a session, or an {@link MfaChallenge} when the user has TOTP on. A used or expired token is `AUTH_INVALID_TOKEN`. */
  verifyMagicLink(token: string): Promise<TokenResponse | MfaChallenge> {
    return this.http.request("/v1/auth/magic-link/verify", { method: "POST", body: { token } });
  }

  /** Resolves the same way for an email with an account and one without. */
  forgotPassword(email: string): Promise<{ sent: true }> {
    return this.http.request("/v1/auth/password/forgot", { method: "POST", body: { email } });
  }

  /** Signs out every session of the user; sign in again with the new password. */
  resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ reset: true; sessionsRevoked: number }> {
    return this.http.request("/v1/auth/password/reset", {
      method: "POST",
      body: { token, newPassword },
    });
  }

  /** Signs out every other session but keeps the one behind `userToken`. */
  changePassword(
    userToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ changed: true; sessionsRevoked: number }> {
    return this.http.request("/v1/auth/password/change", {
      method: "POST",
      body: { currentPassword, newPassword },
      auth: { userToken },
    });
  }

  /** Trades a refresh token for a new pair. Using a retired token again after 10 seconds is `AUTH_REFRESH_REUSED` and will end the session. */
  refresh(refreshToken: string): Promise<TokenResponse> {
    return this.http.request("/v1/auth/refresh", { method: "POST", body: { refreshToken } });
  }

  /** The signed-in user. A revoked or expired access token is `AUTH_INVALID_TOKEN` (401). */
  me(userToken: string): Promise<AppUser> {
    return this.http.request("/v1/auth/me", { method: "GET", auth: { userToken } });
  }

  /** Ends the session behind `userToken`. */
  logout(userToken: string): Promise<{ revoked: true }> {
    return this.http.request("/v1/auth/logout", { method: "POST", auth: { userToken } });
  }

  /** Ends every session of the user, the one behind `userToken` included. */
  revokeAllSessions(userToken: string): Promise<{ sessionsRevoked: number }> {
    return this.http.request("/v1/auth/sessions/revoke-all", {
      method: "POST",
      auth: { userToken },
    });
  }

  /** Starts TOTP: returns the secret and an `otpauth://` URI to show as a QR code. Rejects with `AUTH_TOTP_ALREADY_ENABLED` (409) when it is on. */
  enrollTotp(userToken: string): Promise<{ secret: string; uri: string }> {
    return this.http.request("/v1/auth/totp/enroll", { method: "POST", auth: { userToken } });
  }

  /** The backup codes are returned only here and by regenerateBackupCodes; store none of them. */
  activateTotp(userToken: string, code: string): Promise<{ enabled: true; backupCodes: string[] }> {
    return this.http.request("/v1/auth/totp/activate", {
      method: "POST",
      body: { code },
      auth: { userToken },
    });
  }

  /** Replaces the backup codes after a current TOTP code, and returns the new set. The old codes are invalidated. */
  regenerateBackupCodes(userToken: string, code: string): Promise<{ backupCodes: string[] }> {
    return this.http.request("/v1/auth/totp/backup-codes", {
      method: "POST",
      body: { code },
      auth: { userToken },
    });
  }

  /** Turns TOTP off after a current code. Rejects with `AUTH_TOTP_NOT_ENROLLED` (409) when it is not on, and `AUTH_TOTP_INVALID` (401) for a wrong code. */
  disableTotp(userToken: string, code: string): Promise<{ enabled: false }> {
    return this.http.request("/v1/auth/totp/disable", {
      method: "POST",
      body: { code },
      auth: { userToken },
    });
  }

  /** The OpenID Connect providers the app has turned on for this key's mode. */
  oidcProviders(): Promise<OidcProvider[]> {
    return this.http.requestData("/v1/auth/oidc/providers", { method: "GET" });
  }

  /**
   * The URL to send the browser to (a full page navigation; a `fetch` call cannot do it) to sign in
   * through `provider`. Builds the URL only and needs a publishable key, because the key is in the query.
   */
  oidcStartUrl(provider: string, options: OidcStartOptions): string {
    const key = this.http.publishableKey();
    if (!key) {
      throw new GemicoreConfigError(
        "oidcStartUrl needs a publishable key: a secret key in a URL ends up in browser history",
      );
    }
    if (!PROVIDER_KEY.test(provider)) {
      throw new GemicoreConfigError(`oidcStartUrl: "${provider}" is not a provider key`);
    }
    const { redirect, state, codeChallenge } = options ?? {};
    if (!redirect || redirect.length > 2048) {
      throw new GemicoreConfigError("oidcStartUrl needs a `redirect` of 1 to 2048 characters");
    }
    if (state !== undefined && (state.length === 0 || state.length > 512)) {
      throw new GemicoreConfigError("oidcStartUrl: `state` must be 1 to 512 characters");
    }
    if (!codeChallenge || !OIDC_PKCE_VALUE.test(codeChallenge)) {
      throw new GemicoreConfigError("oidcStartUrl needs a `codeChallenge` from createOidcPkce()");
    }
    return this.http.url(`/v1/auth/oidc/${provider}/start`, {
      key,
      redirect,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
  }

  /**
   * Trades the single-use `gemicore_code` from the redirect (valid 60 seconds) and the verifier whose
   * challenge started the sign-in for a session, or an {@link MfaChallenge} when the user has TOTP
   * on, like {@link AuthClient.login}. The code is spent once a wrong verifier is tried.
   */
  async oidcExchange(code: string, codeVerifier: string): Promise<TokenResponse | MfaChallenge> {
    if (!codeVerifier || !OIDC_PKCE_VALUE.test(codeVerifier)) {
      throw new GemicoreConfigError("oidcExchange needs the `codeVerifier` from createOidcPkce()");
    }
    return this.http.request("/v1/auth/oidc/exchange", {
      method: "POST",
      body: { code, code_verifier: codeVerifier },
    });
  }

  /**
   * Server-side only: needs a secret key. Creates the user for your own `externalId`, or returns the one already there, with no
   * password and no mail, so it can be subscribed without signing in. `AUTH_EMAIL_TAKEN` (409) when the email belongs to a user with another external id.
   */
  upsertUser(externalId: string, input: { email: string }): Promise<ExternalUser> {
    return this.http.request(`/v1/auth/users/external/${encodeURIComponent(externalId)}`, {
      method: "PUT",
      body: input,
    });
  }

  /** Server-side only: needs a secret key. */
  revokeUserSessions(userId: string): Promise<{ sessionsRevoked: number }> {
    return this.http.request(`/v1/auth/users/${encodeURIComponent(userId)}/revoke-sessions`, {
      method: "POST",
    });
  }
}
