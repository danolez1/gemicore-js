import type { GemicoreHttpClient } from "./http.ts";
import type { ListResponse, Mode, ProviderName } from "./types.ts";

// The api billing module owns these request and response shapes; the contract fixes only the paths.

export type PlanInterval = "day" | "week" | "month" | "year";

export type SubscriptionStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "expired";

/** `planView` in the api billing module. Dates arrive as ISO strings. */
export interface Plan {
  id: string;
  mode: Mode;
  code: string;
  name: string;
  description: string | null;
  amount: number;
  currency: string;
  interval: PlanInterval;
  intervalCount: number;
  trialDays: number;
  recurring: boolean;
  active: boolean;
  public: boolean;
  entitlements?: Array<{ feature: string; quota: number | null }>;
  createdAt: string;
}

/** `subscriptionView` in the api billing module. */
export interface Subscription {
  id: string;
  mode: Mode;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  gracePeriodEndsAt: string | null;
  failedPaymentCount: number;
  pendingPaymentId: string | null;
  promoCodeId: string | null;
  provider: string | null;
  createdAt: string;
}

/** `POST /v1/subscriptions` and `GET /v1/subscriptions/{id}` add the hosted checkout while one is open. */
export interface SubscriptionWithCheckout extends Subscription {
  checkoutUrl: string | null;
}

export interface SubscribeInput {
  /** Required with a secret key; with a publishable key the user token names the user. */
  userId?: string;
  planId: string;
  promoCode?: string;
  provider?: ProviderName;
  country?: string;
  successUrl: string;
  cancelUrl?: string;
}

export interface SubscribeOptions {
  /** Sent as `Idempotency-Key`. A fresh UUID is generated when omitted, so pass your own to make retries safe. */
  idempotencyKey?: string;
  /** The end user's access token; required with a publishable key. */
  userToken?: string;
}

/** A limit and remaining of -1 mean unlimited. */
export interface QuotaInfo {
  limit: number;
  used: number;
  remaining: number;
}

/** `GET /v1/entitlements`: one object for the token holder, not a list. */
export interface Entitlements {
  plan: Plan | null;
  subscription: Subscription | null;
  features: string[];
  quotas: Record<string, QuotaInfo>;
}

export interface UsageInput {
  resource: string;
  /** Positive integer, defaults to 1. */
  amount?: number;
}

/** A limit and remaining of -1 mean unlimited. */
export interface UsageReport {
  resource: string;
  limit: number;
  used: number;
  remaining: number;
}

/** An invoice as the `invoice.paid` webhook carries it; there is no public route to list or fetch invoices. */
export interface Invoice {
  id: string;
  mode: Mode;
  /** Unique per app, for example on a receipt. */
  number: string;
  subscriptionId: string;
  userId: string;
  paymentId: string | null;
  status: "open" | "paid" | "void";
  amount: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  lines: Array<Record<string, unknown>>;
  paidAt: string | null;
  createdAt: string;
}

export type PromoDiscountType = "percentage" | "fixed_amount" | "fixed_price";

/** Why a code cannot be used for the plan; `not-found`, `inactive`, `not-started` and `wrong-plan` all come with `PROMO_CODE_INVALID`. */
export type PromoRejectReason =
  | "not-found"
  | "inactive"
  | "not-started"
  | "wrong-plan"
  | "expired"
  | "exhausted";

export interface PromoResolveInput {
  code: string;
  /** The plan the person is about to subscribe to; a code can be limited to one plan. */
  planId: string;
}

/** A rejected code is an answer, not an error: the call succeeds with `valid: false` so a checkout form can explain it. */
export type PromoResolveResult =
  | {
      valid: true;
      promo: {
        code: string;
        label: string;
        discountType: PromoDiscountType;
        discountValue: number;
      };
      /** Minor units, in the plan's currency. */
      price: { basePrice: number; discountAmount: number; finalPrice: number; currency: string };
    }
  | {
      valid: false;
      reason: PromoRejectReason;
      /** `PROMO_CODE_INVALID`, `PROMO_CODE_EXPIRED` or `PROMO_CODE_EXHAUSTED`. */
      code: string;
      message: string;
    };

export class PlansClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** The active plans of the key's mode, public or not, each with its entitlements. */
  list(): Promise<ListResponse<Plan>> {
    return this.http.request("/v1/plans", { method: "GET" });
  }
}

export class SubscriptionsClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** The route refuses a call without `Idempotency-Key` (422), so one is always sent. */
  create(input: SubscribeInput, options: SubscribeOptions = {}): Promise<SubscriptionWithCheckout> {
    return this.http.request("/v1/subscriptions", {
      method: "POST",
      body: input,
      auth: {
        idempotencyKey: options.idempotencyKey || crypto.randomUUID(),
        userToken: options.userToken,
      },
    });
  }

  /** Reads a subscription, and settles a payment that has landed since the last read. An unknown id or one of the other mode is `SUBSCRIPTION_NOT_FOUND` (404). */
  retrieve(subscriptionId: string): Promise<SubscriptionWithCheckout> {
    return this.http.request(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "GET",
    });
  }

  /** Secret key only. The route takes no body, so there is nothing to pass but the id. */
  cancel(subscriptionId: string): Promise<Subscription> {
    return this.http.request(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: "POST",
    });
  }
}

export class EntitlementsClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** What the token's user may use: plan, subscription, features and quotas, or empty values for a user with no subscription. */
  list(userToken: string): Promise<Entitlements> {
    return this.http.request("/v1/entitlements", { method: "GET", auth: { userToken } });
  }

  /** Secret key only. Counts usage against the user's quota; 409 QUOTA_EXCEEDED counts nothing (D22). */
  recordUsage(userId: string, input: UsageInput): Promise<UsageReport> {
    return this.http.request(`/v1/users/${encodeURIComponent(userId)}/usage`, {
      method: "POST",
      body: input,
    });
  }
}

export class PromoCodesClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** Checks a code against a plan and prices it. Works with a publishable or a secret key. */
  resolve(input: PromoResolveInput): Promise<PromoResolveResult> {
    return this.http.request("/v1/promo-codes/resolve", { method: "POST", body: input });
  }
}
