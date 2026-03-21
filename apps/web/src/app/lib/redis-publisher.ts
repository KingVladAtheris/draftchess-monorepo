// apps/web/src/app/lib/redis-publisher.ts
//
// Singleton Redis publisher for use in Next.js API routes.
// API routes cannot access the Socket.IO instance directly (it lives in the
// custom socket-server process). Instead, routes publish events to Redis and
// the socket server's subscriber fans them out to connected clients.

import { createClient, type RedisClientType } from "redis";
import { logger } from "@draftchess/logger";

const log = logger.child({ module: "web:redis-publisher" });

const GAME_EVENTS_CHANNEL   = "draftchess:game-events";
const NOTIFICATIONS_CHANNEL = "draftchess:notifications";

let _publisher: RedisClientType | null = null;
let _connectPromise: Promise<void> | null = null;

async function getPublisher(): Promise<RedisClientType> {
  if (_publisher?.isReady) return _publisher;

  if (_connectPromise) {
    await _connectPromise;
    return _publisher!;
  }

  const client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
  client.on("error", (err) => log.error({ err }, "redis publisher error"));

  _connectPromise = client.connect().then(() => {
    _publisher      = client;
    _connectPromise = null;
  });

  await _connectPromise;
  return _publisher!;
}

// ── Generic Redis client for read operations (e.g. online presence mGet) ──
export async function getRedisClient(): Promise<RedisClientType> {
  return getPublisher();
}

// ── Publish to any channel ─────────────────────────────────────────────────
// Used by the move and resign routes to publish to draftchess:game-ended
// and draftchess:game-started without importing channel name strings.
export async function publishToChannel(
  channel: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const pub = await getPublisher();
    await pub.publish(channel, JSON.stringify(payload));
  } catch (err: any) {
    log.error({ channel, err: err.message }, "publishToChannel failed")
  }
}

// ── Publish a game-room event ──────────────────────────────────────────────
// The socket server's subscriber emits this to `game-{gameId}` room.
export async function publishGameUpdate(
  gameId:  number,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const pub = await getPublisher();
    await pub.publish(
      GAME_EVENTS_CHANNEL,
      JSON.stringify({ type: "game", gameId, event: "game-update", payload }),
    );
  } catch (err: any) {
    log.error({ gameId, err: err.message }, "publishGameUpdate failed");
  }
}

// ── Publish a queue-user event (e.g. "matched") ───────────────────────────
// The socket server's subscriber emits this to `queue-user-{userId}` room.
export async function publishQueueEvent(
  userId:  number,
  event:   string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const pub = await getPublisher();
    await pub.publish(
      GAME_EVENTS_CHANNEL,
      JSON.stringify({ type: "queue-user", userId, event, payload }),
    );
  } catch (err: any) {
    log.error({ userId, event, err: err.message }, "publishQueueEvent failed");
  }
}

// ── Publish a notification to a user ──────────────────────────────────────
// Delivered to `queue-user-{userId}` room by the socket server's
// notifications subscriber.
export async function publishNotification(
  userId:  number,
  type:    string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const pub = await getPublisher();
    await pub.publish(
      NOTIFICATIONS_CHANNEL,
      JSON.stringify({ type: "notification", userId, notificationType: type, payload }),
    );
  } catch (err: any) {
    log.error({ userId, type, err: err.message }, "publishNotification failed");
  }
}
