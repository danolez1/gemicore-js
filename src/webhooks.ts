/**
 * Webhook signature helpers for Gemicore outbound deliveries.
 *
 * Mirrors the platform signer: `X-Gemicore-Signature: sha256=<hex>` where the HMAC-SHA256 input is
 * `${X-Gemicore-Timestamp}.${rawBody}`. Deliveries also carry the same values as `X-Keel-*` headers
 * during the transition, and the verifier reads either set. Constants are re-declared, not imported, so the published
 * SDK has no runtime dependency; tests pin the scheme string and the event list to `@gemicore/contracts` and the
 * header names to what `buildDeliveryHeaders` in `@gemicore/core` really sends.
 */

export const GEMICORE_SIGNATURE_SCHEME =
  'X-Gemicore-Signature: sha256=hex(HMAC-SHA256(secret, X-Gemicore-Timestamp + "." + rawBody))';

/** Headers Gemicore sets on every webhook delivery. */
export const GemicoreWebhookHeader = {
  SIGNATURE: "X-Gemicore-Signature",
  EVENT: "X-Gemicore-Event",
  DELIVERY_ID: "X-Gemicore-Delivery-ID",
  TIMESTAMP: "X-Gemicore-Timestamp",
} as const;

// compat: receivers written against the old header names keep verifying.
/** @deprecated Sent alongside the X-Gemicore-* headers during the transition. */
export const LegacyKeelWebhookHeader = {
  SIGNATURE: "X-Keel-Signature",
  EVENT: "X-Keel-Event",
  DELIVERY_ID: "X-Keel-Delivery-ID",
  TIMESTAMP: "X-Keel-Timestamp",
} as const;

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export const GemicoreWebhookEvent = {
  PAYMENT_SUCCEEDED: "payment.succeeded",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_DISPUTED: "payment.disputed",
  REFUND_SUCCEEDED: "refund.succeeded",
  REFUND_FAILED: "refund.failed",
  SUBSCRIPTION_CREATED: "subscription.created",
  SUBSCRIPTION_RENEWED: "subscription.renewed",
  SUBSCRIPTION_REACTIVATED: "subscription.reactivated",
  SUBSCRIPTION_PLAN_CHANGED: "subscription.plan_changed",
  SUBSCRIPTION_NOTICE: "subscription.notice",
  SUBSCRIPTION_PAST_DUE: "subscription.past_due",
  SUBSCRIPTION_CANCELED: "subscription.canceled",
  SUBSCRIPTION_EXPIRED: "subscription.expired",
  INVOICE_PAID: "invoice.paid",
  EMAIL_BOUNCED: "email.bounced",
  EMAIL_COMPLAINED: "email.complained",
  POST_PUBLISHED: "post.published",
  POST_UPDATED: "post.updated",
  POST_UNPUBLISHED: "post.unpublished",
  PURCHASE_CREATED: "purchase.created",
  PURCHASE_RENEWED: "purchase.renewed",
  PURCHASE_CANCELED: "purchase.canceled",
  PURCHASE_UNCANCELED: "purchase.uncanceled",
  PURCHASE_BILLING_ISSUE: "purchase.billing_issue",
  PURCHASE_EXPIRED: "purchase.expired",
  PURCHASE_REFUNDED: "purchase.refunded",
  PURCHASE_REVOKED: "purchase.revoked",
  PURCHASE_PRODUCT_CHANGED: "purchase.product_changed",
  PURCHASE_TRANSFERRED: "purchase.transferred",
} as const;
export type GemicoreWebhookEvent = (typeof GemicoreWebhookEvent)[keyof typeof GemicoreWebhookEvent];

/** Delivery body as sent by Gemicore. */
export interface GemicoreWebhookPayload<T = unknown> {
  event: GemicoreWebhookEvent;
  data: T;
  webhook_id: string;
  delivery_id: string;
  /** Not the signed value: verification uses the X-Gemicore-Timestamp header. */
  timestamp: string;
}

/** Default replay window in seconds. */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Sign a webhook body the way Gemicore does.
 * Returns `sha256={hex}` format for the X-Gemicore-Signature header.
 */
export async function signGemicorePayload(
  timestamp: string | number,
  rawBody: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );

  const hex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256=${hex}`;
}

export interface VerifyGemicoreSignatureInput {
  /** The request body exactly as received; re-serialized JSON will not verify. */
  rawBody: string;
  /** `X-Gemicore-Signature` (or legacy `X-Keel-Signature`) header value. Optional when `headers` is given. */
  signature?: string | null | undefined;
  /** `X-Gemicore-Timestamp` (or legacy `X-Keel-Timestamp`) header value, unix seconds. Optional when `headers` is given. */
  timestamp?: string | null | undefined;
  /** The request headers; the signature and timestamp are read from the new names, then the old ones. */
  headers?: HeaderBag;
  secret: string;
  /** Maximum age (either direction) of the timestamp. Defaults to 300 seconds. */
  toleranceSeconds?: number;
  /** Clock override for tests, unix milliseconds. */
  now?: number;
}

/**
 * Verify an X-Gemicore-Signature header (or the legacy X-Keel-Signature) against the timestamp, body and secret.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyGemicoreSignature(
  input: VerifyGemicoreSignatureInput,
): Promise<boolean> {
  const { rawBody, secret } = input;
  const { headers } = input;
  const signature =
    input.signature ??
    (headers &&
      (readHeader(headers, GemicoreWebhookHeader.SIGNATURE) ??
        readHeader(headers, LegacyKeelWebhookHeader.SIGNATURE)));
  const timestamp =
    input.timestamp ??
    (headers &&
      (readHeader(headers, GemicoreWebhookHeader.TIMESTAMP) ??
        readHeader(headers, LegacyKeelWebhookHeader.TIMESTAMP)));
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false;

  const tolerance = input.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) return false;

  const expected = await signGemicorePayload(timestamp, rawBody, secret);
  if (expected.length !== signature.length) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signature);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// compat: the SDK export name before the rename.
/** @deprecated Use verifyGemicoreSignature. */
export const verifyKeelSignature = verifyGemicoreSignature;
