'use client'

// apps/web/src/app/tournaments/TournamentsListClient.tsx

import { useState }        from 'react'
import Link                from 'next/link'

type TStatus = 'upcoming' | 'active' | 'finished' | 'cancelled'

interface TournamentSummary {
  id:                number
  name:              string
  description:       string | null
  mode:              string
  format:            string
  status:            TStatus
  startsAt:          string | null
  registrationEndsAt: string | null
  finishedAt:        string | null
  maxPlayers:        number | null
  minPlayers:        number
  requiredTokenSlug: string | null
  playerCount:       number
  stageFormats:      string[]
  isRegistered:      boolean
  prizes:            { rankFrom: number; rankTo: number; prizeType: string; tokenSlug: string | null; description: string | null }[]
}

const STATUS_LABEL: Record<TStatus, string> = {
  upcoming: 'Registration open',
  active:   'In progress',
  finished: 'Finished',
  cancelled:'Cancelled',
}

const STATUS_COLOR: Record<TStatus, string> = {
  upcoming: '#f0a500',
  active:   '#10b981',
  finished: '#6b7280',
  cancelled:'#6b7280',
}

const MODE_COLOR: Record<string, string> = {
  standard: '#6366f1',
  pauper:   '#10b981',
  royal:    '#f59e0b',
}

const TABS: { key: TStatus | 'all'; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'active',   label: 'Active' },
  { key: 'finished', label: 'Finished' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatFormat(stageFormats: string[], topLevel: string): string {
  if (stageFormats.length === 1) return stageFormats[0]!.replace(/_/g, ' ')
  if (stageFormats.length > 1)   return stageFormats.map(f => f.replace(/_/g, ' ')).join(' → ')
  return topLevel.replace(/_/g, ' ')
}

export default function TournamentsListClient({
  tournaments,
  isLoggedIn,
}: {
  tournaments: TournamentSummary[]
  isLoggedIn:  boolean
}) {
  const [tab, setTab] = useState<TStatus | 'all'>('all')

  const visible = tab === 'all'
    ? tournaments
    : tournaments.filter(t => t.status === tab)

  const counts = {
    all:      tournaments.length,
    upcoming: tournaments.filter(t => t.status === 'upcoming').length,
    active:   tournaments.filter(t => t.status === 'active').length,
    finished: tournaments.filter(t => t.status === 'finished').length,
  }

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', padding: '48px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '28px', fontWeight: 800, color: '#fff' }}>
          Tournaments
        </h1>
        <p style={{ margin: 0, fontSize: '14px', color: 'rgba(255,255,255,0.4)' }}>
          Compete against other players in structured tournaments
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '0' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding:         '8px 16px',
              fontSize:        '13px',
              fontWeight:      tab === t.key ? 700 : 400,
              color:           tab === t.key ? '#fff' : 'rgba(255,255,255,0.4)',
              background:      'none',
              border:          'none',
              borderBottom:    tab === t.key ? '2px solid #f0a500' : '2px solid transparent',
              cursor:          'pointer',
              marginBottom:    '-1px',
              transition:      'color 0.15s',
            }}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span style={{ marginLeft: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tournament cards */}
      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.25)', fontSize: '14px' }}>
          No {tab === 'all' ? '' : tab} tournaments
        </div>
      ) : (
        visible.map(t => (
          <Link key={t.id} href={`/tournaments/${t.id}`} style={{ textDecoration: 'none', display: 'block', marginBottom: '12px' }}>
            <div style={{
              background:   '#1a1d2e',
              border:       `1px solid ${t.isRegistered ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.07)'}`,
              borderRadius: '14px',
              padding:      '20px 24px',
              transition:   'border-color 0.15s',
            }}>
              {/* Top row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div style={{ flex: 1, marginRight: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '17px', fontWeight: 700, color: '#fff' }}>{t.name}</span>
                    {t.isRegistered && (
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: 'rgba(16,185,129,0.15)', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Registered
                      </span>
                    )}
                    {t.requiredTokenSlug && (
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: 'rgba(240,165,0,0.12)', color: '#f0a500', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Token required
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }}>
                      {t.description}
                    </p>
                  )}
                </div>
                <span style={{
                  flexShrink: 0,
                  padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                  background: `${STATUS_COLOR[t.status]}18`,
                  color:      STATUS_COLOR[t.status],
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  {STATUS_LABEL[t.status]}
                </span>
              </div>

              {/* Meta row */}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{
                  fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '5px',
                  background: `${MODE_COLOR[t.mode] ?? '#6366f1'}18`,
                  color:      MODE_COLOR[t.mode] ?? '#6366f1',
                  textTransform: 'capitalize',
                }}>
                  {t.mode}
                </span>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                  {formatFormat(t.stageFormats, t.format)}
                </span>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                  {t.playerCount}{t.maxPlayers ? `/${t.maxPlayers}` : ''} player{t.playerCount !== 1 ? 's' : ''}
                </span>
                {t.status === 'upcoming' && t.startsAt && (
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                    Starts {formatDate(t.startsAt)}
                  </span>
                )}
                {t.status === 'upcoming' && t.registrationEndsAt && (
                  <span style={{ fontSize: '12px', color: '#f0a500' }}>
                    Reg. closes {formatDate(t.registrationEndsAt)}
                  </span>
                )}
                {t.status === 'finished' && t.finishedAt && (
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)' }}>
                    Ended {formatDate(t.finishedAt)}
                  </span>
                )}
              </div>

              {/* Prizes preview */}
              {t.prizes.length > 0 && (
                <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {t.prizes.map((p, i) => (
                    <span key={i} style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: '4px' }}>
                      #{p.rankFrom}{p.rankTo !== p.rankFrom ? `–${p.rankTo}` : ''}: {p.tokenSlug ?? p.description ?? '—'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Link>
        ))
      )}
    </div>
  )
}
