// Presence on top of one RealtimeClient. @gemicore/browser carries a copy of this file; keep the two in step.
import type { RealtimeMessage } from "./realtime.ts";

export interface PresenceMember {
  userId: string;
  meta: Record<string, unknown>;
  joinedAt: string;
}

export interface PresenceEvents {
  // The full member list: after subscribing and after every reconnect.
  sync: PresenceMember[];
  join: PresenceMember;
  update: PresenceMember;
  leave: { userId: string };
  // `ref` is the join frame a refused join answers; absent for other errors.
  error: { code: string; ref?: number };
}

export interface PresenceTransport {
  on(channel: string, handler: (message: RealtimeMessage) => void): () => void;
  // Sends only once the connection is authenticated; a frame before that would close the socket.
  send(message: Record<string, unknown>): void;
  onReady(fn: () => void): () => void;
}

export interface Presence {
  // Announces this user in the room; calling it again replaces the metadata.
  join(meta?: Record<string, unknown>): void;
  leave(): void;
  members(): PresenceMember[];
  on<E extends keyof PresenceEvents>(
    event: E,
    handler: (payload: PresenceEvents[E]) => void,
  ): () => void;
  // Stops watching; the server removes this socket's membership with the subscription.
  close(): void;
}

type Handler = (payload: never) => void;

// Beyond this many users the per-user ordering memory is dropped; the room snapshot still bounds correctness.
const MAX_REMEMBERED_USERS = 2000;

interface Handle {
  listeners: Map<keyof PresenceEvents, Set<Handler>>;
  // Set while this handle wants to be in the room.
  meta: Record<string, unknown> | null;
}

// One socket has one membership per room, so every handle of a room shares this state.
interface Room {
  handles: Set<Handle>;
  members: Map<string, PresenceMember>;
  join(handle: Handle, meta: Record<string, unknown>): void;
  leave(handle: Handle): void;
  release(handle: Handle): void;
}

export type PresenceRooms = Map<string, Room>;

function openRoom(transport: PresenceTransport, name: string, rooms: PresenceRooms): Room {
  const channel = `presence:${name}`;
  const handles = new Set<Handle>();
  const members = new Map<string, PresenceMember>();
  // Events are published after the server's write, so two can arrive out of order. Each carries the room's
  // version; an event older than what this user last had applied is stale and is dropped.
  const applied = new Map<string, number>();
  let floor = 0;
  // What this socket wants to be in the room (null: not in it), and what the server last confirmed.
  let desired: Record<string, unknown> | null = null;
  let confirmed: Record<string, unknown> | null = null;
  const pending = new Map<number, Record<string, unknown>>();
  let nextRef = 0;

  const emit = <E extends keyof PresenceEvents>(event: E, payload: PresenceEvents[E]) => {
    for (const handle of handles) {
      for (const handler of handle.listeners.get(event) ?? []) {
        (handler as (p: typeof payload) => void)(payload);
      }
    }
  };
  const sendJoin = () => {
    const ref = ++nextRef;
    pending.set(ref, desired ?? {});
    transport.send({ type: "join", channel, meta: desired ?? {}, ref });
  };
  // The newest join call among the handles still in the room decides the metadata.
  const newestMeta = () => {
    let meta: Record<string, unknown> | null = null;
    for (const handle of handles) if (handle.meta) meta = handle.meta;
    return meta;
  };
  const isStale = (userId: string, version: number | undefined) => {
    if (version === undefined) return false;
    if (version < (applied.get(userId) ?? floor)) return true;
    if (applied.size >= MAX_REMEMBERED_USERS) applied.clear();
    applied.set(userId, version);
    return false;
  };

  const offChannel = transport.on(channel, (message) => {
    const data = message.data as Record<string, unknown> | undefined;
    switch (message.type) {
      case "presence.members": {
        members.clear();
        applied.clear();
        floor = message.v ?? 0;
        for (const member of (data?.members as PresenceMember[] | undefined) ?? []) {
          members.set(member.userId, member);
        }
        emit("sync", [...members.values()]);
        break;
      }
      case "presence.join":
      case "presence.update": {
        const member = data as unknown as PresenceMember;
        if (isStale(member.userId, message.v)) break;
        members.set(member.userId, member);
        emit(message.type === "presence.join" ? "join" : "update", member);
        break;
      }
      case "presence.leave": {
        const userId = (data as { userId: string }).userId;
        if (isStale(userId, message.v)) break;
        members.delete(userId);
        emit("leave", { userId });
        break;
      }
      case "joined": {
        const mine = pending.get(message.ref as number);
        pending.delete(message.ref as number);
        confirmed = mine ?? desired;
        break;
      }
      case "error": {
        const ref = (data as { ref?: number } | undefined)?.ref;
        // A refused join leaves the server holding the earlier metadata, so the socket goes back to it.
        if (ref !== undefined && pending.delete(ref) && pending.size === 0) desired = confirmed;
        emit("error", {
          code: (data as { code?: string } | undefined)?.code ?? "UNKNOWN",
          ...(ref === undefined ? {} : { ref }),
        });
        break;
      }
    }
  });
  const offReady = transport.onReady(() => {
    pending.clear();
    if (desired) sendJoin();
  });

  const room: Room = {
    handles,
    members,
    join(handle, meta) {
      handle.meta = meta;
      desired = meta;
      sendJoin();
    },
    leave(handle) {
      if (!handle.meta) return;
      handle.meta = null;
      const rest = newestMeta();
      if (rest) {
        // Another handle is still in the room, so the socket stays and takes that handle's metadata.
        desired = rest;
        sendJoin();
        return;
      }
      if (!desired && !confirmed) return;
      desired = null;
      confirmed = null;
      pending.clear();
      transport.send({ type: "leave", channel });
    },
    release(handle) {
      room.leave(handle);
      handles.delete(handle);
      if (handles.size > 0) return;
      offReady();
      offChannel();
      rooms.delete(name);
    },
  };
  return room;
}

export function createPresence(
  transport: PresenceTransport,
  name: string,
  rooms: PresenceRooms = new Map(),
): Presence {
  const shared = rooms.get(name) ?? openRoom(transport, name, rooms);
  rooms.set(name, shared);
  const handle: Handle = { listeners: new Map(), meta: null };
  shared.handles.add(handle);

  return {
    join: (meta = {}) => shared.join(handle, meta),
    leave: () => shared.leave(handle),
    members: () => [...shared.members.values()],
    on(event, handler) {
      const set = handle.listeners.get(event) ?? new Set<Handler>();
      handle.listeners.set(event, set);
      set.add(handler as Handler);
      return () => void set.delete(handler as Handler);
    },
    close() {
      handle.listeners.clear();
      shared.release(handle);
    },
  };
}
