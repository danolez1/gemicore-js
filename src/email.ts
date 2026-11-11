import type { GemicoreHttpClient } from "./http.ts";

/** A delivery problem for one address, reported by your backend or a relay of your mail provider's webhook. */
export interface ReportBounceInput {
  email: string;
  /** Any string unique to this event, such as your provider's event id. A repeat of it changes nothing. */
  eventId: string;
  /** A hard bounce will suppress the address at once; soft bounces will suppress it after 3 within 7 days. */
  bounceType: "hard" | "soft";
  /** ISO 8601 time the problem happened; defaults to now and is never later than now. */
  occurredAt?: string;
  /** The remote server's text, up to 500 characters. */
  diagnostic?: string;
}

export interface ReportComplaintInput {
  email: string;
  eventId: string;
  occurredAt?: string;
  diagnostic?: string;
}

export interface DeliveryReportResult {
  /** False when this `eventId` was already filed. */
  recorded: boolean;
  /** Whether the address is on the suppression list for this kind of report afterwards. */
  suppressed: boolean;
}

interface RecordConsentBase {
  email: string;
  /** Lower case letters, digits, dashes and underscores, up to 40 characters, starting with a letter or digit. Defaults to `marketing`. */
  topic?: string;
  /** Unique per event. A repeat for the same address, topic and state changes nothing; reused for another address or state it is a new event. */
  eventId?: string;
}

/**
 * A grant needs the exact label the person was shown, up to 200 characters; a person who unsubscribed
 * cannot be granted again this way. A withdrawal needs no wording.
 */
export type RecordConsentInput =
  | (RecordConsentBase & { state: "granted"; wording: string })
  | (RecordConsentBase & { state: "withdrawn"; wording?: string });

export interface RecordConsentResult {
  /** False when the address was already in that state. */
  recorded: boolean;
  state: "granted" | "withdrawn" | "pending";
}

export interface PreferencesLinkResult {
  /** The page where this address can turn off topics, stop all marketing mail or ask to subscribe again. */
  url: string;
}

/** Bounce and complaint reports and marketing consent. Secret key only, since both change who the app may mail. */
export class EmailClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** Reports a hard or soft bounce for an address. Gemicore suppresses the address at once after a hard bounce, and after the third soft bounce within 7 days. It needs a live mode secret key, and filing the same `eventId` again changes nothing. */
  reportBounce(input: ReportBounceInput): Promise<DeliveryReportResult> {
    return this.http.request("/v1/email/bounces", {
      method: "POST",
      body: { ...input, type: "bounce" },
    });
  }

  /** Records that the person agreed to, or withdrew from, marketing mail. A grant counts at once, because your backend attests it. */
  recordConsent(input: RecordConsentInput): Promise<RecordConsentResult> {
    return this.http.request("/v1/email/consents", { method: "POST", body: input });
  }

  /** A link to the preference page for one address, for a settings screen in your app. It can narrow what the person receives and cannot grant consent. */
  preferencesLink(input: { email: string }): Promise<PreferencesLinkResult> {
    return this.http.request("/v1/email/preferences-link", { method: "POST", body: input });
  }

  /** Reports a spam complaint. Gemicore then suppresses the address for broadcasts and marketing mail. Needs a live mode secret key. */
  reportComplaint(input: ReportComplaintInput): Promise<DeliveryReportResult> {
    return this.http.request("/v1/email/bounces", {
      method: "POST",
      body: { ...input, type: "complaint" },
    });
  }
}
