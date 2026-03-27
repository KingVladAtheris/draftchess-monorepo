'use client'

// apps/web/src/app/admin/tournaments/[id]/TournamentMonitor.tsx

import { useState }  from 'react'
import { useRouter } from 'next/navigation'
import Link          from 'next/link'

interface TGame {
  id:            number
  player1Id:     number
  player2Id:     number
  isBye:         boolean
  winnerId:      number | null
  isDraw:        boolean
  player1DraftId: number | null
  player2DraftId: number | null
  game:          { id: number; status: string; winnerId: number | null; endReason: string | null } | null
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
  id:          number
  stageNumber: number
  name:        string | null
  format:      string
  status:      string
  totalRounds: number | null
  currentRound: number
  advanceCount: number | null
  rounds:      TRound[]
  placements:  { userId: number; rank: number; rankLabel: string | null }[]
}

interface TPlayer {
  userId: number
  score:  number
  buchholz: number
  rank:   number | null
  eliminated: boolean
  user:   { id: number; username: string }
}

interface Tournament {
  id:          number
  name:        string
  status:      string
  mode:        string
  players:     TPlayer[]
  stages:      TStage[]
  prizes:      { id: number; rankFrom: number; rankTo: number; prizeType: string; tokenSlug: string | null; description: string | null }[]
}

const STATUS_COLOR: Record<string, string> = {
  upcoming:        '#f0a500',
  active:          '#10b981',
  finished:        '#6366f1',
  cancelled:       '#6b7280',
  awaiting_drafts: '#f0a500',
  pending:         'rgba(255,255,255,0.3)',
  paused:          '#f87171',
}

const S: Record<string, React.CSSProperties> = {
  page:  { maxWidth: '1100px', margin: '0 auto', padding: '40px 24px' },
  card:  { background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '20px 24px', marginBottom: '16px' },
  btn:   { padding: '7px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: 'pointer' },
  badge: { padding: '3px 8px', borderRadius: '5px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  th:    { padding: '8px 12px', textAlign: 'left' as const, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.06)' },
  td:    { padding: '10px 12px', fontSize: '13px', color: '#e8eaf0', borderBottom: '1px solid rgba(255,255,255,0.04)' },
}

export default function TournamentMonitor({ tournament: init }: { tournament: Tournament }) {
  const [t, setT]             = useState(init)
  const [loading, setLoading] = useState<string | null>(null)
  const [msg, setMsg]         = useState<string | null>(null)
  const [dqUser, setDqUser]   = useState('')
  const router                = useRouter()

  async function action(body: object, label: string) {
    setLoading(label)
    setMsg(null)
    const res  = await fetch(`/admin/api/tournaments/${t.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const data = await res.json()
    setLoading(null)
    if (!res.ok) { setMsg(`Error: ${data.error}`); return }
    setMsg(`${label} — done`)
    router.refresh()
  }

  const playerMap = Object.fromEntries(t.players.map(p => [p.userId, p.user.username]))

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <Link href="/admin/tournaments" style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>← Tournaments</Link>
          <h1 style={{ margin: '6px 0 4px', fontSize: '26px', fontWeight: 700, color: '#fff' }}>{t.name}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
            {t.mode} · {t.players.length} player{t.players.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <span style={{ ...S.badge, background: `${STATUS_COLOR[t.status] ?? '#888'}22`, color: STATUS_COLOR[t.status] ?? '#888' }}>
            {t.status}
          </span>
          {t.status === 'upcoming' && (
            <button
              style={{ ...S.btn, background: '#10b981', color: '#fff' }}
              disabled={!!loading}
              onClick={() => action({ action: 'activate' }, 'Activate')}
            >
              {loading === 'Activate' ? '…' : 'Activate tournament'}
            </button>
          )}
          {(t.status === 'upcoming' || t.status === 'active') && (
            <button
              style={{ ...S.btn, background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
              disabled={!!loading}
              onClick={() => { if (confirm('Cancel this tournament?')) action({ action: 'cancel' }, 'Cancel') }}
            >
              {loading === 'Cancel' ? '…' : 'Cancel tournament'}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div style={{ padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', background: msg.startsWith('Error') ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: msg.startsWith('Error') ? '#f87171' : '#10b981', border: `1px solid ${msg.startsWith('Error') ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}` }}>
          {msg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px', alignItems: 'start' }}>
        {/* Left — stages */}
        <div>
          {t.stages.map(stage => (
            <div key={stage.id} style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <p style={{ margin: '0 0 3px', fontWeight: 700, color: '#fff', fontSize: '15px' }}>
                    Stage {stage.stageNumber}{stage.name ? ` — ${stage.name}` : ''}&nbsp;
                    <span style={{ ...S.badge, background: `${STATUS_COLOR[stage.status] ?? '#888'}22`, color: STATUS_COLOR[stage.status] ?? '#888' }}>
                      {stage.status}
                    </span>
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                    {stage.format.replace('_', ' ')}
                    {stage.totalRounds ? ` · ${stage.totalRounds} rounds` : ''}
                    {stage.advanceCount ? ` · top ${stage.advanceCount} advance` : ' · final stage'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {stage.status === 'active' && (
                    <button style={{ ...S.btn, background: 'rgba(248,113,113,0.12)', color: '#f87171' }} disabled={!!loading} onClick={() => action({ action: 'pause-stage', stageId: stage.id }, 'Pause')}>
                      {loading === 'Pause' ? '…' : 'Pause'}
                    </button>
                  )}
                  {stage.status === 'paused' && (
                    <button style={{ ...S.btn, background: 'rgba(16,185,129,0.12)', color: '#10b981' }} disabled={!!loading} onClick={() => action({ action: 'resume-stage', stageId: stage.id }, 'Resume')}>
                      {loading === 'Resume' ? '…' : 'Resume'}
                    </button>
                  )}
                  {(stage.status === 'active' || stage.status === 'paused') && (
                    <button style={{ ...S.btn, background: 'rgba(99,102,241,0.12)', color: '#818cf8' }} disabled={!!loading} onClick={() => { if (confirm('Force-finish this stage?')) action({ action: 'end-stage', stageId: stage.id }, 'End stage') }}>
                      {loading === 'End stage' ? '…' : 'End stage'}
                    </button>
                  )}
                </div>
              </div>

              {/* Rounds */}
              {stage.rounds.map(round => (
                <div key={round.id} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '12px 14px', marginBottom: '8px' }}>
                  <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: '13px', color: 'rgba(255,255,255,0.6)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Round {round.roundNumber}</span>
                    <span style={{ ...S.badge, background: `${STATUS_COLOR[round.status] ?? '#888'}22`, color: STATUS_COLOR[round.status] ?? '#888' }}>
                      {round.status.replace('_', ' ')}
                    </span>
                  </p>
                  {round.draftPickDeadline && round.status === 'awaiting_drafts' && (
                    <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#f0a500' }}>
                      Pick deadline: {new Date(round.draftPickDeadline).toLocaleTimeString()}
                    </p>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Player 1', 'Player 2', 'Draft picked', 'Status'].map(h => (
                          <th key={h} style={S.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {round.games.map(g => {
                        const gameStatus = g.isBye ? 'BYE'
                          : g.winnerId    ? `Win: ${playerMap[g.winnerId] ?? g.winnerId}`
                          : g.isDraw      ? 'Draw'
                          : g.game?.status ?? 'pending'

                        const draftStatus = g.isBye ? '—'
                          : (g.player1DraftId ? '✓' : '…') + ' / ' + (g.player2DraftId ? '✓' : '…')

                        return (
                          <tr key={g.id}>
                            <td style={S.td}>{playerMap[g.player1Id] ?? g.player1Id}</td>
                            <td style={S.td}>{g.isBye ? '(BYE)' : playerMap[g.player2Id] ?? g.player2Id}</td>
                            <td style={{ ...S.td, fontFamily: 'monospace', fontSize: '12px' }}>{draftStatus}</td>
                            <td style={{ ...S.td, color: g.winnerId || g.isDraw ? '#10b981' : 'inherit' }}>{gameStatus}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ))}

              {/* Stage placements */}
              {stage.placements.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <p style={{ margin: '0 0 6px', fontSize: '11px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Final placements</p>
                  {stage.placements.map(p => (
                    <span key={p.userId} style={{ display: 'inline-block', margin: '0 6px 4px 0', padding: '3px 8px', background: 'rgba(99,102,241,0.15)', borderRadius: '5px', fontSize: '12px', color: '#818cf8' }}>
                      #{p.rankLabel ?? p.rank} {playerMap[p.userId] ?? p.userId}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right — participants + actions */}
        <div>
          {/* Standings */}
          <div style={S.card}>
            <p style={{ margin: '0 0 12px', fontWeight: 700, color: '#fff', fontSize: '14px' }}>Standings</p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Player', 'Score', 'BH'].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {t.players.map((p, i) => (
                  <tr key={p.userId} style={{ opacity: p.eliminated ? 0.4 : 1 }}>
                    <td style={S.td}>
                      {i + 1}. {p.user.username}
                      {p.eliminated && <span style={{ marginLeft: '4px', fontSize: '10px', color: '#f87171' }}>elim.</span>}
                    </td>
                    <td style={{ ...S.td, fontWeight: 700, color: '#f0a500' }}>{p.score}</td>
                    <td style={{ ...S.td, color: 'rgba(255,255,255,0.4)' }}>{p.buchholz}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Disqualify */}
          {t.status === 'active' && (
            <div style={S.card}>
              <p style={{ margin: '0 0 10px', fontWeight: 700, color: '#fff', fontSize: '14px' }}>Disqualify player</p>
              <select
                style={{ width: '100%', padding: '8px 10px', fontSize: '13px', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', outline: 'none', marginBottom: '8px' }}
                value={dqUser}
                onChange={e => setDqUser(e.target.value)}
              >
                <option value="">Select player…</option>
                {t.players.filter(p => !p.eliminated).map(p => (
                  <option key={p.userId} value={String(p.userId)}>{p.user.username}</option>
                ))}
              </select>
              <button
                style={{ ...S.btn, background: 'rgba(239,68,68,0.15)', color: '#f87171', width: '100%' }}
                disabled={!dqUser || !!loading}
                onClick={() => {
                  if (!dqUser) return
                  const name = t.players.find(p => p.userId === parseInt(dqUser))?.user.username
                  if (confirm(`Disqualify ${name}?`)) {
                    action({ action: 'disqualify', userId: parseInt(dqUser) }, 'Disqualify')
                    setDqUser('')
                  }
                }}
              >
                {loading === 'Disqualify' ? '…' : 'Disqualify'}
              </button>
            </div>
          )}

          {/* Prizes */}
          {t.prizes.length > 0 && (
            <div style={S.card}>
              <p style={{ margin: '0 0 10px', fontWeight: 700, color: '#fff', fontSize: '14px' }}>Prizes</p>
              {t.prizes.map(p => (
                <p key={p.id} style={{ margin: '0 0 6px', fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
                  #{p.rankFrom}{p.rankTo !== p.rankFrom ? `–${p.rankTo}` : ''}: {p.tokenSlug ?? p.description ?? '—'}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
