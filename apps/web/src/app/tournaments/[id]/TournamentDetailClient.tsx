'use client'

// apps/web/src/app/tournaments/[id]/TournamentDetailClient.tsx

import { useState }  from 'react'
import { useRouter } from 'next/navigation'
import Link          from 'next/link'

interface Prize {
  rankFrom:    number
  rankTo:      number
  prizeType:   string
  tokenSlug:   string | null
  description: string | null
}

interface Player {
  userId:     number
  username:   string
  score:      number
  buchholz:   number
  rank:       number | null
  eliminated: boolean
}

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
  startedAt:   string | null
  finishedAt:  string | null
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

interface Tournament {
  id:                number
  name:              string
  description:       string | null
  mode:              string
  format:            string
  status:            string
  startsAt:          string | null
  registrationEndsAt: string | null
  finishedAt:        string | null
  maxPlayers:        number | null
  minPlayers:        number
  requiredTokenSlug: string | null
  totalPlayers:      number
  activePlayers:     number
  isRegistered:      boolean
  hasRequiredToken:  boolean
  userId:            number | null
  prizes:            Prize[]
  players:           Player[]
  stages:            TStage[]
}

const MODE_COLOR: Record<string, string> = {
  standard: '#6366f1',
  pauper:   '#10b981',
  royal:    '#f59e0b',
}

const STATUS_COLOR: Record<string, string> = {
  upcoming:        '#f0a500',
  active:          '#10b981',
  finished:        '#6b7280',
  cancelled:       '#6b7280',
  awaiting_drafts: '#f0a500',
  pending:         'rgba(255,255,255,0.25)',
  paused:          '#f87171',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function TournamentDetailClient({ tournament: t }: { tournament: Tournament }) {
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered]   = useState(t.isRegistered)
  const [regError, setRegError]       = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState(0)
  const router                        = useRouter()

  const playerMap = Object.fromEntries(t.players.map(p => [p.userId, p.username]))

  async function handleRegister() {
    if (!t.userId) { router.push('/login'); return }
    setRegistering(true)
    setRegError(null)
    const res  = await fetch(`/api/tournaments/${t.id}/register`, { method: 'POST' })
    const data = await res.json()
    setRegistering(false)
    if (!res.ok) { setRegError(data.error); return }
    setRegistered(true)
  }

  const canRegister = t.status === 'upcoming' &&
    !registered &&
    t.hasRequiredToken &&
    (!t.maxPlayers || t.totalPlayers < t.maxPlayers) &&
    (!t.registrationEndsAt || new Date(t.registrationEndsAt) > new Date())

  const regClosed = t.status !== 'upcoming' ||
    (!!t.registrationEndsAt && new Date(t.registrationEndsAt) <= new Date()) ||
    (!!t.maxPlayers && t.totalPlayers >= t.maxPlayers)

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>
      {/* Back */}
      <Link href="/tournaments" style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none', display: 'block', marginBottom: '20px' }}>
        ← All tournaments
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px', marginBottom: '28px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          {/* Name + status + player tracker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: '#fff' }}>{t.name}</h1>
            <span style={{
              padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
              background: `${STATUS_COLOR[t.status] ?? '#888'}18`,
              color:      STATUS_COLOR[t.status] ?? '#888',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {t.status}
            </span>
          </div>

          {/* Player count tracker — prominent */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
            <span style={{ fontSize: '22px', fontWeight: 800, color: '#f0a500' }}>
              {t.status === 'active' ? t.activePlayers : t.totalPlayers}
            </span>
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
              {t.status === 'active'
                ? `/ ${t.totalPlayers} players remaining`
                : t.maxPlayers
                  ? `/ ${t.maxPlayers} spots filled`
                  : 'players registered'}
            </span>
          </div>

          {t.description && (
            <p style={{ margin: '0 0 10px', fontSize: '14px', color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
              {t.description}
            </p>
          )}

          {/* Meta chips */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '5px', background: `${MODE_COLOR[t.mode] ?? '#6366f1'}18`, color: MODE_COLOR[t.mode] ?? '#6366f1', textTransform: 'capitalize' }}>
              {t.mode}
            </span>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', padding: '3px 9px', background: 'rgba(255,255,255,0.05)', borderRadius: '5px' }}>
              {t.stages.length > 1
                ? t.stages.map(s => s.format.replace(/_/g, ' ')).join(' → ')
                : t.format.replace(/_/g, ' ')}
            </span>
            {t.startsAt && (
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', padding: '3px 9px', background: 'rgba(255,255,255,0.05)', borderRadius: '5px' }}>
                Starts {formatDate(t.startsAt)}
              </span>
            )}
            {t.registrationEndsAt && t.status === 'upcoming' && (
              <span style={{ fontSize: '12px', color: '#f0a500', padding: '3px 9px', background: 'rgba(240,165,0,0.08)', borderRadius: '5px' }}>
                Reg. closes {formatDate(t.registrationEndsAt)}
              </span>
            )}
          </div>
        </div>

        {/* Registration CTA */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          {registered ? (
            <div style={{ padding: '12px 20px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '10px', color: '#10b981', fontSize: '14px', fontWeight: 700 }}>
              ✓ You're registered
            </div>
          ) : regClosed ? (
            <div style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
              {t.status !== 'upcoming' ? 'Registration closed' : t.maxPlayers && t.totalPlayers >= t.maxPlayers ? 'Tournament full' : 'Registration closed'}
            </div>
          ) : !t.userId ? (
            <Link href="/login" style={{
              display: 'block', padding: '12px 24px', background: '#f0a500', color: '#0f1117',
              borderRadius: '10px', fontWeight: 700, fontSize: '14px', textDecoration: 'none',
            }}>
              Sign in to register
            </Link>
          ) : !t.hasRequiredToken ? (
            <div style={{ padding: '12px 20px', background: 'rgba(240,165,0,0.08)', border: '1px solid rgba(240,165,0,0.2)', borderRadius: '10px', color: '#f0a500', fontSize: '13px', maxWidth: '200px' }}>
              Requires <strong>{t.requiredTokenSlug}</strong> token
            </div>
          ) : canRegister ? (
            <div>
              <button
                onClick={handleRegister}
                disabled={registering}
                style={{
                  display: 'block', padding: '12px 28px', background: registering ? 'rgba(240,165,0,0.4)' : '#f0a500',
                  color: '#0f1117', border: 'none', borderRadius: '10px', fontWeight: 700,
                  fontSize: '14px', cursor: registering ? 'not-allowed' : 'pointer',
                }}
              >
                {registering ? 'Registering…' : 'Register'}
              </button>
              {regError && <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#f87171', maxWidth: '200px' }}>{regError}</p>}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '24px', alignItems: 'start' }}>

        {/* Left column — stages + rounds */}
        <div>
          {/* Stage tabs if multiple stages */}
          {t.stages.length > 1 && (
            <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '0' }}>
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
                  <span style={{ marginLeft: '5px', fontSize: '10px', color: STATUS_COLOR[s.status] ?? '#888' }}>●</span>
                </button>
              ))}
            </div>
          )}

          {t.stages.length > 0 ? (
            <StageView stage={t.stages[activeStage]!} playerMap={playerMap} tournamentId={t.id} />
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '14px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }}>
              Tournament hasn't started yet
            </div>
          )}
        </div>

        {/* Right column — standings + prizes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Standings */}
          {t.players.length > 0 && (
            <div style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '18px 20px' }}>
              <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: '14px', color: '#fff' }}>
                Standings
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['#', 'Player', 'Pts', 'BH'].map(h => (
                      <th key={h} style={{ padding: '5px 6px', textAlign: 'left', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.3)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.players.map((p, i) => (
                    <tr key={p.userId} style={{ opacity: p.eliminated ? 0.35 : 1 }}>
                      <td style={{ padding: '7px 6px', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>{i + 1}</td>
                      <td style={{ padding: '7px 6px', fontSize: '13px', color: p.userId === t.userId ? '#f0a500' : '#e8eaf0', fontWeight: p.userId === t.userId ? 700 : 400 }}>
                        {p.username}
                        {p.eliminated && <span style={{ marginLeft: '4px', fontSize: '9px', color: '#f87171' }}>out</span>}
                      </td>
                      <td style={{ padding: '7px 6px', fontSize: '13px', color: '#f0a500', fontWeight: 700 }}>{p.score}</td>
                      <td style={{ padding: '7px 6px', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>{p.buchholz}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Prizes */}
          {t.prizes.length > 0 && (
            <div style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '18px 20px' }}>
              <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: '14px', color: '#fff' }}>Prizes</p>
              {t.prizes.map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < t.prizes.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
                    #{p.rankFrom}{p.rankTo !== p.rankFrom ? `–${p.rankTo}` : ''}
                  </span>
                  <span style={{ fontSize: '12px', color: '#f0a500', fontWeight: 600 }}>
                    {p.tokenSlug ?? p.description ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Live view link */}
          {t.status === 'active' && (
            <Link href={`/tournaments/${t.id}/live`} style={{
              display: 'block', padding: '12px', textAlign: 'center',
              background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)',
              borderRadius: '10px', color: '#818cf8', fontSize: '13px', fontWeight: 700,
              textDecoration: 'none',
            }}>
              View live bracket / rounds →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stage view ─────────────────────────────────────────────────────────────────

function StageView({
  stage,
  playerMap,
  tournamentId,
}: {
  stage:        TStage
  playerMap:    Record<number, string>
  tournamentId: number
}) {
  const isElim = stage.format === 'single_elimination'

  return (
    <div>
      <div style={{ marginBottom: '14px' }}>
        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginRight: '8px' }}>
          {stage.format.replace(/_/g, ' ')}
        </span>
        {stage.totalRounds && (
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)' }}>
            {stage.currentRound}/{stage.totalRounds} rounds
          </span>
        )}
      </div>

      {isElim ? (
        <EliminationBracket stage={stage} playerMap={playerMap} />
      ) : (
        <RoundsTable stage={stage} playerMap={playerMap} tournamentId={tournamentId} />
      )}

      {/* Stage placements */}
      {stage.placements.length > 0 && (
        <div style={{ marginTop: '16px', padding: '14px 16px', background: 'rgba(99,102,241,0.06)', borderRadius: '10px', border: '1px solid rgba(99,102,241,0.12)' }}>
          <p style={{ margin: '0 0 8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>
            Final placements
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {stage.placements.map(p => (
              <span key={p.userId} style={{ fontSize: '12px', padding: '3px 9px', background: 'rgba(99,102,241,0.15)', borderRadius: '5px', color: '#818cf8' }}>
                #{p.rankLabel ?? p.rank} {playerMap[p.userId] ?? `User ${p.userId}`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Rounds table (swiss / round robin) ────────────────────────────────────────

function RoundsTable({
  stage,
  playerMap,
  tournamentId,
}: {
  stage:        TStage
  playerMap:    Record<number, string>
  tournamentId: number
}) {
  const [expanded, setExpanded] = useState<number | null>(
    // Auto-expand the most recent non-finished round
    stage.rounds.findIndex(r => r.status !== 'finished'),
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {stage.rounds.map((round, i) => (
        <div key={round.id} style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', overflow: 'hidden' }}>
          {/* Round header — clickable */}
          <div
            onClick={() => setExpanded(expanded === i ? null : i)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#e8eaf0' }}>
              Round {round.roundNumber}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {round.status === 'awaiting_drafts' && round.draftPickDeadline && (
                <Countdown deadline={round.draftPickDeadline} />
              )}
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px',
                background: `${STATUS_COLOR[round.status] ?? '#888'}18`,
                color:      STATUS_COLOR[round.status] ?? '#888',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {round.status.replace(/_/g, ' ')}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>{expanded === i ? '▲' : '▼'}</span>
            </div>
          </div>

          {/* Round games */}
          {expanded === i && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '12px 16px' }}>
              {round.games.map(g => (
                <GameRow
                  key={g.id}
                  game={g}
                  playerMap={playerMap}
                  tournamentId={tournamentId}
                  stageId={stage.id}
                  roundId={round.id}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Elimination bracket ───────────────────────────────────────────────────────

function EliminationBracket({
  stage,
  playerMap,
}: {
  stage:     TStage
  playerMap: Record<number, string>
}) {
  return (
    <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
      {stage.rounds.map(round => (
        <div key={round.id} style={{ minWidth: '180px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>
            Round {round.roundNumber}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {round.games.map(g => (
              <div key={g.id} style={{
                background: 'rgba(255,255,255,0.03)',
                border:     '1px solid rgba(255,255,255,0.07)',
                borderRadius: '8px',
                overflow: 'hidden',
              }}>
                {[
                  { playerId: g.player1Id, isWinner: g.winnerId === g.player1Id },
                  { playerId: g.player2Id, isWinner: g.winnerId === g.player2Id },
                ].map(({ playerId, isWinner }, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding:    '7px 10px',
                      fontSize:   '12px',
                      fontWeight: isWinner ? 700 : 400,
                      color:      isWinner ? '#10b981' : g.isBye && idx === 1 ? 'rgba(255,255,255,0.2)' : '#e8eaf0',
                      background: isWinner ? 'rgba(16,185,129,0.08)' : 'transparent',
                      borderBottom: idx === 0 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    }}
                  >
                    {g.isBye && idx === 1 ? 'BYE' : playerMap[playerId] ?? `Player ${playerId}`}
                    {isWinner && <span style={{ marginLeft: '4px', fontSize: '10px' }}>✓</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Game row ──────────────────────────────────────────────────────────────────

function GameRow({
  game,
  playerMap,
  tournamentId,
  stageId,
  roundId,
}: {
  game:         TGame
  playerMap:    Record<number, string>
  tournamentId: number
  stageId:      number
  roundId:      number
}) {
  const p1 = playerMap[game.player1Id] ?? `Player ${game.player1Id}`
  const p2 = game.isBye ? 'BYE' : (playerMap[game.player2Id] ?? `Player ${game.player2Id}`)

  const result = game.isBye          ? 'BYE'
    : game.isDraw                    ? 'Draw'
    : game.winnerId === game.player1Id ? `${p1} wins`
    : game.winnerId === game.player2Id ? `${p2} wins`
    : null

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: '13px', color: '#e8eaf0' }}>
        <span style={{ fontWeight: game.winnerId === game.player1Id ? 700 : 400, color: game.winnerId === game.player1Id ? '#10b981' : 'inherit' }}>{p1}</span>
        <span style={{ color: 'rgba(255,255,255,0.25)', margin: '0 6px' }}>vs</span>
        <span style={{ fontWeight: game.winnerId === game.player2Id ? 700 : 400, color: game.winnerId === game.player2Id ? '#10b981' : 'inherit' }}>{p2}</span>
      </span>
      <span style={{ fontSize: '12px', color: result ? '#10b981' : 'rgba(255,255,255,0.25)', fontWeight: result ? 600 : 400 }}>
        {result ?? 'pending'}
      </span>
    </div>
  )
}

// ── Countdown timer ───────────────────────────────────────────────────────────

function Countdown({ deadline }: { deadline: string }) {
  const [secs, setSecs] = useState(() => {
    const remaining = Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000))
    return remaining
  })

  useState(() => {
    const interval = setInterval(() => {
      setSecs(s => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(interval)
  })

  if (secs <= 0) return null

  const m = Math.floor(secs / 60)
  const s = secs % 60

  return (
    <span style={{ fontSize: '11px', color: secs < 20 ? '#f87171' : '#f0a500', fontWeight: 700, fontFamily: 'monospace' }}>
      {m}:{String(s).padStart(2, '0')}
    </span>
  )
}
