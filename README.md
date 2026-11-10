# @gemicore/sdk

The TypeScript client for a Gemicore api: app user sign in, checkout and refunds, plans and subscriptions, config and feature flags, notifications, realtime, and webhook signature checks. It has no runtime dependencies. It needs a global `fetch`, `AbortSignal.timeout` and Web Crypto, so Bun, Node 20 or later, or an edge runtime. It is built as ES modules and CommonJS with declarations for both. The tests run under Bun and Node 26; Node 20 and 22 and worker runtimes have not been tried. The declarations are checked with TypeScript 6.0 only, as a NodeNext ES module project, a NodeNext CommonJS project and a `moduleResolution: bundler` project. They use template literal types and import their sibling files with `.ts` extensions, so older compilers may reject them; no older version has been tried.

## Install

```sh
npm install @gemicore/sdk
```

`import` gets the ES module build and `require` gets the CommonJS build, each with its declarations. The source is at [github.com/danolez1/gemicore-js](https://github.com/danolez1/gemicore-js).

## What is in the box

| Client | Methods |
|---|---|
| `gemicore.auth` | sign up and in, TOTP and backup codes, magic links, password reset and change, refresh, sessions, OpenID Connect sign-in |
| `gemicore.payments`, `gemicore.balances` | checkout, retrieve, refund, ledger balances |
| `gemicore.plans`, `gemicore.promoCodes`, `gemicore.subscriptions`, `gemicore.entitlements` | plans, promo pricing, subscriptions, entitlements and usage |
| `gemicore.notifications`, `gemicore.devices`, `gemicore.notificationPreferences` | send, inbox, push devices, per-category switches |
| `gemicore.email` | bounce and complaint reports, marketing consent, a link to the preference page |
| `gemicore.config`, `gemicore.flags` | read-only config and feature flags |
| `RealtimeClient` | channels, presence, reconnect |
| `verifyAccessToken`, `verifyGemicoreSignature` | check a user's access token or a webhook delivery without calling Gemicore |

Every method and its signature is on the generated method reference at https://gemicore.com/docs/reference/sdk-reference.

## Create a client

```ts
import { Gemicore, isMfaChallenge } from "@gemicore/sdk";

const gemicore = new Gemicore({
  apiKey: process.env.GEMICORE_SECRET_KEY!, // sk_test_... on your server, pk_test_... in a browser
  baseUrl: "https://api.example.com",
});

const app = await gemicore.app(); // { id, slug, name, mode, keyKind }

const result = await gemicore.auth.login({ email, password });
const session = isMfaChallenge(result) ? await gemicore.auth.loginTotp(result.challengeToken, code) : result;
const flags = await gemicore.flags.list(); // { "checkout-v2": true }
const config = await gemicore.config.get(); // secret key only

const payment = await gemicore.payments.checkout(
  { amount: 10_000, currency: "USD", customer: { email }, successUrl },
  { idempotencyKey: orderId },
);
// Stripe, Paystack, Flutterwave: send the buyer to payment.checkoutUrl.
// provider "crypto": show payment.instructions (address, amount, chain) on your own page.
```

Calls made for one end user can carry that user's IP, so Gemicore's per-IP limits count the user and not your server: `gemicore.withClientIp(ip).auth.login(...)`. Only a secret key is trusted with it.

## Sign in through an OpenID Connect provider

With a publishable key in the browser (`browserGemicore` is `new Gemicore({ apiKey: "pk_live_xxx", baseUrl })`):

```ts
import { createOidcPkce, OidcErrorCode, oidcErrorFromUrl } from "@gemicore/sdk";

const providers = await browserGemicore.auth.oidcProviders(); // [{ providerKey: "google", displayName: "Google" }]

// Before leaving the page: a fresh PKCE pair and state, kept in this tab only.
const { codeVerifier, codeChallenge } = await createOidcPkce();
const state = crypto.randomUUID();
sessionStorage.setItem("gemicore_oidc", JSON.stringify({ codeVerifier, state }));
location.href = browserGemicore.auth.oidcStartUrl("google", {
  redirect: "https://shop.example.com/signed-in", // must be one of the app's redirect URLs
  state, // comes back unchanged
  codeChallenge,
});

// On /signed-in: ?gemicore_code=...&state=... or ?error=OIDC_...
const params = new URL(location.href).searchParams;
const saved = JSON.parse(sessionStorage.getItem("gemicore_oidc") ?? "null");
sessionStorage.removeItem("gemicore_oidc");
const code = params.get("gemicore_code");
if (code && saved && params.get("state") === saved.state) {
  const result = await browserGemicore.auth.oidcExchange(code, saved.codeVerifier); // tokens, or an MFA challenge
}
const refusal = oidcErrorFromUrl(location.href); // { code, reason, state } or null
if (refusal?.code === OidcErrorCode.OIDC_SIGNUP_CLOSED) {
  /* ... */
}
```

`oidcStartUrl` only builds the URL. It throws `GemicoreConfigError` with a secret key, since the key goes in the query string, and when `redirect` or `codeChallenge` is missing. `createOidcPkce` uses Web Crypto, so it runs in browsers and in Bun. The `gemicore_code` works once and for 60 seconds, and only with the verifier whose challenge started the sign-in; a wrong verifier, a second try or a late one all answer `OIDC_CODE_INVALID`, and a wrong verifier spends the code. For now the redirect also carries the same code as `keel_code`; `oidcCodeFromUrl(url)` reads either name. `oidcErrorFromUrl(url)` reads a refusal (`error`, `error_reason` and `state`) and returns `null` when there is none. `createOidcPkce` is all most pages need; `oidcPkceChallenge(verifier)` is the S256 step on its own, for a page that keeps its own verifier.

## Verify an access token

Your own backend can check the access token a user sends it without calling Gemicore. The SDK does it with Web Crypto and fetches the public keys from `/.well-known/jwks.json` on the issuer:

```ts
import { AccessTokenError, verifyAccessToken } from "@gemicore/sdk";

export async function userOf(accessToken: string) {
  try {
    const { userId, sessionId } = await verifyAccessToken(accessToken, {
      issuer: process.env.GEMICORE_ISSUER!, // your instance's AUTH_ISSUER
      appId: process.env.GEMICORE_APP_ID!, // from gemicore.app()
    });
    return { userId, sessionId };
  } catch (error) {
    if (error instanceof AccessTokenError && error.reason !== "jwks_unavailable") return null;
    throw error;
  }
}
```

It accepts ES256 tokens with `typ` `at+jwt` and nothing else, and checks the signature, `iss`, `aud`, `exp` and `nbf` (10 seconds of clock difference are forgiven). Keys are cached for 5 minutes, and a token with an unknown `kid` makes one new fetch at most every 10 seconds, which is how a key rotation reaches you. A local check cannot see a session that was revoked after the token was issued; keep access tokens short or call `gemicore.auth.me(accessToken)` before a sensitive action.

## Verify a webhook

Read the raw body before any JSON parsing, then check the signature and the timestamp:

```ts
import { GemicoreWebhookHeader, verifyGemicoreSignature } from "@gemicore/sdk";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ok = await verifyGemicoreSignature({
    rawBody,
    signature: request.headers.get(GemicoreWebhookHeader.SIGNATURE),
    timestamp: request.headers.get(GemicoreWebhookHeader.TIMESTAMP),
    secret: process.env.GEMICORE_WEBHOOK_SECRET!,
  });
  if (!ok) return new Response("bad signature", { status: 400 });
  const event = JSON.parse(rawBody);
}
```

Each delivery also carries the old `X-Keel-*` headers for now. Pass `headers: request.headers` instead of `signature` and `timestamp` and the verifier reads the `X-Gemicore-*` names first and the old ones second. `verifyKeelSignature` stays exported as a deprecated alias of `verifyGemicoreSignature`.

A timestamp more than 300 seconds away from now fails by default (`toleranceSeconds` changes it). Deduplicate on `event.delivery_id`, since retries and replays carry the same one.

## Follow a payment live

`RealtimeClient` follows a payment from the buyer's page with only the `statusToken` that `checkout` returned. `subscribe` narrows the message by channel, and `ready` says when a socket came back, because events missed while it was down are not replayed:

```ts
import { RealtimeClient } from "@gemicore/sdk";

const rt = new RealtimeClient({
  baseUrl: "https://api.example.com",
  publishableKey: "pk_live_xxx",
  checkoutToken: payment.statusToken,
});
rt.subscribe(`payment:${payment.id}`, (message) => {
  if (message.type === "payment.succeeded") showReceipt(message.data.id, message.data.amount);
});
rt.on("ready", ({ reconnected }) => {
  if (reconnected) void refetchPayment();
});
rt.connect();
```

A `token` function gets 5 seconds to answer, a stale token that the server refuses with 4001 is replaced once, and a JWT is swapped 30 seconds before it expires. Webhook deliveries are typed too: `JSON.parse(rawBody) as GemicoreWebhookDelivery` narrows `delivery.data` by `delivery.event`.

## Record marketing consent

With a live mode secret key, tell Gemicore what a person agreed to. A grant has to carry the exact label they were shown, and the types enforce it; a withdrawal does not need one. `topic` defaults to `marketing`.

```ts
await gemicore.email.recordConsent({
  email,
  state: "granted",
  wording: "Email me product news",
  topic: "product-news",
});
await gemicore.email.recordConsent({ email, state: "withdrawn", topic: "product-news" });
```

## Errors

Every failed call throws a `GemicoreApiError` with the api's error `code` and `details.status`: a non-2xx answer, a 2xx answer whose body is not JSON, a failed connection and a timeout. A network failure has code `NETWORK_ERROR` and a timeout `TIMEOUT`, both with status 0 when no response came back; their message names only the kind of failure, never the runtime's own text. If a 2xx response starts and its body then stalls or breaks off, the same two codes are used with the status that arrived. If a non-2xx response does, you get `INTERNAL_ERROR` with that response's status, because there is no error body to read. `error.apiDetails` is the api's own error details, and `error.retryAfter` is the seconds to wait on a 429 (from the `Retry-After` header, else the api's value). A missing `apiKey` or `baseUrl`, a key with a control character such as a line break, or a `timeout` that is not a whole number of milliseconds from 1 to 2147483647, throws `GemicoreConfigError` from the constructor; a user token or idempotency key with a control character is refused the same way before anything is sent.

```ts
import { GemicoreApiError, GemicoreErrorCode } from "@gemicore/sdk";

try {
  await gemicore.entitlements.recordUsage(userId, { resource: "exports" });
} catch (error) {
  if (error instanceof GemicoreApiError && error.code === GemicoreErrorCode.QUOTA_EXCEEDED) {
    // over the plan's quota; nothing was counted
  }
  throw error;
}
```

`GemicoreErrorCode` lists the codes an app developer can meet; the SDK reference page has the full table.

If one process can load both builds of the package (an ES module app that also pulls in a CommonJS dependency which calls `require("@gemicore/sdk")`, for example), each build has its own `GemicoreApiError` class. An error thrown by one build is then not an `instanceof` the other build's class, and the same holds for `AccessTokenError` and `GemicoreConfigError`. `isGemicoreApiError(error)` checks the error's name and shape instead of its class, so it answers true for both builds. The sample above is fine when your code imports the package one way only; use `isGemicoreApiError` when you are not sure.

## Changes

- 2026-10-26: `verifyAccessToken(token, { issuer, appId })` checks an access token offline. `isMfaChallenge(result)` and `oidcErrorFromUrl(url)` are new. `Payment` is now a union you narrow on `provider`: `metadata` is never null, `instructions` and `cryptoProgress` are always present (`null` unless the payment is crypto), and `CheckoutPayment` is `Payment & { statusToken }`. `cryptoProgress` no longer carries `refundTo`, `refundBlocked` or `payers`.
- 2026-10-25: `GemicoreApiError` has `retryAfter` and `apiDetails`, a 2xx answer with an unreadable body throws a `GemicoreApiError` instead of a `SyntaxError`, and `timeout` is checked in the constructor. `GemicoreErrorCode` lists every public error code. `promoCodes.resolve` takes `{ code, planId }` and returns a `PromoResolveResult`, `subscriptions.cancel` takes only the id, `email.recordConsent` takes a `topic` and requires `wording` to grant, and `notifications.send` takes `userId` or `userIds`, not both. Deliveries carry `deliveredDevices`.
- 2026-10-03: `gemicore.auth.oidcProviders()`, `gemicore.auth.oidcStartUrl(provider, { redirect, state?, codeChallenge })` and `gemicore.auth.oidcExchange(code, codeVerifier)` sign users in through an external OpenID Connect provider, `createOidcPkce()` makes the PKCE pair between the app page and Gemicore, and `OidcErrorCode` lists the `OIDC_*` error codes.
- 2026-10-09: `gemicore.email.reportBounce(...)` and `gemicore.email.reportComplaint(...)` file a bounce or a spam complaint for an address (secret key only, idempotent by `eventId`). At that date they were the only email methods; `recordConsent` and `preferencesLink` came later.
- 2026-10-03: `gemicore.email` is gone. `unsubscribeStatus` and `unsubscribe` called routes that answer with HTML pages for people, so they always failed; the links in Gemicore's emails open those pages directly. `gemicore.subscriptions.create(input, { idempotencyKey?, userToken? })` now always sends an `Idempotency-Key` (a random UUID when none is given). `gemicore.entitlements.list` returns the route's single `{ plan, subscription, features, quotas }` object. `gemicore.config.get()` and `gemicore.flags.list()` are new.

The full reference is the SDK page of the Gemicore docs: https://gemicore.com/docs/reference/sdk.
