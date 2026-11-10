// Types only. The shapes are the ones the api stages in `settlement.service.ts`, `billing/views.ts` and
// `email/bounce.service.ts`; tests/events-api.test.ts compares them to what a running api really sends.
import type { Invoice, Subscription } from "./billing.ts";
import type { InboxNotification } from "./notifications.ts";
import type { PresenceMember } from "./presence.ts";
import type { PaymentStatus, ProviderName } from "./types.ts";
import type { GemicoreWebhookPayload } from "./webhooks.ts";

/** Why a payment failed; present on `payment.failed` and absent on `payment.succeeded`. */
export type PaymentFailureReason = "declined" | "expired";

/** `payment.succeeded` and `payment.failed`: a payment at the moment it settled. */
export interface PaymentEventData {
  id: string;
  status: PaymentStatus;
  /** Minor units. */
  amount: number;
  refundedAmount: number;
  currency: string;
  provider: ProviderName;
  metadata: Record<string, string>;
  failureReason?: PaymentFailureReason;
}

export type DisputeStage = "opened" | "won" | "lost";

/** `payment.disputed`: the payment plus the dispute. A lost dispute reverses the money like a refund. */
export interface PaymentDisputedEventData extends PaymentEventData {
  dispute: { id: string; status: DisputeStage; amount: number; currency: string };
}

/** `refund.succeeded` and `refund.failed`. */
export interface RefundEventData {
  id: string;
  paymentId: string;
  status: "pending" | "succeeded" | "failed";
  amount: number;
  currency: string;
}

/** `subscription.created`, `renewed`, `reactivated`, `past_due`, `canceled` and `expired`: the subscription as the api returns it. */
export type SubscriptionEventData = Subscription;

/** `subscription.plan_changed`: the subscription on its new plan, plus where it came from. */
export interface SubscriptionPlanChangedEventData extends Subscription {
  previousPlanId: string;
  changeKind: "upgrade" | "downgrade";
}

/** `email.bounced` and `email.complained`. */
export interface EmailDeliveryEventData {
  email: string;
  type: "bounce" | "complaint";
  /** Null for a complaint. */
  bounceType: "hard" | "soft" | null;
  /** `report` for one your backend filed, `smtp` for one found while Gemicore delivered. */
  source: "report" | "smtp";
  eventId: string;
  /** ISO 8601. */
  occurredAt: string;
  diagnostic: string | null;
}

/** `purchase.*`: an App Store, Google Play, card or test store purchase at the moment its state changed. */
export interface PurchaseEventData {
  purchaseId: string;
  customerId: string | null;
  /** On `purchase.transferred`, the customer that held it before. */
  previousCustomerId?: string | null;
  store: "app_store" | "play_store" | "card" | "test_store";
  storeProductId: string;
  productId: string | null;
  productType: "subscription" | "consumable" | "non_consumable" | "non_renewing";
  status: string;
  /** Production purchases go to live endpoints; sandbox, Xcode and test purchases go to test endpoints. */
  environment: "production" | "sandbox" | "xcode" | "test";
  /** ISO 8601. */
  expiresAt: string | null;
  willRenew: boolean;
  /** Minor units. */
  priceAmount: number | null;
  priceCurrency: string | null;
}

/**
 * The `data` of every webhook event Gemicore sends today, by event name. `post.published`, `post.updated` and
 * `post.unpublished` are not in it: they are named in {@link GemicoreWebhookEvent} but nothing sends them yet.
 */
export interface GemicoreWebhookEventData {
  "payment.succeeded": PaymentEventData;
  "payment.failed": PaymentEventData;
  "payment.disputed": PaymentDisputedEventData;
  "refund.succeeded": RefundEventData;
  "refund.failed": RefundEventData;
  "subscription.created": SubscriptionEventData;
  "subscription.renewed": SubscriptionEventData;
  "subscription.reactivated": SubscriptionEventData;
  "subscription.plan_changed": SubscriptionPlanChangedEventData;
  "subscription.past_due": SubscriptionEventData;
  "subscription.canceled": SubscriptionEventData;
  "subscription.expired": SubscriptionEventData;
  "invoice.paid": Invoice;
  "email.bounced": EmailDeliveryEventData;
  "email.complained": EmailDeliveryEventData;
  "purchase.created": PurchaseEventData;
  "purchase.renewed": PurchaseEventData;
  "purchase.canceled": PurchaseEventData;
  "purchase.uncanceled": PurchaseEventData;
  "purchase.billing_issue": PurchaseEventData;
  "purchase.expired": PurchaseEventData;
  "purchase.refunded": PurchaseEventData;
  "purchase.revoked": PurchaseEventData;
  "purchase.product_changed": PurchaseEventData;
  "purchase.transferred": PurchaseEventData;
}

export type TypedWebhookEventName = keyof GemicoreWebhookEventData;

/**
 * A verified delivery body, narrowed by `event`. Handle the events you know and let the default branch ignore the
 * rest: new events can be added, and the compiler sees `delivery` as `never` there while at run time it can be any of them.
 *
 * ```ts
 * const delivery = JSON.parse(rawBody) as GemicoreWebhookDelivery;
 * switch (delivery.event) {
 *   case "payment.succeeded":
 *     markPaid(delivery.data.id);
 *     break;
 *   default:
 *     break;
 * }
 * ```
 */
export type GemicoreWebhookDelivery = {
  [E in TypedWebhookEventName]: GemicoreWebhookPayload<GemicoreWebhookEventData[E]> & { event: E };
}[TypedWebhookEventName];

/** The `data` of every event that reaches a realtime channel, by `type`. */
export interface RealtimeEventData {
  "payment.succeeded": PaymentEventData;
  "payment.failed": PaymentEventData;
  "refund.succeeded": RefundEventData;
  "refund.failed": RefundEventData;
  "subscription.created": SubscriptionEventData;
  "subscription.renewed": SubscriptionEventData;
  "subscription.reactivated": SubscriptionEventData;
  "subscription.plan_changed": SubscriptionPlanChangedEventData;
  "subscription.past_due": SubscriptionEventData;
  "subscription.canceled": SubscriptionEventData;
  "subscription.expired": SubscriptionEventData;
  "notification.created": InboxNotification;
  "presence.members": { members: PresenceMember[] };
  "presence.join": PresenceMember;
  "presence.update": PresenceMember;
  "presence.leave": { userId: string };
}

/** One event on a realtime channel, narrowed by `type`. */
export type RealtimeEvent =
  | {
      [T in keyof RealtimeEventData]: {
        channel: string;
        type: T;
        data: RealtimeEventData[T];
        /** Presence only: the room version the event is at. */
        v?: number;
      };
    }[keyof RealtimeEventData]
  // The server's reply to a presence `join`, matched to it by `ref`.
  | { channel: string; type: "joined"; ref: number; data?: undefined; v?: number };

type PaymentChannelType =
  | "payment.succeeded"
  | "payment.failed"
  | "refund.succeeded"
  | "refund.failed";
type UserChannelType =
  | PaymentChannelType
  | "subscription.created"
  | "subscription.renewed"
  | "subscription.reactivated"
  | "subscription.plan_changed"
  | "subscription.past_due"
  | "subscription.canceled"
  | "subscription.expired"
  | "notification.created";
type PresenceChannelType =
  | "presence.members"
  | "presence.join"
  | "presence.update"
  | "presence.leave"
  | "joined";

/** The channels a page can listen on. `admin:live` is for the dashboard and is not offered. */
export type RealtimeChannel = "app" | `user:${string}` | `payment:${string}` | `presence:${string}`;

/** What can arrive on a channel. `app` carries whatever you publish to it, so it stays untyped. */
export type RealtimeEventOn<C extends string> = C extends `payment:${string}`
  ? Extract<RealtimeEvent, { type: PaymentChannelType }>
  : C extends `user:${string}`
    ? Extract<RealtimeEvent, { type: UserChannelType }>
    : C extends `presence:${string}`
      ? Extract<RealtimeEvent, { type: PresenceChannelType }>
      : never;
