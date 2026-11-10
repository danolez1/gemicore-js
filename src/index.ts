/**
 * The official TypeScript client for Gemicore.
 *
 * @example
 * ```ts
 * import { Gemicore } from "@gemicore/sdk";
 *
 * const gemicore = new Gemicore({ apiKey: "sk_test_...", baseUrl: "https://api.example.com" });
 * const payment = await gemicore.payments.checkout(
 *   { amount: 10_000, currency: "USD", customer: { email }, successUrl },
 *   { idempotencyKey: orderId },
 * );
 * ```
 */

import { AuthClient } from "./auth.ts";
import {
  EntitlementsClient,
  PlansClient,
  PromoCodesClient,
  SubscriptionsClient,
} from "./billing.ts";
import { ConfigClient, FlagsClient } from "./config.ts";
import { EmailClient } from "./email.ts";
import { GemicoreConfigError, GemicoreHttpClient } from "./http.ts";
import {
  DevicesClient,
  NotificationPreferencesClient,
  NotificationsClient,
} from "./notifications.ts";
import { BalancesClient, PaymentsClient } from "./payments.ts";
import { PurchasesClient } from "./purchases.ts";
import { type AppInfo, DEFAULT_TIMEOUT_MS, type GemicoreConfig } from "./types.ts";

/**
 * The Gemicore platform client.
 *
 * Authenticates with an app key (sent as `Authorization: Bearer` on every request) and
 * passes end-user access tokens per call for signed-in routes.
 */
export class Gemicore {
  readonly auth: AuthClient;
  readonly payments: PaymentsClient;
  readonly balances: BalancesClient;
  readonly plans: PlansClient;
  readonly subscriptions: SubscriptionsClient;
  readonly entitlements: EntitlementsClient;
  readonly promoCodes: PromoCodesClient;
  readonly config: ConfigClient;
  readonly email: EmailClient;
  readonly flags: FlagsClient;
  readonly notifications: NotificationsClient;
  readonly devices: DevicesClient;
  readonly notificationPreferences: NotificationPreferencesClient;
  readonly purchases: PurchasesClient;

  private readonly http: GemicoreHttpClient;
  private readonly settings: GemicoreConfig;

  constructor(config: GemicoreConfig) {
    if (!config.apiKey) {
      throw new GemicoreConfigError("Gemicore requires an `apiKey`");
    }
    if (!config.baseUrl) {
      throw new GemicoreConfigError("Gemicore requires a `baseUrl`");
    }
    this.settings = config;
    let baseUrl = config.baseUrl;
    while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    const fetch = config.fetch;

    this.http = new GemicoreHttpClient({
      baseUrl,
      apiKey: config.apiKey,
      timeout,
      fetch,
      ...(config.clientIp ? { clientIp: config.clientIp } : {}),
    });

    this.auth = new AuthClient(this.http);
    this.payments = new PaymentsClient(this.http);
    this.balances = new BalancesClient(this.http);
    this.plans = new PlansClient(this.http);
    this.subscriptions = new SubscriptionsClient(this.http);
    this.entitlements = new EntitlementsClient(this.http);
    this.promoCodes = new PromoCodesClient(this.http);
    this.config = new ConfigClient(this.http);
    this.email = new EmailClient(this.http);
    this.flags = new FlagsClient(this.http);
    this.notifications = new NotificationsClient(this.http);
    this.devices = new DevicesClient(this.http);
    this.notificationPreferences = new NotificationPreferencesClient(this.http);
    this.purchases = new PurchasesClient(this.http);
  }

  /**
   * A client for one end user's request: same key and settings, plus that user's IP, so Gemicore's per-IP
   * limits count the user and not your server. Build a new one per incoming request.
   */
  withClientIp(clientIp: string): Gemicore {
    return new Gemicore({ ...this.settings, clientIp });
  }

  /** The app this key belongs to, with its mode and key kind. */
  app(): Promise<AppInfo> {
    return this.http.request("/v1/app", { method: "GET" });
  }
}

export { AuthClient, isMfaChallenge } from "./auth.ts";
export {
  type Entitlements,
  EntitlementsClient,
  type Invoice,
  type Plan,
  type PlanInterval,
  PlansClient,
  PromoCodesClient,
  type PromoDiscountType,
  type PromoRejectReason,
  type PromoResolveInput,
  type PromoResolveResult,
  type QuotaInfo,
  type SubscribeInput,
  type SubscribeOptions,
  type Subscription,
  type SubscriptionStatus,
  SubscriptionsClient,
  type SubscriptionWithCheckout,
  type UsageInput,
  type UsageReport,
} from "./billing.ts";
export { type AppConfig, ConfigClient, type FeatureFlags, FlagsClient } from "./config.ts";
export {
  type DeliveryReportResult,
  EmailClient,
  type PreferencesLinkResult,
  type RecordConsentInput,
  type RecordConsentResult,
  type ReportBounceInput,
  type ReportComplaintInput,
} from "./email.ts";
export type {
  DisputeStage,
  EmailDeliveryEventData,
  GemicoreWebhookDelivery,
  GemicoreWebhookEventData,
  PaymentDisputedEventData,
  PaymentEventData,
  PaymentFailureReason,
  PurchaseEventData,
  RealtimeChannel,
  RealtimeEvent,
  RealtimeEventData,
  RealtimeEventOn,
  RefundEventData,
  SubscriptionEventData,
  SubscriptionPlanChangedEventData,
  TypedWebhookEventName,
} from "./events.ts";
export {
  type FetchLike,
  GemicoreApiError,
  type GemicoreApiErrorExtra,
  GemicoreConfigError,
  GemicoreErrorCode,
  GemicoreHttpClient,
  type HttpClientConfig,
  isGemicoreApiError,
  type RequestAuth,
} from "./http.ts";
export {
  DevicesClient,
  type InboxNotification,
  type InboxPage,
  type InboxQuery,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationDeliveryStatus,
  type NotificationDevice,
  type NotificationPreference,
  NotificationPreferencesClient,
  type NotificationRecipients,
  NotificationsClient,
  type RegisterDeviceInput,
  type SendNotificationInput,
  type SentNotification,
} from "./notifications.ts";
export {
  createOidcPkce,
  OidcErrorCode,
  type OidcPkcePair,
  type OidcProvider,
  type OidcRedirectError,
  type OidcStartOptions,
  oidcCodeFromUrl,
  oidcErrorFromUrl,
  oidcPkceChallenge,
} from "./oidc.ts";
export { BalancesClient, PaymentsClient } from "./payments.ts";
export type { Presence, PresenceEvents, PresenceMember } from "./presence.ts";
export {
  type CreateCustomerOptions,
  type GrantEntitlementInput,
  type IntroEligibilityInput,
  type LogInOptions,
  type OfferingsOptions,
  type PaywallConfig,
  type PaywallNode,
  type PaywallTheme,
  type PromotionalOfferInput,
  type PurchaseCancelFeedback,
  type PurchaseCancelFeedbackInput,
  type PurchaseCardInput,
  type PurchaseCardIntent,
  type PurchaseCheckout,
  type PurchaseConsumptionConsent,
  type PurchaseCustomerCenter,
  type PurchaseCustomerCenterConfig,
  type PurchaseCustomerInfo,
  type PurchaseCustomerSession,
  type PurchaseEntitlement,
  type PurchaseImportItem,
  type PurchaseImportItemResult,
  type PurchaseImportResult,
  type PurchaseIntroEligibility,
  type PurchaseOffering,
  type PurchaseOfferings,
  type PurchaseOwnership,
  type PurchasePackage,
  type PurchasePackageType,
  type PurchasePaywall,
  type PurchasePeriodType,
  type PurchasePlacementResolution,
  type PurchasePlatform,
  type PurchaseProduct,
  type PurchaseProductKind,
  type PurchaseProductOffer,
  type PurchasePromotionalOfferSignature,
  type PurchaseRecord,
  type PurchaseRecordResult,
  type PurchaseRestoreResult,
  type PurchaseStoreName,
  PurchasesClient,
  type PurchasesContext,
  type RecordPurchaseInput,
  type RestorePurchasesInput,
} from "./purchases.ts";
export {
  RealtimeClient,
  type RealtimeClientOptions,
  RealtimeCloseCode,
  type RealtimeCloseInfo,
  type RealtimeMessage,
  type RealtimeReadyInfo,
  type RealtimeState,
  type RealtimeSubscriptionError,
  realtimeUrl,
  type TokenSource,
  type WebSocketConstructor,
  type WebSocketLike,
} from "./realtime.ts";
export {
  type AppInfo,
  type AppUser,
  type Balance,
  type CheckoutInput,
  type CheckoutPayment,
  type Credentials,
  type CryptoPayment,
  type CryptoProgress,
  DEFAULT_TIMEOUT_MS,
  type GemicoreConfig,
  type HostedPayment,
  type IdempotentOptions,
  type JsonObject,
  type ListResponse,
  type MfaChallenge,
  type Mode,
  type Payment,
  type PaymentStatus,
  type ProviderName,
  type Refund,
  type RefundInput,
  type SignupConsent,
  type TokenResponse,
  type TransferInstructions,
} from "./types.ts";
export {
  AccessTokenError,
  type AccessTokenErrorReason,
  clearAccessTokenKeyCache,
  type VerifiedAccessToken,
  type VerifyAccessTokenOptions,
  verifyAccessToken,
} from "./verify.ts";
export {
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  GEMICORE_SIGNATURE_SCHEME,
  GemicoreWebhookEvent,
  GemicoreWebhookHeader,
  type GemicoreWebhookPayload,
  LegacyKeelWebhookHeader,
  signGemicorePayload,
  type VerifyGemicoreSignatureInput,
  verifyGemicoreSignature,
  verifyKeelSignature,
} from "./webhooks.ts";
