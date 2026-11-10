/**
 * WebSocket client for Gemicore realtime (`GET /v1/realtime`). Runs in browsers and in Node or Bun.
 *
 * @example
 * ```ts
 * const rt = new RealtimeClient({ baseUrl, publishableKey, token: () => session.accessToken });
 * rt.subscribe(`user:${userId}`, (m) => console.log(m.type, m.data));
 * rt.connect();
 * ```
 */

import type { RealtimeEventOn } from "./events.ts";
import { GemicoreConfigError } from "./http.ts";
import { createPresence, type Presence, type PresenceRooms } from "./presence.ts";

/** Close codes the server sends; 4003 and 4008 stop reconnecting, 4001 gets one retry with a fresh token, the rest retry. */
export const RealtimeCloseCode = {
  SHUTDOWN: 1001,
  TOO_BIG: 1009,
  UNAVAILABLE: 1011,
  IDLE: 4000,
  UNAUTHORIZED: 4001,
  TOKEN_EXPIRED: 4002,
  FEATURE_DISABLED: 4003,
  TOO_MANY_CONNECTIONS: 4008,
  RATE_LIMITED: 4029,
  MESSAGE_RATE_EXCEEDED: 4030,
  SLOW_CONSUMER: 4031,
} as const;

/** An event delivered on a channel: `app`, `user:<id>`, `payment:<id>` or `presence:<name>`. */
export interface RealtimeMessage {
  channel: string;
  type: string;
  data?: unknown;
  /** Presence only: the room version an event or snapshot is at. */
  v?: number;
  /** Presence only: the join frame a `joined` reply answers. */
  ref?: number;
}

/** The subset of the WebSocket API the client uses, so the `ws` package or a test double fits. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketConstructor = new (url: string, init?: never) => WebSocketLike;

export type TokenSource =
  | string
  | (() => string | null | undefined | Promise<string | null | undefined>);

export interface RealtimeClientOptions {
  /** Gemicore api base URL, http(s); the client derives the ws(s) URL. */
  baseUrl: string;
  /** Publishable key (`pk_...`). The page's origin must be in the app's allowed origins. */
  publishableKey: string;
  /** End-user access token, or a function returning a fresh one on every (re)connect. */
  token?: TokenSource;
  /**
   * The `statusToken` from `POST /v1/checkout`. Lets a page with no signed-in user follow
   * `payment:<id>` for that one payment; valid for 24 hours.
   */
  checkoutToken?: string;
  /** Node and Bun only: the Origin header to send. Browsers always send their own. */
  origin?: string;
  /** WebSocket implementation; defaults to `globalThis.WebSocket`. */
  WebSocket?: WebSocketConstructor;
  /** Backoff between reconnects, or `false` to never reconnect. */
  reconnect?: { minDelayMs?: number; maxDelayMs?: number; factor?: number } | false;
  /** Jitter source in [0, 1); injectable for tests. */
  random?: () => number;
  /**
   * How long a `token` function may take, in milliseconds. Past that the attempt is dropped and retried with the usual
   * backoff, so a stuck token source cannot leave the socket unauthenticated until the server's 10 second deadline.
   * Defaults to 5000.
   */
  tokenTimeoutMs?: number;
  /**
   * With a `token` function that returns a JWT, the socket reconnects this many seconds before the token expires and asks
   * the function for a new one, so the server's 4002 close and the events it would cost are avoided. Defaults to 30; 0 turns it off.
   */
  refreshBeforeExpirySeconds?: number;
}

export type RealtimeState = "idle" | "connecting" | "open" | "closed";

export interface RealtimeCloseInfo {
  code: number;
  reason: string;
  reconnecting: boolean;
}

export interface RealtimeSubscriptionError {
  channel?: string;
  code: string;
  /** Presence only: the join frame this refusal answers. */
  ref?: number;
}

/** What `ready` listeners are told. Events missed while the socket was down are not replayed, so refetch on `reconnected`. */
export interface RealtimeReadyInfo {
  /** False for the first `ready` of this client, true for every one after a lost or closed socket. */
  reconnected: boolean;
}

interface Listeners {
  ready: Set<(info: RealtimeReadyInfo) => void>;
  close: Set<(info: RealtimeCloseInfo) => void>;
  error: Set<(error: RealtimeSubscriptionError) => void>;
}

type ListenerFor<E extends keyof Listeners> = Listeners[E] extends Set<infer L> ? L : never;

const TERMINAL: ReadonlySet<number> = new Set([
  RealtimeCloseCode.UNAUTHORIZED,
  RealtimeCloseCode.FEATURE_DISABLED,
  RealtimeCloseCode.TOO_MANY_CONNECTIONS,
]);

const DEFAULT_TOKEN_TIMEOUT_MS = 5000;
const DEFAULT_REFRESH_BEFORE_EXPIRY_S = 30;
// A token that is already inside the lead window when it arrives (a source that hands back the same or a stale token, or
// a clock that runs ahead) is left for the server's 4002 close, so the refresh cannot turn into a reconnect loop.
const MIN_REFRESH_DELAY_MS = 1000;
// Two proactive reconnects are never closer together than this, whatever the tokens say.
const MIN_PROACTIVE_GAP_MS = 5000;
// The server's message bucket holds 20 frames and refills 2 a second, and the auth frame has used one. Ten subscribes at
// once, then one every 300 ms, stays inside that for the 20 channels a socket may hold.
const REPLAY_BURST = 10;
const REPLAY_INTERVAL_MS = 300;
// A socket that stayed ready this long was healthy, so the next drop starts the backoff over.
const STABLE_MS = 5000;

/** The `exp` and `iat` of a JWT in seconds (`iat` null when absent), or null when the token is not a readable JWT. */
function jwtTimes(token: string): { exp: number; iat: number | null } | null {
  const part = token.split(".")[1];
  if (!part || token.split(".").length !== 3) return null;
  try {
    const padded = part.replaceAll("-", "+").replaceAll("_", "/");
    const claims = JSON.parse(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="))) as {
      exp?: unknown;
      iat?: unknown;
    };
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) return null;
    return { exp: claims.exp, iat: typeof claims.iat === "number" ? claims.iat : null };
  } catch {
    return null;
  }
}

class TokenTimeout extends Error {}

/** The realtime endpoint URL for an api base URL (`https://x` becomes `wss://x/v1/realtime`). */
export function realtimeUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/realtime`;
  return url.toString();
}

/**
 * One socket per client. Subscriptions survive reconnects: after every `ready` the client
 * re-sends them, so handlers keep receiving without the caller doing anything.
 */
export class RealtimeClient {
  private readonly options: RealtimeClientOptions;
  private readonly handlers = new Map<string, Set<(message: RealtimeMessage) => void>>();
  private readonly listeners: Listeners = { ready: new Set(), close: new Set(), error: new Set() };
  private socket: WebSocketLike | null = null;
  private ready = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: RealtimeState = "idle";
  private readonly rooms: PresenceRooms = new Map();
  private everReady = false;
  // Set after a 4001 was answered by fetching a new token, and cleared by the next `ready`.
  private authRetried = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  private lastProactive: { at: number; expiry: number } | null = null;
  private readyAt = 0;
  private immediateSpent = false;
  private replayTimer: ReturnType<typeof setTimeout> | null = null;
  private sentToken: string | null | undefined;

  constructor(options: RealtimeClientOptions) {
    if (!options.publishableKey)
      throw new GemicoreConfigError("RealtimeClient needs a publishableKey");
    if (!options.baseUrl) throw new GemicoreConfigError("RealtimeClient needs a baseUrl");
    this.options = options;
  }

  get state(): RealtimeState {
    return this.current;
  }

  /** Opens the socket. Calling it again while connected does nothing. */
  connect(): this {
    if (this.current === "connecting" || this.current === "open") return this;
    this.current = "connecting";
    this.open();
    return this;
  }

  /**
   * Listens on a channel; returns the function that stops listening. On `payment:<id>`, `user:<id>` and
   * `presence:<name>` the handler's message is narrowed by `type` to the events that channel carries.
   */
  subscribe<C extends `payment:${string}` | `user:${string}` | `presence:${string}`>(
    channel: C,
    handler: (message: RealtimeEventOn<C>) => void,
  ): () => void;
  subscribe(channel: string, handler: (message: RealtimeMessage) => void): () => void;
  subscribe(channel: string, handler: (message: never) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      if (this.ready) this.send({ type: "subscribe", channel });
    }
    set.add(handler as (message: RealtimeMessage) => void);
    return () => {
      const current = this.handlers.get(channel);
      if (!current?.delete(handler as (message: RealtimeMessage) => void) || current.size > 0)
        return;
      this.handlers.delete(channel);
      if (this.ready) this.send({ type: "unsubscribe", channel });
    };
  }

  on<E extends keyof Listeners>(event: E, listener: ListenerFor<E>): () => void {
    const set = this.listeners[event] as Set<ListenerFor<E>>;
    set.add(listener);
    return () => void set.delete(listener);
  }

  /**
   * A presence room on this connection (needs a user `token`): `join(meta)`, `leave()`, `members()` and
   * `on(event, handler)`. A joined room is announced again after every reconnect.
   */
  presence(name: string): Presence {
    return createPresence(
      {
        on: (channel, handler) => {
          const stop = this.subscribe(channel, handler);
          const stopErrors = this.on("error", (error) => {
            if (error.channel === channel) {
              handler({
                channel,
                type: "error",
                data: { code: error.code, ...(error.ref === undefined ? {} : { ref: error.ref }) },
              });
            }
          });
          return () => {
            stop();
            stopErrors();
          };
        },
        // A frame before the server said ready would close the socket.
        send: (message) => {
          if (this.ready) this.send(message);
        },
        onReady: (fn) => this.on("ready", fn),
      },
      name,
      this.rooms,
    );
  }

  /** Closes for good; no reconnect follows. */
  close(): void {
    this.current = "closed";
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopRefreshTimer();
    this.stopReplay();
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    socket?.close(1000, "client closed");
  }

  private open(): void {
    const Impl =
      this.options.WebSocket ??
      (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket ??
      null;
    if (!Impl) {
      this.current = "closed";
      throw new GemicoreConfigError("No WebSocket implementation: pass `WebSocket`");
    }
    const init = this.options.origin ? { headers: { origin: this.options.origin } } : undefined;
    const socket = new Impl(realtimeUrl(this.options.baseUrl), init as never);
    this.socket = socket;

    socket.onopen = () => {
      void this.authenticate(socket);
    };
    socket.onmessage = (event) => this.receive(socket, event.data);
    socket.onerror = () => undefined;
    socket.onclose = (event) => this.closed(socket, event.code, event.reason);
  }

  private async authenticate(socket: WebSocketLike): Promise<void> {
    const source = this.options.token;
    let token: string | null | undefined;
    try {
      token = typeof source === "function" ? await this.boundedToken(source) : source;
    } catch (error) {
      // Closing lets the normal backoff retry the token source instead of hanging unauthenticated.
      const reason =
        error instanceof TokenTimeout ? "token source timed out" : "token source failed";
      socket.close(1000, reason);
      return;
    }
    if (socket !== this.socket) return;
    this.sentToken = token;
    this.sendOn(socket, {
      type: "auth",
      key: this.options.publishableKey,
      ...(token ? { token } : {}),
      ...(this.options.checkoutToken ? { checkoutToken: this.options.checkoutToken } : {}),
    });
  }

  private boundedToken(
    source: () => string | null | undefined | Promise<string | null | undefined>,
  ): Promise<string | null | undefined> {
    const limit = this.options.tokenTimeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new TokenTimeout()), limit);
      Promise.resolve()
        .then(source)
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  // A token the source can replace is swapped before it runs out, on a fresh socket, rather than by the server's 4002.
  private scheduleRefresh(socket: WebSocketLike): void {
    this.stopRefreshTimer();
    if (typeof this.options.token !== "function" || !this.sentToken) return;
    const times = jwtTimes(this.sentToken);
    if (times === null) return;
    let lead = (this.options.refreshBeforeExpirySeconds ?? DEFAULT_REFRESH_BEFORE_EXPIRY_S) * 1000;
    if (lead === 0) return;
    // A short token is replaced at half its life at the latest, so a lead longer than the token cannot cause a loop.
    if (times.iat !== null) lead = Math.min(lead, ((times.exp - times.iat) * 1000) / 2);
    const now = Date.now();
    const delay = times.exp * 1000 - now - lead;
    if (delay < MIN_REFRESH_DELAY_MS) return;
    const last = this.lastProactive;
    // One proactive reconnect per distinct token, and a floor between any two.
    if (last && (times.exp <= last.expiry || now + delay - last.at < MIN_PROACTIVE_GAP_MS)) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (socket !== this.socket) return;
      this.lastProactive = { at: Date.now(), expiry: times.exp };
      this.refreshing = true;
      socket.close(1000, "token refresh");
    }, delay);
  }

  // Paced, because the server counts every frame against a small bucket and closes a socket that overdraws it with 4030.
  private replaySubscriptions(socket: WebSocketLike): void {
    this.stopReplay();
    const queue = [...this.handlers.keys()];
    const step = (count: number) => {
      this.replayTimer = null;
      if (socket !== this.socket || !this.ready) return;
      for (const channel of queue.splice(0, count)) {
        if (this.handlers.has(channel)) this.send({ type: "subscribe", channel });
      }
      if (queue.length > 0) this.replayTimer = setTimeout(() => step(1), REPLAY_INTERVAL_MS);
    };
    step(REPLAY_BURST);
  }

  private stopReplay(): void {
    if (this.replayTimer) clearTimeout(this.replayTimer);
    this.replayTimer = null;
  }

  private receive(socket: WebSocketLike, raw: unknown): void {
    if (socket !== this.socket) return;
    let message: RealtimeMessage;
    try {
      message = JSON.parse(String(raw)) as RealtimeMessage;
    } catch {
      return;
    }
    if (message.type === "ready" && message.channel === undefined) {
      this.ready = true;
      this.current = "open";
      this.readyAt = Date.now();
      this.authRetried = false;
      const reconnected = this.everReady;
      this.everReady = true;
      this.scheduleRefresh(socket);
      this.replaySubscriptions(socket);
      for (const listener of this.listeners.ready) listener({ reconnected });
      return;
    }
    if (message.type === "error") {
      const detail = message.data as { code?: string; ref?: number } | undefined;
      const code = detail?.code ?? "UNKNOWN";
      const error: RealtimeSubscriptionError = {
        ...(message.channel === undefined ? {} : { channel: message.channel }),
        code,
        ...(detail?.ref === undefined ? {} : { ref: detail.ref }),
      };
      for (const listener of this.listeners.error) listener(error);
      return;
    }
    if (["subscribed", "unsubscribed", "left"].includes(message.type)) return;
    for (const handler of this.handlers.get(message.channel) ?? []) handler(message);
  }

  private closed(socket: WebSocketLike, code: number, reason: string): void {
    if (socket !== this.socket) return;
    this.socket = null;
    // Only a socket that stayed healthy starts the backoff over; one that drops soon after ready, such as one closed with
    // 4030 for overdrawing the message bucket, keeps climbing.
    const wasStable = this.ready && Date.now() - this.readyAt >= STABLE_MS;
    if (wasStable) {
      this.attempt = 0;
      this.immediateSpent = false;
    }
    this.ready = false;
    this.stopRefreshTimer();
    this.stopReplay();
    // A refused token may only be a stale one, so a source that can fetch another gets one try before this is final.
    const freshTokenRetry =
      code === RealtimeCloseCode.UNAUTHORIZED &&
      typeof this.options.token === "function" &&
      !this.authRetried;
    const reconnecting =
      this.current !== "closed" &&
      this.options.reconnect !== false &&
      (!TERMINAL.has(code) || freshTokenRetry);
    if (reconnecting && freshTokenRetry) this.authRetried = true;
    const refreshed = this.refreshing;
    this.refreshing = false;
    this.current = reconnecting ? "connecting" : "closed";
    for (const listener of this.listeners.close) listener({ code, reason, reconnecting });
    if (!reconnecting) return;
    // A new token fixes an expired one, so the first such close reconnects at once. Another one before a socket has stayed
    // healthy means the source keeps handing back dead tokens, and that goes through the backoff, not a tight loop.
    const immediate =
      (freshTokenRetry || code === RealtimeCloseCode.TOKEN_EXPIRED || refreshed) &&
      !this.immediateSpent;
    if (immediate) this.immediateSpent = true;
    const delay = immediate ? 0 : this.nextDelay();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.current === "connecting") this.open();
    }, delay);
  }

  private nextDelay(): number {
    const backoff = this.options.reconnect || {};
    const min = backoff.minDelayMs ?? 500;
    const max = backoff.maxDelayMs ?? 30_000;
    const factor = backoff.factor ?? 2;
    const full = Math.min(max, min * factor ** this.attempt);
    this.attempt += 1;
    // Half fixed, half random, so a fleet of tabs does not reconnect in lockstep after a deploy.
    return full / 2 + (full / 2) * (this.options.random ?? Math.random)();
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket) this.sendOn(this.socket, message);
  }

  private sendOn(socket: WebSocketLike, message: Record<string, unknown>): void {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }
}
