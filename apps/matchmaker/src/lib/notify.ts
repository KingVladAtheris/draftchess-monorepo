// apps/matchmaker/src/lib/notify.ts
import type { RedisClientType } from 'redis'

const GAME_EVENTS_CHANNEL = 'draftchess:game-events'

// The publisher client is passed in from index.ts so this module
// doesn't create its own Redis connection.
export async function publishGameUpdate(
  publisher: RedisClientType,
  gameId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await publisher.publish(
      GAME_EVENTS_CHANNEL,
      JSON.stringify({ type: 'game', gameId, event: 'game-update', payload }),
    )
  } catch (err: any) {
    console.error('[notify] publishGameUpdate failed:', err.message)
  }
}

export async function notifyMatch(
  publisher: RedisClientType,
  gameId: number,
  userIds: number[],
): Promise<void> {
  for (const userId of userIds) {
    try {
      await publisher.publish(
        GAME_EVENTS_CHANNEL,
        JSON.stringify({ type: 'queue-user', userId, event: 'matched', payload: { gameId } }),
      )
    } catch (err: any) {
      console.error(`[notify] notifyMatch failed for user ${userId}:`, err.message)
    }
  }
  console.log(`[notify] notified users ${userIds.join(', ')} of game ${gameId}`)
}
