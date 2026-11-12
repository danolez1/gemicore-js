# Changelog

All notable changes to `@gemicore/sdk`. The package follows semantic versioning: while the version is below 1.0, a minor bump may change a method or a type.

## 0.3.0 (2026-11-12)

These are the billing methods an app needs to sell one subscription in several currencies. None has run against a real payment gateway.

### Added

- `gemicore.auth.upsertUser(externalId, { email })` creates or updates the user your own system knows by `externalId`. You do not store Gemicore's user id.
- `gemicore.plans.quote({ currency, country })` lists what each plan costs in the payer's currency, with the rate and the day it was taken.
- A plan is quoted only when it is marked localized.
- `gemicore.plans.quote` rejects with `PRICE_UNAVAILABLE` (503) when the payer's currency is offered and no rate has ever been stored.
- `gemicore.subscriptions.create` takes `currency` and `saveCard: { consentVersion }`.
- `saveCard` rejects with `AUTO_RENEW_UNAVAILABLE` (409) when the app has not switched cards on.
- A `Subscription` has `priceAmount`, `priceCurrency`, `priceRate` and `priceQuotedAt`, the price frozen when it was created.
- `gemicore.subscriptions.changePlan(id, { planId, provider, saveCard })` moves a subscription to another plan. It answers with a `checkoutUrl` while it waits for payment.
- Between localized plans, or on a frozen price, a dearer plan starts a new period today.
- The price of that new period is a fresh quote, less the unused time of the old plan.
- A cheaper plan on a frozen price rejects with `PLAN_CHANGE_NOT_ALLOWED` (409), with the reason in `details.reason`.
- `gemicore.promoCodes.resolve` takes `currency` and `country` and prices a localized plan for the payer's currency.
- A fixed-amount code on a converted price answers `valid: false` with reason `currency`.
- `gemicore.subscriptions.confirmNotice(id, { sentAt, amount, periodEnd })` is for an app that sends billing mail itself.
- Gemicore sends the `subscription.notice` event to the app and no email. A saved card is charged only after the app confirms the notice.

## 0.2.1 (2026-11-11)

Use 0.2.1 or later, and read the 0.2.0 entry below for the methods in the purchases client.

### Fixed

- `gemicore.purchases` was `undefined` after `npm install`, because 0.2.0 was published with the compiled files of 0.1.0.
- The code of 0.2.0 was in the `src` folder of the package anyway. 0.2.1 has the same code, built before publishing.
- `npm publish` runs `prepublishOnly`. That script rebuilds `dist`.
- `tests/publishing.test.ts` fails when `prepublishOnly` is missing.

## 0.2.0 (2026-11-10)

Store purchases were added in this version, though its npm package has no purchases client (see 0.2.1).

The purchases methods were tested against the api with fake App Store and Google Play servers. They have not run against the real stores.

### Added

- `gemicore.purchases` has 21 methods, one for every route of the purchases API.
- `tests/openapi-parity.test.ts` fails when a route in the OpenAPI document has no method and is not on its list of exclusions.
- For your backend, with a secret key: `retrieveCustomer`, `grantEntitlement`, `revokeEntitlement` and `importPurchases`.
- For a device, with a publishable key and the `customerToken` that `createCustomer` returns: `logIn`, `logOut`, `customerInfo`, `setAttributes`, `setConsumptionConsent`, `products`, `offerings` and `offers`.
- Also for a device: `recordPurchase`, `restore`, `checkout`, `checkoutIntent`, `introductoryEligibility`, `promotionalOffer`, `customerCenter` and `sendCancelFeedback`.
- Types for offerings, paywalls (`PaywallConfig` and `PaywallNode`), customer info, entitlements, purchase records, offers, card intents and the Customer Center.
- `RequestAuth` has a `customerToken` field. The field is sent as `x-customer-token`.

## 0.1.0 (2026-11-10)

This is the first version on npm. It had been used from the Gemicore repository only. The list below covers everything in it.

Store purchases (App Store, Google Play and card) are not in this version, and they arrive in 0.2.0.

### Added

- Clients for `payments`, `balances`, `plans`, `promoCodes`, `subscriptions` and `entitlements`.
- Clients for `notifications`, `devices`, `notificationPreferences`, `config` and `flags`.
- An `auth` client for sign-up and sign-in, TOTP and backup codes, magic links, password reset and change, refresh, sessions and OpenID Connect sign-in.
- An `email` client for bounce and complaint reports, marketing consent and a preference page link.
- `RealtimeClient` with channels and presence. `subscribe` narrows messages by channel.
- `RealtimeClient` reconnects with backoff. A socket closed for sending too fast backs off before it retries.
- `RealtimeClient` replays subscriptions at a paced rate after a reconnect, and it has a bounded token source.
- `RealtimeClient` retries once after a stale token. It refreshes before a JWT expires, at most once per token.
- `verifyAccessToken` checks a user's access token offline with Web Crypto.
- `verifyGemicoreSignature` checks a webhook delivery.
- `GemicoreWebhookDelivery` types the parsed body by event.
- `isMfaChallenge`, `oidcErrorFromUrl`, `oidcCodeFromUrl`, `createOidcPkce` and `oidcPkceChallenge` for the sign-in flows.
- `Payment` is a union on `provider`. A hosted payment has `instructions` and `cryptoProgress` set to `null`.
- A crypto payment has the transfer instructions and its progress. `cryptoProgress` has no payer address.
- Every failed call rejects with a `GemicoreApiError`. It has the api's `code`, `details.status`, `apiDetails` and `retryAfter`.
- `isGemicoreApiError` recognises a `GemicoreApiError` thrown by either build when a process loads both.
- ESM and CommonJS builds with declarations for each, with no runtime dependencies.
- The builds run on Node 20 or later, Bun and runtimes that provide `fetch`, `AbortSignal.timeout` and Web Crypto.
