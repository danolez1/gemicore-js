import type { GemicoreHttpClient } from "./http.ts";
import type {
  Balance,
  CheckoutInput,
  CheckoutPayment,
  IdempotentOptions,
  ListResponse,
  Payment,
  Refund,
  RefundInput,
} from "./types.ts";

/** Payments, refunds and balances. Every call here needs a secret key. */
export class PaymentsClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /**
   * Creates a pending payment. For Stripe, Paystack and Flutterwave redirect the buyer to `checkoutUrl`; for `crypto` show the
   * transfer `instructions` on your own page, since `checkoutUrl` is a wallet link.
   */
  checkout(input: CheckoutInput, options: IdempotentOptions): Promise<CheckoutPayment> {
    return this.http.request("/v1/checkout", { method: "POST", body: input, auth: options });
  }

  /** Reads a payment. An id of another app or mode is `NOT_FOUND` (404). */
  retrieve(paymentId: string): Promise<Payment> {
    return this.http.request(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
  }

  /** Refunds a payment in whole (leave `amount` out) or in part. Rejects with `VALIDATION_ERROR` (422) for a payment that has not succeeded or an amount over what is left, and `CONFLICT` (409) when the key came with another amount. */
  refund(paymentId: string, input: RefundInput, options: IdempotentOptions): Promise<Refund> {
    return this.http.request(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
      method: "POST",
      body: input,
      auth: options,
    });
  }
}

export class BalancesClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** The ledger balance per currency for the key's mode, in minor units. */
  list(): Promise<ListResponse<Balance>> {
    return this.http.request("/v1/balances", { method: "GET" });
  }
}
