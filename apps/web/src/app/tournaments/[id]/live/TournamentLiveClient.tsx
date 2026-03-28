'use client'

// apps/web/src/app/tournaments/[id]/live/TournamentLiveClient.tsx
//
// Polls /api/tournaments/[id]/live every 15 seconds for fresh data.
// Also listens for tournament_pick_draft notification via socket so
// the player is redirected to the pick page immediately when a round starts.

import { useState, useEffect, useCallback } from 'react'
import { useRouter }                         from 'next/navigation'
import Link                                  from 'next/link'
import { getSocket }                         from '@/app/lib/socket'

interface TGame {
  id:         number
  player1Id:  number
  player2Id:  number
  isBye:      boolean
  winnerId:   number | null
  isDraw:     boolean
  gameId:     number | null
  gameStatus: string | null
}

interface TRound {
  id:          number
  roundNumber: number
  status:      string
  draftPickDeadline: string | null
  games:       TGame[]
}

interface TStage {
  id:           number
  stageNumber:  number
  name:         string | null
  format:       string
  status:       string
  totalRounds:  number | null
  currentRound: number
  advanceCount: number | null
  placements:   { userId: number; rank: number; rankLabel: string | null }[]
  rounds:       TRound[]
}

interface LiveTournament {
  id:           number
  name:         string
  mode:         string
  status:       string
  totalPlayers: number
  activePlayers: number
  userId:       number | null
  players: {
    userId:     number
    username:   string
    score:      number
    buchholz:   number
    eliminated: boolean
  }[]
  stages: TStage[]
}

const STATUS_COLOR: Record<string, string> = {
  active:          '#10b981',
  awaiting_drafts: '#f0a500',
  finished:        '#6b7280',
  pending:         'rgba(255,255,255,0.2)',
}

const MODE_COLOR: Record<string, string> = {
  standard: '#6366f1',
  pauper:   '#10b981',
  royal:    '#f59e0b',
}

export default function TournamentLiveClient({ tournament: init }: { tournament: LiveTournament }) {
  const [t, setT]             = useState(init)
  const [activeStage, setActiveStage] = useState(0)
  const [lastRefresh, setLastRefresh] = useState(Date.now())
  const router                = useRouter()

  // ── Poll for fresh data every 15 seconds ────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`/api/tournaments/${t.id}/live`)
        if (!res.ok) return
        const data = await res.json()
        setT(data.tournament)
        setLastRefresh(Date.now())
      } catch {
        // silent — stale data is fine for a few ticks
      }
    }, 15_000)

    return () => clearInterval(interval)
  }, [t.id])

  // ── Socket: listen for tournament_pick_draft and tournament-game-ready ───────
  useEffect(() => {
    if (!t.userId) return

    let mounted = true

    getSocket().then(socket => {
      if (!mounted) return

      socket.on('notification', (data: any) => {
        if (!mounted) return
        if (
          data.notificationType === 'tournament_pick_draft' &&
          data.payload?.tournamentId === t.id
        ) {
          const { roundId } = data.payload
          router.push(`/tournaments/${t.id}/${roundId}/pick`)
        }
      })

      socket.on('tournament-game-ready', (data: any) => {
        if (!mounted) return
        if (data.tournamentId === t.id) {
          router.push(`/play/game/${data.gameId}`)
        }
      })
    }).catch(() => {})

    return () => {
      mounted = false
      getSocket().then(s => {
        s.off('notification')
        s.off('tournament-game-ready')
      }).catch(() => {})
    }
  }, [t.id, t.userId, router])

  const playerMap = Object.fromEntries(t.players.map(p => [p.userId, p.username]))

  const currentStage = t.stages[activeStage]

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <Link href={`/tournaments/${t.id}`} style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none', display: 'block', marginBottom: '6px' }}>
            ← Tournament details
          </Link>
          <h1 style={{ margin: '0 0 4px', fontSize: '24px', fontWeight: 800, color: '#fff' }}>{t.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: `${MODE_COLOR[t.mode] ?? '#6366f1'}18`, color: MODE_COLOR[t.mode] ?? '#6366f1', textTransform: 'capitalize' }}>{t.mode}</span>
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
              {t.activePlayers} / {t.totalPlayers} players remaining
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>
            Updated {Math.round((Date.now() - lastRefresh) / 1000)}s ago
          </span>
          <button
            onClick={async () => {
              const res  = await fetch(`/api/tournaments/${t.id}/live`)
              if (res.ok) { const d = await res.json(); setT(d.tournament); setLastRefresh(Date.now()) }
            }}
            style={{ display: 'block', marginTop: '4px', marginLeft: 'auto', padding: '5px 12px', fontSize: '11px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: '24px', alignItems: 'start' }}>

        {/* Left — stages and rounds */}
        <div>
          {/* Stage tabs */}
          {t.stages.length > 1 && (
            <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              {t.stages.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setActiveStage(i)}
                  style={{
                    padding: '7px 14px', fontSize: '12px', fontWeight: activeStage === i ? 700 : 400,
                    color: activeStage === i ? '#fff' : 'rgba(255,255,255,0.4)',
                    background: 'none', border: 'none',
                    borderBottom: activeStage === i ? '2px solid #f0a500' : '2px solid transparent',
                    cursor: 'pointer', marginBottom: '-1px',
                  }}
                >
                  {s.name ?? `Stage ${s.stageNumber}`}
                  <span style={{ marginLeft: '5px', fontSize: '9px', color: STATUS_COLOR[s.status] ?? '#888' }}>●</span>
                </button>
              ))}
            </div>
          )}

          {currentStage ? (
            currentStage.format === 'single_elimination' ? (
              <LiveBracket stage={currentStage} playerMap={playerMap} />
            ) : (
              <LiveRounds stage={currentStage} playerMap={playerMap} tournamentId={t.id} userId={t.userId} />
            )
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '14px' }}>
              No rounds started yet
            </div>
          )}
        </div>

        {/* Right — standings */}
        <div>
          <div style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '18px 20px', position: 'sticky', top: '24px' }}>
            <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: '14px', color: '#fff' }}>
              Live standings
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['#', 'Player', 'Pts', 'BH'].map(h => (
                    <th key={h} style={{ padding: '4px 5px', textAlign: 'left', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.3)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.players.map((p, i) => (
                  <tr key={p.userId} style={{ opacity: p.eliminated ? 0.3 : 1 }}>
                    <td style={{ padding: '6px 5px', fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>{i + 1}</td>
                    <td style={{ padding: '6px 5px', fontSize: '12px', color: p.userId === t.userId ? '#f0a500' : '#e8eaf0', fontWeight: p.userId === t.userId ? 700 : 400 }}>
                      {p.username}
                      {p.eliminated && <span style={{ marginLeft: '3px', fontSize: '9px', color: '#f87171' }}>✗</span>}
                    </td>
                    <td style={{ padding: '6px 5px', fontSize: '13px', color: '#f0a500', fontWeight: 700 }}>{p.score}</td>
                    <td style={{ padding: '6px 5px', fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>{p.buchholz}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Live rounds (swiss / RR) ──────────────────────────────────────────────────

function LiveRounds({
  stage,
  playerMap,
  tournamentId,
  userId,
}: {
  stage:        TStage
  playerMap:    Record<number, string>
  tournamentId: number
  userId:       number | null
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {stage.rounds.map(round => (
        <div key={round.id} style={{ background: '#1a1d2e', border: `1px solid ${round.status === 'active' || round.status === 'awaiting_drafts' ? 'rgba(240,165,0,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: '10px', padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>Round {round.roundNumber}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {round.status === 'awaiting_drafts' && round.draftPickDeadline && (
                <PickCountdown
                  deadline={round.draftPickDeadline}
                  tournamentId={tournamentId}
                  roundId={round.id}
                  userId={userId}
                  games={round.games}
                />
              )}
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px',
                background: `${STATUS_COLOR[round.status] ?? '#888'}18`,
                color:      STATUS_COLOR[round.status] ?? '#888',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {round.status.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          {round.games.map(g => {
            const p1 = playerMap[g.player1Id] ?? `Player ${g.player1Id}`
            const p2 = g.isBye ? 'BYE' : (playerMap[g.player2Id] ?? `Player ${g.player2Id}`)
            const result = g.isBye ? 'BYE'
              : g.isDraw  ? 'Draw'
              : g.winnerId === g.player1Id ? `${p1} wins`
              : g.winnerId === g.player2Id ? `${p2} wins`
              : g.gameStatus === 'active' ? 'In progress'
              : 'Pending'

            return (
              <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize: '13px', color: '#e8eaf0' }}>
                  <span style={{ fontWeight: g.winnerId === g.player1Id ? 700 : 400, color: g.winnerId === g.player1Id ? '#10b981' : 'inherit' }}>{p1}</span>
                  <span style={{ color: 'rgba(255,255,255,0.2)', margin: '0 6px' }}>vs</span>
                  <span style={{ fontWeight: g.winnerId === g.player2Id ? 700 : 400, color: g.winnerId === g.player2Id ? '#10b981' : 'inherit' }}>{p2}</span>
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', color: g.winnerId || g.isDraw ? '#10b981' : g.gameStatus === 'active' ? '#f0a500' : 'rgba(255,255,255,0.25)' }}>
                    {result}
                  </span>
                  {g.gameId && g.gameStatus === 'active' && (
                    <Link href={`/play/game/${g.gameId}`} style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderRadius: '4px', textDecoration: 'none' }}>
                      Watch
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Live elimination bracket ──────────────────────────────────────────────────

function LiveBracket({ stage, playerMap }: { stage: TStage; playerMap: Record<number, string> }) {
  return (
    <div style={{ overflowX: 'auto', paddingBottom: '8px' }}>
      <div style={{ display: 'flex', gap: '24px', minWidth: 'max-content' }}>
        {stage.rounds.map(round => (
          <div key={round.id} style={{ width: '200px' }}>
            <p style={{ margin: '0 0 10px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>
              Round {round.roundNumber}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {round.games.map(g => {
                const p1 = playerMap[g.player1Id] ?? `Player ${g.player1Id}`
                const p2 = g.isBye ? 'BYE' : (playerMap[g.player2Id] ?? `Player ${g.player2Id}`)
                return (
                  <div key={g.id} style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', overflow: 'hidden' }}>
                    {[
                      { label: p1, won: g.winnerId === g.player1Id },
                      { label: g.isBye ? 'BYE' : p2, won: !g.isBye && g.winnerId === g.player2Id, isBye: g.isBye },
                    ].map(({ label, won, isBye }, idx) => (
                      <div key={idx} style={{
                        padding: '8px 10px', fontSize: '12px',
                        fontWeight: won ? 700 : 400,
                        color:     won ? '#10b981' : isBye ? 'rgba(255,255,255,0.2)' : '#e8eaf0',
                        background: won ? 'rgba(16,185,129,0.08)' : 'transparent',
                        borderBottom: idx === 0 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                      }}>
                        {label}
                        {won && <span style={{ marginLeft: '4px', fontSize: '10px' }}>✓</span>}
                        {g.gameId && g.gameStatus === 'active' && idx === 0 && (
                          <Link href={`/play/game/${g.gameId}`} style={{ marginLeft: '6px', fontSize: '10px', color: '#818cf8' }}>live</Link>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Pick countdown with link ──────────────────────────────────────────────────

function PickCountdown({
  deadline,
  tournamentId,
  roundId,
  userId,
  games,
}: {
  deadline:     string
  tournamentId: number
  roundId:      number
  userId:       number | null
  games:        TGame[]
}) {
  const [secs, setSecs] = useState(() =>
    Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000)),
  )

  useEffect(() => {
    const interval = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(interval)
  }, [])

  const isInRound = userId && games.some(g => g.player1Id === userId || g.player2Id === userId)
  const m = Math.floor(secs / 60)
  const s = secs % 60

  if (secs <= 0 && !isInRound) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {secs > 0 && (
        <span style={{ fontSize: '11px', color: secs < 15 ? '#f87171' : '#f0a500', fontWeight: 700, fontFamily: 'monospace' }}>
          {m}:{String(s).padStart(2, '0')}
        </span>
      )}
      {isInRound && (
        <Link href={`/tournaments/${tournamentId}/${roundId}/pick`} style={{
          fontSize: '11px', fontWeight: 700, padding: '3px 8px',
          background: '#f0a500', color: '#0f1117', borderRadius: '5px',
          textDecoration: 'none',
        }}>
          Pick draft →
        </Link>
      )}
    </div>
  )
}
