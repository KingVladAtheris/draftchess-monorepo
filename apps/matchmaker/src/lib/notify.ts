// apps/matchmaker/src/lib/notify.ts
//
// Redis pub/sub publishing helpers for the matchmaker.
// Uses two channels per our architecture decisions:
//   draftchess:game-events    — game state changes
//   draftchess:notifications  — social and system notifications (future use)
//
// The publisher client is passed in from index.ts so this module
// doesn't create its own Redis connection.

import { logger }           from '@draftchess/logger'
import type { RedisClientType } from 'redis'

const log = logger.child({ module: 'matchmaker:notify' })

const GAME_EVENTS_CHANNEL    = 'draftchess:game-events'
const NOTIFICATIONS_CHANNEL  = 'draftchess:notifications'

// ── Game events ───────────────────────────────────────────────────────────────

export async function publishGameUpdate(
  publisher: RedisClientType,
  gameId:    number,
  payload:   Record<string, unknown>,
): Promise<void> {
  try {
    await publisher.publish(
      GAME_EVENTS_CHANNEL,
      JSON.stringify({ type: 'game', gameId, event: 'game-update', payload }),
    )
  } catch (err: any) {
    log.error({ gameId, err: err.message }, 'publishGameUpdate failed')
  }
}

export async function notifyMatch(
  publisher: RedisClientType,
  gameId:    number,
  userIds:   number[],
): Promise<void> {
  for (const userId of userIds) {
    try {
      await publisher.publish(
        GAME_EVENTS_CHANNEL,
        JSON.stringify({ type: 'queue-user', userId, event: 'matched', payload: { gameId } }),
      )
    } catch (err: any) {
      log.error({ gameId, userId, err: err.message }, 'notifyMatch failed')
    }
  }
  log.info({ gameId, userIds }, 'notified users of match')
}

// ── Notification events ───────────────────────────────────────────────────────
// Used for social and system notifications (token grants, friend requests etc).
// Published to draftchess:notifications, delivered to queue-user-{userId} rooms
// by the socket server's notifications subscriber.

export async function publishNotification(
  publisher: RedisClientType,
  userId:    number,
  type:      string,
  payload:   Record<string, unknown>,
): Promise<void> {
  try {
    await publisher.publish(
      NOTIFICATIONS_CHANNEL,
      JSON.stringify({ type: 'notification', userId, notificationType: type, payload }),
    )
  } catch (err: any) {
    log.error({ userId, type, err: err.message }, 'publishNotification failed')
  }
}