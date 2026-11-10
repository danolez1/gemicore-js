import type { GemicoreHttpClient } from "./http.ts";

/** Delivery channels (D27, D40). The in-app inbox is not a channel: every send stores an inbox row. */
export type NotificationChannel = "web_push" | "fcm" | "apns";

export type NotificationDeliveryStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "unavailable"
  | "skipped";

/** Name one recipient with `userId` or up to 500 with `userIds`; the route refuses a call that has both. */
export type NotificationRecipients =
  | { userId: string; userIds?: never }
  | { userIds: string[]; userId?: never };

export type SendNotificationInput = NotificationRecipients & {
  /** Lower case letters, digits, dots, dashes and underscores; users mute per category and channel. */
  category: string;
  title: string;
  body: string;
  /** Opened when the push is clicked: an http(s) URL or a path on the app's origin. */
  url?: string;
  /** Up to 2048 bytes as JSON. */
  data?: Record<string, unknown>;
  /** Defaults to every channel the user has a device on. */
  channels?: NotificationChannel[];
};

export interface NotificationDelivery {
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  errorCategory: string | null;
  attempts: number;
  /** How many of the user's devices on this channel already have it, so a delivery still retrying shows its partial state. */
  deliveredDevices: number;
  deliveredAt: string | null;
}

export interface SentNotification {
  id: string;
  userId: string;
  createdAt: string;
  deliveries: NotificationDelivery[];
}

export interface InboxNotification {
  id: string;
  category: string;
  title: string;
  body: string;
  url: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface InboxPage {
  data: InboxNotification[];
  pagination: { page: number; pageSize: number; total: number };
  unreadCount: number;
}

export interface InboxQuery {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}

export type RegisterDeviceInput =
  | {
      channel: "web_push";
      /** `PushSubscription.toJSON()` from the browser. */
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
      platform?: string;
      userAgent?: string;
    }
  | { channel: "fcm" | "apns"; token: string; platform?: string; userAgent?: string };

export interface NotificationDevice {
  id: string;
  channel: NotificationChannel;
  platform: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface NotificationPreference {
  category: string;
  channel: NotificationChannel;
  enabled: boolean;
}

export class NotificationsClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** Secret key only. Stores inbox rows, tells open tabs over realtime and queues the pushes. */
  send(input: SendNotificationInput): Promise<{ data: SentNotification[] }> {
    return this.http.request("/v1/notifications", { method: "POST", body: input });
  }

  /** The token holder's inbox for this key's mode, newest first. */
  list(userToken: string, query: InboxQuery = {}): Promise<InboxPage> {
    return this.http.request("/v1/notifications", {
      method: "GET",
      auth: { userToken },
      query: {
        page: query.page,
        pageSize: query.pageSize,
        unreadOnly: query.unreadOnly ? "true" : undefined,
      },
    });
  }

  /** Marks one notification read. An id that is not the user's is `NOT_FOUND` (404). */
  markRead(userToken: string, notificationId: string): Promise<InboxNotification> {
    return this.http.request(`/v1/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: "POST",
      auth: { userToken },
    });
  }

  /** Marks the whole inbox read and says how many rows changed. */
  markAllRead(userToken: string): Promise<{ updated: number }> {
    return this.http.request("/v1/notifications/read-all", { method: "POST", auth: { userToken } });
  }
}

export class DevicesClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** Refused with NOTIFICATIONS_PUSH_DISABLED while push is off for the app. */
  register(userToken: string, input: RegisterDeviceInput): Promise<NotificationDevice> {
    return this.http.request("/v1/devices", { method: "POST", body: input, auth: { userToken } });
  }

  /** Revokes a device. An id that is not the user's is `NOT_FOUND` (404). */
  remove(userToken: string, deviceId: string): Promise<NotificationDevice> {
    return this.http.request(`/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      auth: { userToken },
    });
  }
}

/** A missing row means enabled: preferences default on. */
export class NotificationPreferencesClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** The user's notification switches. A missing row means on. */
  get(userToken: string): Promise<{ data: NotificationPreference[] }> {
    return this.http.request("/v1/notification-preferences", {
      method: "GET",
      auth: { userToken },
    });
  }

  /** Saves the user's switches (1 to 100 entries) and returns the full list. */
  put(
    userToken: string,
    preferences: NotificationPreference[],
  ): Promise<{ data: NotificationPreference[] }> {
    return this.http.request("/v1/notification-preferences", {
      method: "PUT",
      body: { preferences },
      auth: { userToken },
    });
  }
}
