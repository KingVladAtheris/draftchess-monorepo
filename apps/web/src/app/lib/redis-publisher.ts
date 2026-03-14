// src/app/lib/redis-publisher.ts
//
// Singleton Redis publisher for use in Next.js API routes.
// API routes cannot access the Socket.IO instance directly (it lives in the
// custom server.ts process). Instead, routes publish events to Redis and the
// socket server's subscriber fan them out to connected clients.
//
// This is the same channel and message format that matchmaker/index.js uses,
// so the socket server's existing subscriber handles everything without changes.
//
// Usage:
//   import { publishGameUpdate, publishQueueEvent } from "@/app/lib/redis-publisher";
//   await publishGameUpdate(gameId, { status: "finished", winnerId, ... });

import { createClient, type RedisClientType } from "redis";

const GAME_EVENTS_CHANNEL = "draftchess:game-events";

let _publisher: RedisClientType | null = null;
let _connectPromise: Promise<void> | null = null;

async function getPublisher(): Promise<RedisClientType> {
  if (_publisher?.isReady) return _publisher;

  if (_connectPromise) {
    await _connectPromise;
    return _publisher!;
  }

  const client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
  client.on("error", (err) => console.error("[redis-publisher] error:", err));

  _connectPromise = client.connect().then(() => {
    _publisher       = client;
    _connectPromise  = null;
  });

  await _connectPromise;
  return _publisher!;
}

// ── Generic Redis client for read operations (e.g. online presence mGet) ──
export async function getRedisClient(): Promise<RedisClientType> {
  return getPublisher();
}

// ── publish a game-room event ─────────────────────────────────────────────
// The socket server's subscriber emits this to `game-{gameId}` room.
export async function publishGameUpdate(
  gameId: number,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const pub = await getPublisher();
    await pub.publish(
      GAME_EVENTS_CHANNEL,
      JSON.stringify({ type: "game", gameId, event: "game-update", payload })
    );
  } catch (err) {
    // Non-fatal: client will reconcile on next poll / reconnect snapshot
    console.error("[redis-publisher] publishGameUpdate failed:", err);
  }
}

// ── publish a queue-user event (e.g. "matched") ───────────────────────────
// The socket server's subscriber emits this to `queue-user-{userId}` room.
export async function publishQueueEvent(
  userId: number,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const pub = await getPublisher();
    await pub.publish(
      GAME_EVENTS_CHANNEL,
      JSON.stringify({ type: "queue-user", userId, event, payload })
    );
  } catch (err) {
    console.error("[redis-publisher] publishQueueEvent failed:", err);
  }
}