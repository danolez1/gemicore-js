import type { FetchLike } from "./http.ts";

/** Default per-request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Configuration for a {@link Gemicore} client instance. */
export interface GemicoreConfig {
  /** App key (`sk_test_...`, `sk_live_...`, or a publishable `pk_*` key). Sent as `Authorization: Bearer`. */
  apiKey: string;
  /** API base URL, for example `https://api.example.com`. Required: Gemicore has no public default host. */
  baseUrl: string;
  /** Per-request timeout in milliseconds. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeout?: number;
  /** Custom `fetch`, for edge runtimes and tests. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /**
   * The end user's IP, forwarded as `X-Gemicore-Client-IP`. Only a secret key is trusted with it; with a
   * publishable key Gemicore ignores the header. Prefer {@link Gemicore.withClientIp} to set it per request.
   */
  clientIp?: string;
}

export type Mode = "test" | "live";

/** List responses: `{ data, pagination? }` (contract 5.6). */
export interface ListResponse<T> {
  data: T[];
  pagination?: { page: number; pageSize: number; total: number };
}

/** `GET /v1/app`: the app the key belongs to. */
export interface AppInfo {
  id: string;
  slug: string;
  name: string;
  mode: Mode;
  keyKind: "publishable" | "secret";
}

export interface AppUser {
  id: string;
  email: string;
  totpEnabled: boolean;
}

/** A signed-in session: short-lived access token plus a rotating refresh token. */
export interface TokenResponse {
  user: AppUser;
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

/** Login answer when the user has TOTP on; finish with `auth.loginTotp`. */
export interface MfaChallenge {
  mfaRequired: true;
  challengeToken: string;
}

export interface Credentials {
  email: string;
  password: string;
}

/** The optional marketing box on a sign-up form. A ticked box is only a request: the person still has to click the link in the confirmation mail. */
export interface SignupConsent {
  marketingConsent?: boolean;
  /** The exact label shown next to the box, up to 200 characters. */
  consentWording?: string;
}

export type PaymentStatus = "pending" | "succeeded" | "failed";
export type ProviderName = "stripe" | "paystack" | "flutterwave" | "crypto";

/** Crypto payments only: send exactly `amount` of `asset` to `address` on `chain`. */
export interface TransferInstructions {
  kind: "crypto_transfer";
  chain: string;
  chainId: number;
  asset: "USDC";
  tokenContract: string;
  address: string;
  /** Decimal dollars, six places. */
  amount: string;
  /** The same amount as an integer count of the token's smallest unit, as text. */
  amountBaseUnits: string;
  decimals: number;
  confirmationsRequired: number;
}

/** Crypto payments only: what has arrived so far, in base units as text. Never carries a payer address. */
export interface CryptoProgress {
  receivedBaseUnits: string;
  pendingBaseUnits?: string;
  shortfallBaseUnits?: string;
  excessBaseUnits?: string;
  excessCreditedCents?: number;
  excessLedgerEntryId?: string;
}

interface PaymentBase {
  id: string;
  status: PaymentStatus;
  mode: Mode;
  /** Minor units. */
  amount: number;
  refundedAmount: number;
  currency: string;
  description: string | null;
  /** The metadata you sent, or an empty object. */
  metadata: Record<string, string>;
  paidAt: string | null;
  createdAt: string;
}

/** A payment taken on a hosted page of Stripe, Paystack or Flutterwave. */
export interface HostedPayment extends PaymentBase {
  provider: Exclude<ProviderName, "crypto">;
  /** The provider's hosted page; send the buyer there. Null for a payment that has no page, such as a saved card charge. */
  checkoutUrl: string | null;
  instructions: null;
  cryptoProgress: null;
}

/** A USDC payment: the buyer sends the transfer themselves, so show `instructions` on your own page. */
export interface CryptoPayment extends PaymentBase {
  provider: "crypto";
  /** An EIP-681 wallet link (`ethereum:...`), not a web page. A browser cannot open it without a wallet, so offer it as a button next to `instructions`. */
  checkoutUrl: string | null;
  instructions: TransferInstructions | null;
  /** Null until the first deposit is seen. */
  cryptoProgress: CryptoProgress | null;
}

/** `GET /v1/payments/{id}`. Narrow on `provider` to reach the crypto fields. */
export type Payment = HostedPayment | CryptoPayment;

/** What `POST /v1/checkout` returns: the payment plus a token its buyer's page can watch it with. */
export type CheckoutPayment = Payment & {
  /** Pass to `RealtimeClient` as `checkoutToken` to receive `payment:<id>` events without a user token. */
  statusToken: string;
};

export interface CheckoutInput {
  /** Minor units (cents, kobo). */
  amount: number;
  /** ISO 4217, upper case. */
  currency: string;
  provider?: ProviderName;
  country?: string;
  customer: { email: string; name?: string; externalId?: string };
  description?: string;
  metadata?: Record<string, string>;
  successUrl: string;
  cancelUrl?: string;
}

export interface Refund {
  id: string;
  paymentId: string;
  status: "pending" | "succeeded" | "failed";
  amount: number;
  currency: string;
  reason: string | null;
  createdAt: string;
}

export interface RefundInput {
  /** Minor units; omit to refund the remaining balance. */
  amount?: number;
  reason?: string;
}

export interface Balance {
  currency: string;
  available: number;
}

/** Idempotency key for a write; reuse the same key to retry safely. */
export interface IdempotentOptions {
  idempotencyKey: string;
}

/** Billing and email shapes are not fixed by the contract, so fields stay open. */
export type JsonObject = Record<string, unknown>;
