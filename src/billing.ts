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
  /** True when `amount` is a USD anchor that is quoted in the payer's currency when they subscribe. */
  localized: boolean;
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
  /** What each period costs when the subscription was quoted in another currency, in minor units; null when the plan's own price stands. */
  priceAmount: number | null;
  priceCurrency: string | null;
  /** The USD rate the price was converted at. */
  priceRate: number | null;
  priceQuotedAt: string | null;
  provider: string | null;
  createdAt: string;
}

/** `POST /v1/subscriptions` and `GET /v1/subscriptions/{id}` add the hosted checkout while one is open. */
export interface SubscriptionWithCheckout extends Subscription {
  checkoutUrl: string | null;
}

export interface PlanChangeInput {
  planId: string;
  /** The gateway an upgrade is charged through. Falls back to the one the subscription already pays with. */
  provider?: ProviderName;
  /** Keep the card an upgrade is paid with. Same wording rule and same `AUTO_RENEW_UNAVAILABLE` (409) as on `create`. */
  saveCard?: { consentVersion: string };
}

export interface PlanChange {
  id: string;
  subscriptionId: string;
  fromPlanId: string;
  toPlanId: string;
  kind: "upgrade" | "downgrade";
  status: "awaiting_payment" | "scheduled" | "applied" | "canceled" | "blocked";
  /** Minor units still to pay; 0 for a downgrade. */
  chargeAmount: number;
  currency: string;
  /** Minor units taken off the price for the unused time of the old period. */
  creditAmount: number;
  /** The new price frozen on the subscription once paid, set when the change restarts the period. */
  quoteAmount: number | null;
  effectiveAt: string | null;
  /** Where to send the payer while `status` is `awaiting_payment`. */
  checkoutUrl: string | null;
  createdAt: string;
}

export interface PlanQuoteInput {
  /** An ISO currency code; wins over `country`. */
  currency?: string;
  /** A country name or code. Nigeria quotes naira and anywhere else dollars. */
  country?: string;
}

/** One plan priced for a payer. A localized plan converts from its USD amount; others keep their own price. */
export interface PlanQuote {
  planId: string;
  code: string;
  /** Minor units of `currency`. */
  amount: number;
  currency: string;
  /** The USD rate applied, or null when the plan's own price stands. */
  rate: number | null;
  /** The day the rate was stored, or null with no rate. */
  rateDate: string | null;
  quotedAt: string;
}

export interface SubscribeInput {
  /** Required with a secret key; with a publishable key the user token names the user. */
  userId?: string;
  planId: string;
  promoCode?: string;
  provider?: ProviderName;
  country?: string;
  /** The currency to quote a localized plan in. Leave it out and `country` decides: Nigeria pays naira, anywhere else dollars. */
  currency?: string;
  /**
   * Keep the card this first payment is made with, so later renewals charge it. Send it only when the payer ticked an unticked-by-default
   * box, and name the version of the wording they saw. Rejects with `AUTO_RENEW_UNAVAILABLE` (409) when the app has not switched cards on
   * or the gateway cannot keep a card.
   */
  saveCard?: { consentVersion: string };
  successUrl: string;
  cancelUrl?: string;
}

export interface SubscribeOptions {
  /** Sent as `Idempotency-Key`. A fresh UUID is generated when omitted, so pass your own to make retries safe. */
  idempotencyKey?: string;
  /** The end user's access token; required with a publishable key. */
  userToken?: string;
}

export interface NoticeConfirmInput {
  /** When the payer was told. */
  sentAt: Date | string;
  /** The amount the payer was told, in minor units. */
  amount: number;
  /** The end of the period the notice is for, as named in the `subscription.notice` event. */
  periodEnd: Date | string;
}

export interface NoticeConfirmed {
  subscriptionId: string;
  notifiedAt: string;
  notifiedAmount: number;
  periodEnd: string;
  /** True when this notice is enough for the saved card to be charged for that period at today's price. */
  covered: boolean;
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

/** Why a code cannot be used for the plan; `not-found`, `inactive`, `not-started`, `wrong-plan` and `currency` (a fixed-amount code on a converted price) all come with `PROMO_CODE_INVALID`. */
export type PromoRejectReason =
  | "not-found"
  | "inactive"
  | "not-started"
  | "wrong-plan"
  | "currency"
  | "expired"
  | "exhausted";

export interface PromoResolveInput {
  code: string;
  /** The plan the person is about to subscribe to; a code can be limited to one plan. */
  planId: string;
  /** Price a localized plan in this currency, as on `subscriptions.create`. Leave it out and `country` decides. */
  currency?: string;
  country?: string;
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

  /**
   * The price of each plan in the payer's currency, from `currency` or from `country`. The call rejects with `PRICE_UNAVAILABLE` (503)
   * when naira is offered and no exchange rate has ever been stored.
   */
  quote(input: PlanQuoteInput = {}): Promise<{ data: PlanQuote[] }> {
    return this.http.request("/v1/plans/quote", {
      method: "GET",
      query: { currency: input.currency, country: input.country },
    });
  }
}

export class SubscriptionsClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** The route refuses a call without `Idempotency-Key` (422), which means the SDK always sends one. */
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

  /** Reads a subscription, and settles a payment that has arrived since the last read. An unknown id or one of the other mode is `SUBSCRIPTION_NOT_FOUND` (404). */
  retrieve(subscriptionId: string): Promise<SubscriptionWithCheckout> {
    return this.http.request(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "GET",
    });
  }

  /**
   * Secret key only, for an app in email-less billing mode: tells Gemicore the payer was told about the automatic renewal that a
   * `subscription.notice` event of kind `autorenew_notice` announced. Without it no card is charged for that period.
   */
  confirmNotice(subscriptionId: string, input: NoticeConfirmInput): Promise<NoticeConfirmed> {
    return this.http.request(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/notice`, {
      method: "POST",
      body: {
        sentAt: new Date(input.sentAt).toISOString(),
        amount: input.amount,
        periodEnd: new Date(input.periodEnd).toISOString(),
      },
    });
  }

  /**
   * Needs a secret key. Moves the subscription to another plan. A dearer plan answers `awaiting_payment` with a `checkoutUrl`; a cheaper one on
   * a plain subscription is `scheduled` for the next renewal. A refusal is `PLAN_CHANGE_NOT_ALLOWED` (409, reason in `details.reason`).
   */
  changePlan(subscriptionId: string, input: PlanChangeInput): Promise<PlanChange> {
    return this.http.request(
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/plan-change`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  /** Needs a secret key. The route takes no body, which means the id is the only input. */
  cancel(subscriptionId: string): Promise<Subscription> {
    return this.http.request(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: "POST",
    });
  }
}

export class EntitlementsClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** The plan, subscription, features and quotas the token's user may use, or empty values for a user with no subscription. */
  list(userToken: string): Promise<Entitlements> {
    return this.http.request("/v1/entitlements", { method: "GET", auth: { userToken } });
  }

  /** Counts usage against the user's quota with a secret key. A 409 QUOTA_EXCEEDED answer counts nothing. */
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
