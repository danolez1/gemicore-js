# Changelog

All notable changes to `@gemicore/sdk`. The package follows semantic versioning: while the version is below 1.0, a minor bump may change a method or a type.

## Unreleased

These are the billing methods an app needs to sell one subscription in several currencies. None of them has run against a real payment gateway.

### Added

- `gemicore.auth.upsertUser(externalId, { email })` creates or updates the user that your own system knows by `externalId`, so you do not store Gemicore's user id.
- `gemicore.plans.quote({ currency, country })` lists what each plan costs in the payer's currency, with the rate and the day it was taken.
  - A plan is quoted only when it is marked localized.
  - It rejects with `PRICE_UNAVAILABLE` (503) when the payer's currency is offered and no rate has ever been stored.
- `gemicore.subscriptions.create` takes `currency` and `saveCard: { consentVersion }`.
  - `saveCard` rejects with `AUTO_RENEW_UNAVAILABLE` (409) when the app has not switched cards on.
  - A `Subscription` now carries `priceAmount`, `priceCurrency`, `priceRate` and `priceQuotedAt`, the price frozen when it was created.
- `gemicore.subscriptions.changePlan(id, { planId, provider, saveCard })` moves a subscription to another plan and answers the change with a `checkoutUrl` while it waits for payment.
  - Between localized plans, or on a frozen price, a dearer plan starts a new period today at a fresh quote, less the unused time of the old one.
  - A cheaper plan on a frozen price rejects with `PLAN_CHANGE_NOT_ALLOWED` (409), whose reason is in `details.reason`.
- `gemicore.promoCodes.resolve` takes `currency` and `country`, so a localized plan is priced in the payer's currency and a fixed-amount code on a converted price answers `valid: false` with reason `currency`.
- `gemicore.subscriptions.confirmNotice(id, { sentAt, amount, periodEnd })` is for an app that sends billing mail itself.
  - Gemicore sends the `subscription.notice` event to the app and no email, and a saved card is charged only after the app confirms the notice.

## 0.2.1 (2026-11-11)

Use 0.2.1 or later, and read the 0.2.0 entry below for the methods in the purchases client.

### Fixed

- `gemicore.purchases` was `undefined` after `npm install`, because 0.2.0 was published with the compiled files of 0.1.0.
  - The code of 0.2.0 was in the `src` folder of the package anyway.
  - 0.2.1 has the same code, built before publishing.
- `npm publish` runs `prepublishOnly`. That script rebuilds `dist`.
  - `tests/publishing.test.ts` fails when that script is missing.

## 0.2.0 (2026-11-10)

Store purchases were added in this version, though its npm package has no purchases client (see 0.2.1).

The purchases methods were tested against the api with fake App Store and Google Play servers, and they have not run against the real stores.

### Added

- `gemicore.purchases` has 21 methods, one for every route of the purchases API.
  - `tests/openapi-parity.test.ts` fails when a route in the OpenAPI document has no method and is not on its list of exclusions.
- These `gemicore.purchases` methods are for your backend, with a secret key.
  - `retrieveCustomer`, `grantEntitlement`, `revokeEntitlement` and `importPurchases`.
- These `gemicore.purchases` methods are for a device, with a publishable key and the `customerToken` that `createCustomer` returns.
  - `logIn`, `logOut`, `customerInfo`, `setAttributes`, `setConsumptionConsent`, `products`, `offerings` and `offers`.
  - `recordPurchase`, `restore`, `checkout`, `checkoutIntent`, `introductoryEligibility` and `promotionalOffer`.
  - `customerCenter` and `sendCancelFeedback`.
- Types for offerings, paywalls (`PaywallConfig` and `PaywallNode`), customer info, entitlements, purchase records, offers, card intents and the Customer Center.
- `RequestAuth` has a `customerToken` field.
  - The field is sent as `x-customer-token`.

## 0.1.0 (2026-11-10)

This is the first version on npm. It had been used from the Gemicore repository only. The list below covers everything in it.

Store purchases (App Store, Google Play and card) are not in this version, and they arrive in 0.2.0.

### Added

- Clients for the main API areas.
  - `auth`: sign-up and sign-in, TOTP and backup codes, magic links, password reset and change, refresh, sessions, OpenID Connect sign-in.
  - `payments`, `balances`, `plans`, `promoCodes`, `subscriptions` and `entitlements`.
  - `notifications`, `devices`, `notificationPreferences`, `config` and `flags`.
  - `email`: bounce and complaint reports, marketing consent, a preference page link.
- `RealtimeClient` with channels and presence.
  - It reconnects with backoff, and a socket closed for sending too fast backs off before it retries.
  - It replays subscriptions at a paced rate after a reconnect, and it has a bounded token source.
  - It retries once after a stale token and refreshes before a JWT expires, at most once per token.
  - `subscribe` narrows messages by channel.
- `verifyAccessToken` checks a user's access token offline with Web Crypto.
- `verifyGemicoreSignature` checks a webhook delivery.
- `GemicoreWebhookDelivery` types the parsed body by event.
- `isMfaChallenge`, `oidcErrorFromUrl`, `oidcCodeFromUrl`, `createOidcPkce` and `oidcPkceChallenge` for the sign-in flows.
- `Payment` is a union on `provider`.
  - A hosted payment has `instructions` and `cryptoProgress` set to `null`.
  - A crypto payment has the transfer instructions and its progress.
  - `cryptoProgress` has no payer address.
- Errors: every failed call rejects with a `GemicoreApiError`.
  - It has the api's `code`, `details.status`, `apiDetails` and `retryAfter`.
  - `isGemicoreApiError` recognises one thrown by either build when a process loads both.
- ESM and CommonJS builds with declarations for each, with no runtime dependencies.
  - They run on Node 20 or later, Bun and runtimes that provide `fetch`, `AbortSignal.timeout` and Web Crypto.
