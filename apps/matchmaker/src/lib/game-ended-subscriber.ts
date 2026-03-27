// apps/matchmaker/src/lib/game-ended-subscriber.ts
//
// Subscribes to the draftchess:game-ended Redis channel.
//
// The web app publishes to this channel when it detects a game-ending
// condition during move processing, resignation, or time expiry.
// The matchmaker is the single owner of all finalization — ELO, stats,
// Postgres writes. The web app detects and reports; we decide and persist.
//
// Message shape published by the web app:
// {
//   gameId:      number
//   winnerId:    number | null
//   endReason:   string
//   finalFen:    string
//   source:      'move-route' | 'resign-route'
//   // All fields below are snapshotted from the Redis game hash
//   // by the web app before publishing, so we don't need a Redis read here.
//   player1Id:        number
//   player2Id:        number
//   mode:             string
//   isFriendGame:     boolean
//   player1EloBefore: number
//   player2EloBefore: number
//   player1GamesPlayed: number
//   player2GamesPlayed: number
// }

import { createClient }      from 'redis'
import { finalizeGame }      from './finalize.js'
import { publishGameUpdate } from './notify.js'
import { cancelTimeoutJob }  from '../queues.js'
import { logger }            from '@draftchess/logger'
import type { GameMode }     from '@draftchess/shared/game-modes'
import type { RedisClientType } from 'redis'
import { recordTournamentGameResult } from '@draftchess/tournament-engine'
import { tournamentQueue }            from '../workers/tournament.js'
import { prisma } from '@draftchess/db'

const log = logger.child({ module: 'matchmaker:game-ended-subscriber' })

export interface GameEndedPayload {
  gameId:             number
  winnerId:           number | null
  endReason:          string
  finalFen:           string
  source:             string
  player1Id:          number
  player2Id:          number
  mode:               string
  isFriendGame:       boolean
  player1EloBefore:   number
  player2EloBefore:   number
  player1GamesPlayed: number
  player2GamesPlayed: number
}

export async function startGameEndedSubscriber(
  redisUrl:  string,
  publisher: RedisClientType,
): Promise<void> {
  const client = createClient({ url: redisUrl }) as RedisClientType
  client.on('error', (err) => log.error({ err }, 'game-ended subscriber redis error'))
  await client.connect()

  await client.subscribe('draftchess:game-ended', async (raw) => {
    let payload: GameEndedPayload

    try {
      payload = JSON.parse(raw) as GameEndedPayload
    } catch (err) {
      log.error({ raw, err }, 'failed to parse game-ended message')
      return
    }

    const {
      gameId, winnerId, endReason, source,
      player1Id, player2Id, mode, isFriendGame,
      player1EloBefore, player2EloBefore,
      player1GamesPlayed, player2GamesPlayed,
    } = payload

    if (
      typeof gameId   !== 'number' ||
      typeof endReason !== 'string' ||
      typeof player1Id !== 'number' ||
      typeof player2Id !== 'number'
    ) {
      log.error({ payload }, 'invalid game-ended payload — missing required fields')
      return
    }

    log.info({ gameId, endReason, source, winnerId }, 'received game-ended event')

    // Cancel the timeout job — the game is already over.
    // Idempotent, safe to call even if the job doesn't exist.
    await cancelTimeoutJob(gameId)

    try {
      const result = await finalizeGame(
        gameId,
        winnerId,
        player1Id,
        player2Id,
        player1EloBefore,
        player2EloBefore,
        player1GamesPlayed,
        player2GamesPlayed,
        endReason,
        (mode ?? 'standard') as GameMode,
        isFriendGame === true,
        publisher,
      )

      if (!result) {
        // Optimistic lock returned 0 — another path already finalized this game.
        // This is expected if the timeout worker and move route race.
        log.info({ gameId }, 'game already finalized by another path — skipping')
        return
      }

      await publishGameUpdate(publisher, gameId, {
        status:          'finished',
        winnerId,
        endReason,
        player1EloAfter: result.newP1Elo,
        player2EloAfter: result.newP2Elo,
        eloChange:       result.eloChange,
      })

    } catch (err: any) {
      log.error({ gameId, err: err.message }, 'error processing game-ended event')
    }

    const DRAW_END_REASONS = new Set([
      'draw',
      'stalemate',
      'repetition',
      'draw_agreement',
      'insufficient_material',
    ])

    try {
      const tGame = await prisma.tournamentGame.findFirst({
        where:   { gameId: payload.gameId },
        select:  { id: true, roundId: true },
      })

      if (tGame) {
        const isDraw = DRAW_END_REASONS.has(payload.endReason ?? '')

        await recordTournamentGameResult({
          tournamentGameId: tGame.id,
          winnerId:         isDraw ? null : (payload.winnerId ?? null),
          isDraw,
        })

        await tournamentQueue.add('tournament', {
          type:    'round-check',
          roundId: tGame.roundId,
        })
      }
    } catch (err: any) {
      // Non-fatal — log and continue. The round-check can be manually triggered
      // from the admin panel if needed.
      log.error({ gameId: payload.gameId, err: err.message }, 'tournament result mirror failed')
    }

  })

  log.info('subscribed to draftchess:game-ended')
}
