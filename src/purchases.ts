import type { GemicoreHttpClient } from "./http.ts";

// The wire shapes below are the api's purchases contract, written out here because this package cannot depend on
// server code. Dates are ISO strings.

export type PurchaseStoreName = "app_store" | "play_store" | "card" | "test_store";
export type PurchaseProductKind = "subscription" | "consumable" | "non_consumable" | "non_renewing";
export type PurchasePeriodType = "normal" | "trial" | "intro" | "promotional";
export type PurchaseOwnership = "purchased" | "family_shared";
export type PurchasePlatform = "ios" | "android";

/** A store purchase or a card payment for one product. */
export interface PurchaseRecord {
  id: string;
  productIdentifier: string | null;
  storeProductId: string;
  store: PurchaseStoreName;
  productType: PurchaseProductKind;
  status: string;
  isActive: boolean;
  isSandbox: boolean;
  willRenew: boolean;
  periodType: PurchasePeriodType;
  purchasedAt: string;
  originalPurchasedAt: string;
  expiresAt: string | null;
  gracePeriodExpiresAt: string | null;
  billingIssueDetectedAt: string | null;
  unsubscribeDetectedAt: string | null;
  refundedAt: string | null;
  ownership: PurchaseOwnership;
  /** Minor units. */
  priceAmount: number | null;
  priceCurrency: string | null;
  managementUrl: string | null;
}

export interface PurchaseEntitlement {
  identifier: string;
  isActive: boolean;
  /** `granted` is a grant from your backend or the dashboard, without a purchase. */
  source: "purchase" | "granted";
  productIdentifier: string | null;
  store: PurchaseStoreName | null;
  willRenew: boolean;
  periodType: PurchasePeriodType;
  purchasedAt: string | null;
  expiresAt: string | null;
  isSandbox: boolean;
  billingIssueDetectedAt: string | null;
  unsubscribeDetectedAt: string | null;
  ownership: PurchaseOwnership;
  managementUrl: string | null;
}

export interface PurchaseCustomerInfo {
  id: string;
  /** Your own id for the user, once the customer logged in with one. */
  externalId: string | null;
  entitlements: {
    active: Record<string, PurchaseEntitlement>;
    all: Record<string, PurchaseEntitlement>;
  };
  /** Product identifiers of subscriptions that currently give access. */
  activeSubscriptions: string[];
  purchases: PurchaseRecord[];
  requestedAt: string;
}

export interface PurchaseCustomerSession {
  customer: PurchaseCustomerInfo;
  /** Shown once. Keep it in secure storage and pass it as `customerToken` on later calls. */
  token: string;
}

export interface PurchaseProduct {
  identifier: string;
  type: PurchaseProductKind;
  displayName: string;
  description: string | null;
  /** The id to load from the store on the calling platform; null when the product is not sold there. */
  storeProductId: string | null;
  googleBasePlanId: string | null;
  defaultGoogleOfferId: string | null;
  entitlements: string[];
  /** Present when the product can be paid by card, Apple Pay or Google Pay. */
  card: { amount: number; currency: string } | null;
}

export type PurchasePackageType =
  | "monthly"
  | "annual"
  | "weekly"
  | "two_month"
  | "three_month"
  | "six_month"
  | "lifetime"
  | "custom";

export interface PurchasePackage {
  identifier: string;
  packageType: PurchasePackageType;
  displayName: string | null;
  product: PurchaseProduct;
}

export interface PaywallTheme {
  background: string;
  foreground: string;
  accent: string;
  accentForeground: string;
  cornerRadius: number;
  fontScale: number;
}

/** One element of a paywall. Strings may use `{{package.price}}`, `{{package.period}}`, `{{package.trial}}` and `{{package.pricePerMonth}}`. */
export type PaywallNode =
  | {
      type: "stack";
      direction: "row" | "column";
      spacing: number;
      padding: number;
      align: "start" | "center" | "end" | "stretch";
      children: PaywallNode[];
    }
  | {
      type: "text";
      stringKey: string;
      style: "title" | "body" | "caption";
      align: "start" | "center" | "end";
    }
  | { type: "image"; url: string; aspect: number; fit: "cover" | "contain" }
  | { type: "package_list"; layout: "vertical" | "horizontal"; selected: string | null }
  | { type: "purchase_button"; stringKey: string }
  | { type: "restore_button"; stringKey: string }
  | { type: "legal_links"; termsUrl: string; privacyUrl: string }
  | { type: "spacer"; size: number }
  | { type: "divider" };

/** A paywall is data, never code: render it with your own components. */
export interface PaywallConfig {
  version: 1;
  defaultLocale: string;
  theme: PaywallTheme;
  strings: Record<string, Record<string, string>>;
  root: PaywallNode;
}

export interface PurchasePaywall {
  offeringIdentifier: string;
  revision: number;
  config: PaywallConfig;
}

export interface PurchaseOffering {
  identifier: string;
  displayName: string;
  description: string | null;
  metadata: Record<string, unknown>;
  isCurrent: boolean;
  packages: PurchasePackage[];
  /** The published paywall, or null when the offering has none. */
  paywall: PurchasePaywall | null;
}

export interface PurchasePlacementResolution {
  identifier: string;
  source: "experiment" | "rule" | "default" | "current";
  experiment: { identifier: string; variant: string } | null;
}

export interface PurchaseOfferings {
  /** Identifier of the offering to show by default, or null when none is set. */
  current: string | null;
  offerings: PurchaseOffering[];
  /** How the requested placement was resolved; null when the call named none. */
  placement: PurchasePlacementResolution | null;
}

export interface PurchaseProductOffer {
  identifier: string;
  kind: "promotional" | "win_back" | "offer_code" | "intro";
  displayName: string;
  appleOfferIdentifier: string | null;
  googleOfferId: string | null;
  eligibility: "anyone" | "existing_subscriber" | "lapsed_subscriber";
  isDefault: boolean;
}

export interface PurchasePromotionalOfferSignature {
  productId: string;
  offerIdentifier: string;
  /** JWS for StoreKit 2 purchases. */
  signature: string;
  /** Fields for StoreKit 1 style signing; null when the app uses StoreKit 2 only. */
  legacy: { keyIdentifier: string; nonce: string; timestamp: number; signature: string } | null;
}

export interface PurchaseIntroEligibility {
  productId: string;
  allowIntroductoryOffer: boolean;
  /** Signed JWS the device passes to StoreKit. */
  signature: string;
}

export interface PurchaseConsumptionConsent {
  consented: boolean;
  at: string | null;
}

export interface PurchaseCustomerCenterConfig {
  version: 1;
  supportEmail: string | null;
  supportUrl: string | null;
  showManageSubscription: boolean;
  showRestore: boolean;
  showRefundHelp: boolean;
  cancelSurvey: {
    enabled: boolean;
    allowOther: boolean;
    options: Array<{ key: string; label: string }>;
  };
  /** Catalog offers shown first to a customer who holds the product and is eligible. */
  retention: Array<{ productIdentifier: string; offerIdentifier: string }>;
  strings: Record<string, Record<string, string>>;
}

export interface PurchaseCustomerCenter {
  enabled: boolean;
  config: PurchaseCustomerCenterConfig;
  /** Per product identifier the customer holds: the store page that manages the subscription. */
  managementUrls: Record<string, string>;
  eligibleRetentionOffers: PurchaseProductOffer[];
}

export interface PurchaseCancelFeedback {
  id: string;
  purchaseId: string | null;
  reasonKey: string;
  reasonText: string | null;
  offerShown: string | null;
  offerAccepted: boolean;
  createdAt: string;
}

export interface PurchaseCancelFeedbackInput {
  purchaseId?: string;
  /** A configured survey option key, or `other` when the survey allows it. */
  reasonKey: string;
  reasonText?: string;
  offerShown?: string;
  offerAccepted?: boolean;
}

/** What a device reports after a store purchase. A Play purchase needs the `productId` the store used. */
export type RecordPurchaseInput =
  | { store: "app_store"; signedTransaction: string }
  | { store: "play_store"; purchaseToken: string; productId: string }
  | { store: "test_store"; productId: string };

export interface PurchaseRecordResult {
  purchase: PurchaseRecord;
  customer: PurchaseCustomerInfo;
}

export interface RestorePurchasesInput {
  appStore?: { signedTransactions: string[] };
  playStore?: { purchases: Array<{ purchaseToken: string; productId: string }> };
}

export interface PurchaseRestoreResult {
  restored: number;
  failed: number;
  customer: PurchaseCustomerInfo;
}

export interface PurchaseCardInput {
  /** Catalog identifier of a one-time product with a card price. */
  productId: string;
  email: string;
  /** The server tries the app's Stripe account first when this is left out. */
  provider?: "stripe" | "paystack" | "flutterwave";
}

export interface PurchaseCheckout {
  paymentId: string;
  /** Hosted page of the app's gateway, which offers cards, Apple Pay and Google Pay where the gateway does. */
  url: string;
  purchase: PurchaseRecord;
}

export interface PurchaseCardIntent {
  paymentId: string;
  clientSecret: string;
  publishableKey: string;
  merchantCountryCode: string;
  applePayMerchantId: string | null;
  /** The app's name, so the payment sheet shows the business and not the product. */
  merchantDisplayName: string;
  purchase: PurchaseRecord;
}

/**
 * `appTransactionId` is StoreKit's `AppTransaction.appTransactionID`. Apple accepts it for a customer who has no
 * purchase yet; the server prefers the customer's own Apple transaction when it has one.
 */
export interface PromotionalOfferInput {
  productId: string;
  offerId: string;
  appTransactionId?: string;
}

export interface IntroEligibilityInput {
  productId: string;
  appTransactionId?: string;
}

/** Device facts the api uses to pick store product ids and to match placement rules. */
export interface PurchasesContext {
  platform?: PurchasePlatform;
  appVersion?: string;
  /** Two letter country code. */
  country?: string;
}

export interface CreateCustomerOptions {
  /** Your own id for the user. */
  externalId?: string;
  context?: PurchasesContext;
}

export interface LogInOptions {
  /** Left out when `userToken` is given: its subject is the id. */
  externalId?: string;
  /** A Gemicore user access token. */
  userToken?: string;
}

export interface OfferingsOptions {
  /** Names a placement; the answer's `current` is the offering the placement resolves to for this customer. */
  placement?: string;
  /** Optional. A stale one is ignored. */
  customerToken?: string;
  context?: PurchasesContext;
}

/** One purchase to import from your backend. Set `customerExternalId` to attach it to the customer that logged in with that id. */
export type PurchaseImportItem =
  | {
      store: "app_store";
      transactionId?: string;
      signedTransaction?: string;
      receipt?: string;
      customerExternalId?: string;
    }
  | {
      store: "play_store";
      purchaseToken: string;
      productId: string;
      customerExternalId?: string;
    };

export interface PurchaseImportItemResult {
  index: number;
  status: "imported" | "unchanged" | "failed";
  purchaseId?: string;
  reason?: string;
  /** For an app receipt that held several purchases: how many it held, and how many of them failed. */
  purchases?: number;
  failedPurchases?: number;
}

export interface PurchaseImportResult {
  imported: number;
  unchanged: number;
  failed: number;
  results: PurchaseImportItemResult[];
}

export interface GrantEntitlementInput {
  entitlement: string;
  /** ISO 8601. Null or left out grants access with no end. */
  expiresAt?: string | null;
  reason?: string | null;
}

/** Wire names of the device context headers. */
const CONTEXT_HEADERS = {
  platform: "x-gemicore-platform",
  appVersion: "x-gemicore-app-version",
  country: "x-gemicore-country",
} as const;

function contextHeaders(context: PurchasesContext | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, name] of Object.entries(CONTEXT_HEADERS)) {
    const value = context?.[key as keyof PurchasesContext];
    if (value) headers[name] = value;
  }
  return headers;
}

const encode = encodeURIComponent;

/**
 * In-app purchases: App Store, Google Play and card payments with entitlements.
 *
 * Four methods are for your backend and need a secret key: `retrieveCustomer`, `grantEntitlement`, `revokeEntitlement`
 * and `importPurchases`. The rest are what a device does and need a publishable key, as a native app sends it; they
 * take the `customerToken` that `createCustomer` returned.
 */
export class PurchasesClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** Reads one customer's entitlements and purchases by Gemicore customer id. Needs a secret key; an id of another app is `NOT_FOUND` (404). */
  retrieveCustomer(customerId: string): Promise<PurchaseCustomerInfo> {
    return this.http.request(`/v1/purchases/customers/${encode(customerId)}`, { method: "GET" });
  }

  /** Gives a customer an entitlement without a purchase, for a promotion or a support case; needs a secret key. */
  grantEntitlement(
    customerId: string,
    input: GrantEntitlementInput,
  ): Promise<PurchaseCustomerInfo> {
    return this.http.request(`/v1/purchases/customers/${encode(customerId)}/grants`, {
      method: "POST",
      body: input,
    });
  }

  /** Takes back a granted entitlement and needs a secret key. Access the customer holds through a purchase stays. */
  revokeEntitlement(customerId: string, entitlement: string): Promise<PurchaseCustomerInfo> {
    return this.http.request(
      `/v1/purchases/customers/${encode(customerId)}/grants/${encode(entitlement)}`,
      { method: "DELETE" },
    );
  }

  /** Imports purchases made before Gemicore, up to 100 per call, from App Store transactions or receipts and Play purchase tokens; needs a secret key. */
  importPurchases(items: PurchaseImportItem[]): Promise<PurchaseImportResult> {
    return this.http.request("/v1/purchases/import", { method: "POST", body: { items } });
  }

  /** Starts an anonymous customer for a device and returns its `token`. The token is shown only once. */
  createCustomer(options: CreateCustomerOptions = {}): Promise<PurchaseCustomerSession> {
    const { context, ...body } = options;
    return this.http.request("/v1/purchases/customers", {
      method: "POST",
      body,
      headers: contextHeaders(context),
    });
  }

  /** Attaches the device's customer to your user. The purchases of an anonymous customer are kept, and a second device of the same user is merged into it. */
  logIn(customerToken: string, options: LogInOptions = {}): Promise<PurchaseCustomerSession> {
    const { userToken, ...body } = options;
    return this.http.request("/v1/purchases/customers/login", {
      method: "POST",
      body,
      auth: { customerToken, userToken },
    });
  }

  /** Ends the device's customer and starts a new anonymous one; the old token is invalidated. */
  logOut(customerToken: string): Promise<PurchaseCustomerSession> {
    return this.http.request("/v1/purchases/customers/logout", {
      method: "POST",
      auth: { customerToken },
    });
  }

  /** The device customer's entitlements and purchases. */
  customerInfo(customerToken: string): Promise<PurchaseCustomerInfo> {
    return this.http.request("/v1/purchases/customer", { method: "GET", auth: { customerToken } });
  }

  /** Sets attributes that placement rules can match on; a `null` value deletes its key, and 200 keys is the limit. */
  setAttributes(
    customerToken: string,
    attributes: Record<string, string | null>,
  ): Promise<{ attributes: Record<string, string> }> {
    return this.http.request("/v1/purchases/customer/attributes", {
      method: "PUT",
      body: { attributes },
      auth: { customerToken },
    });
  }

  /** Records whether the customer lets the app share usage data with Apple when they ask for a refund. */
  setConsumptionConsent(
    customerToken: string,
    consented: boolean,
  ): Promise<PurchaseConsumptionConsent> {
    return this.http.request("/v1/purchases/customer/consumption-consent", {
      method: "PUT",
      body: { consented },
      auth: { customerToken },
    });
  }

  /** The app's product catalog with the store product ids for `context.platform`. */
  products(context?: PurchasesContext): Promise<{ products: PurchaseProduct[] }> {
    return this.http.request("/v1/purchases/products", {
      method: "GET",
      headers: contextHeaders(context),
    });
  }

  /** The app's offerings with their packages and published paywalls, optionally resolved through a placement. */
  offerings(options: OfferingsOptions = {}): Promise<PurchaseOfferings> {
    return this.http.request("/v1/purchases/offerings", {
      method: "GET",
      query: { placement: options.placement },
      auth: { customerToken: options.customerToken },
      headers: contextHeaders(options.context),
    });
  }

  /** The offers this customer can use on one product. */
  offers(customerToken: string, productId: string): Promise<{ offers: PurchaseProductOffer[] }> {
    return this.http.request("/v1/purchases/offers", {
      method: "GET",
      query: { productId },
      auth: { customerToken },
    });
  }

  /** Reports a purchase the store completed on the device and returns it with the updated customer. */
  recordPurchase(customerToken: string, input: RecordPurchaseInput): Promise<PurchaseRecordResult> {
    return this.http.request("/v1/purchases", {
      method: "POST",
      body: input,
      auth: { customerToken },
    });
  }

  /** Reports what a store restore returned. A purchase held by another customer of the app is reassigned to this one. */
  restore(customerToken: string, input: RestorePurchasesInput): Promise<PurchaseRestoreResult> {
    return this.http.request("/v1/purchases/restore", {
      method: "POST",
      body: input,
      auth: { customerToken },
    });
  }

  /** Starts a hosted card payment for a one-time product; send the buyer to the returned `url`. */
  checkout(customerToken: string, input: PurchaseCardInput): Promise<PurchaseCheckout> {
    return this.http.request("/v1/purchases/checkout", {
      method: "POST",
      body: input,
      auth: { customerToken },
    });
  }

  /** Starts a card payment for the Apple Pay or Google Pay sheet and returns the client secret the sheet needs. */
  checkoutIntent(customerToken: string, input: PurchaseCardInput): Promise<PurchaseCardIntent> {
    return this.http.request("/v1/purchases/checkout/intent", {
      method: "POST",
      body: input,
      auth: { customerToken },
    });
  }

  /** Gives a signed answer on whether this customer may use the introductory offer of an App Store product. */
  introductoryEligibility(
    customerToken: string,
    input: IntroEligibilityInput,
  ): Promise<PurchaseIntroEligibility> {
    return this.http.request("/v1/purchases/apple/introductory-eligibility", {
      method: "POST",
      body: input,
      auth: { customerToken },
    });
  }

  /** Returns the signature the device needs to apply an App Store promotional or win-back offer in StoreKit. */
  promotionalOffer(
    customerToken: string,
    input: PromotionalOfferInput,
  ): Promise<PurchasePromotionalOfferSignature> {
    return this.http.request("/v1/purchases/apple/promotional-offer", {
      method: "POST",
      body: input,
      auth: { customerToken },
    });
  }

  /** The Customer Center configuration, the store pages that manage the customer's subscriptions and the retention offers they may use. */
  customerCenter(customerToken: string): Promise<PurchaseCustomerCenter> {
    return this.http.request("/v1/purchases/customer-center", {
      method: "GET",
      auth: { customerToken },
    });
  }

  /** Records the answer to the cancellation survey, and whether a retention offer was shown or taken. */
  sendCancelFeedback(
    customerToken: string,
    input: PurchaseCancelFeedbackInput,
  ): Promise<PurchaseCancelFeedback> {
    return this.http.request("/v1/purchases/customer-center/feedback", {
      method: "POST",
      body: input,
      auth: { customerToken },
    });
  }
}
