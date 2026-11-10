# Changelog

All notable changes to `@gemicore/sdk`. The package follows semantic versioning: while the version is below 1.0, a minor bump may change a method or a type.

## 0.2.0 (2026-11-10)

Store purchases. Every route of the purchases API now has a method, and a test keeps it that way.

- `gemicore.purchases` with 21 methods. For your backend, with a secret key: `retrieveCustomer`, `grantEntitlement`, `revokeEntitlement` and `importPurchases`. For a device, with a publishable key and the `customerToken` that `createCustomer` returns: `logIn`, `logOut`, `customerInfo`, `setAttributes`, `setConsumptionConsent`, `products`, `offerings`, `offers`, `recordPurchase`, `restore`, `checkout`, `checkoutIntent`, `introductoryEligibility`, `promotionalOffer`, `customerCenter` and `sendCancelFeedback`.
- Types for offerings, paywalls (`PaywallConfig` and `PaywallNode`), customer info, entitlements, purchase records, offers, card intents and the Customer Center.
- `RequestAuth` has a `customerToken` field, sent as `x-customer-token`.
- The purchases methods were tested against the api with fake App Store and Google Play servers. They have not run against the real stores.

## 0.1.0 (2026-11-10)

The first version on npm. It had been used from the Gemicore repository only, so the list below is everything in it rather than a diff. Store purchases (App Store, Google Play and card) are not in this version; they arrive in 0.2.0.

- Clients: `auth` (sign-up and sign-in, TOTP and backup codes, magic links, password reset and change, refresh, sessions, OpenID Connect sign-in), `payments` and `balances`, `plans`, `promoCodes`, `subscriptions` and `entitlements`, `notifications`, `devices` and `notificationPreferences`, `email` (bounce and complaint reports, marketing consent, a preference page link), `config` and `flags`.
- `RealtimeClient` with channels, presence, reconnect with backoff (a socket closed for sending too fast backs off instead of retrying at once), paced replay of subscriptions after a reconnect, a bounded token source, one retry after a stale token, and a refresh before a JWT expires, at most once per token. `subscribe` narrows messages by channel.
- `verifyAccessToken` checks a user's access token offline with Web Crypto; `verifyGemicoreSignature` checks a webhook delivery. `GemicoreWebhookDelivery` types the parsed body by event.
- `isMfaChallenge`, `oidcErrorFromUrl`, `oidcCodeFromUrl`, `createOidcPkce` and `oidcPkceChallenge` for the sign-in flows.
- `Payment` is a union on `provider`: a hosted payment has `instructions` and `cryptoProgress` set to `null`, and a crypto payment carries the transfer instructions and its progress. `cryptoProgress` never holds a payer address.
- Errors: every failed call rejects with a `GemicoreApiError` that carries the api's `code`, `details.status`, `apiDetails` and `retryAfter`. `isGemicoreApiError` recognises one thrown by either build when a process loads both.
- ESM and CommonJS builds with declarations for each, for Node 20 or later, Bun and runtimes that provide `fetch`, `AbortSignal.timeout` and Web Crypto. No runtime dependencies.
