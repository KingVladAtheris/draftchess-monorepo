'use client'

// apps/web/src/app/admin/tournaments/TournamentsClient.tsx

import { useState }      from 'react'
import { useRouter }     from 'next/navigation'
import Link              from 'next/link'

type TournamentFormat = 'single_elimination' | 'swiss' | 'round_robin' | 'arena'
type GameMode         = 'standard' | 'pauper' | 'royal'
type TournamentStatus = 'upcoming' | 'active' | 'finished' | 'cancelled'

interface Stage {
  format:              TournamentFormat
  name:                string
  advanceCount:        string
  startTimeType:       'fixed' | 'relative'
  fixedStartAt:        string
  relativeBreakMinutes: string
  totalRounds:         string
}

interface Prize {
  rankFrom:    string
  rankTo:      string
  prizeType:   'token' | 'other'
  tokenSlug:   string
  description: string
}

interface Tournament {
  id:                number
  name:              string
  status:            TournamentStatus
  mode:              GameMode
  format:            TournamentFormat
  startsAt:          string | null
  registrationEndsAt: string | null
  _count:            { players: number }
  stages:            { stageNumber: number; format: string; status: string }[]
}

const STATUS_COLOR: Record<TournamentStatus, string> = {
  upcoming:  '#f0a500',
  active:    '#10b981',
  finished:  '#6366f1',
  cancelled: '#6b7280',
}

const BLANK_STAGE: Stage = {
  format: 'swiss', name: '', advanceCount: '', startTimeType: 'relative',
  fixedStartAt: '', relativeBreakMinutes: '15', totalRounds: '',
}

const BLANK_PRIZE: Prize = {
  rankFrom: '1', rankTo: '1', prizeType: 'token', tokenSlug: '', description: '',
}

const S: Record<string, React.CSSProperties> = {
  page:  { maxWidth: '960px', margin: '0 auto', padding: '40px 24px' },
  hdr:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' },
  h1:    { margin: 0, fontSize: '24px', fontWeight: 700, color: '#fff' },
  card:  { background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '20px 24px', marginBottom: '10px' },
  row:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
  meta:  { fontSize: '12px', color: 'rgba(255,255,255,0.35)', margin: '0 0 3px' },
  btn:   { padding: '7px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: 'pointer' },
  input: { width: '100%', padding: '8px 12px', fontSize: '13px', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', outline: 'none', boxSizing: 'border-box' as const },
  label: { fontSize: '11px', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
}

export default function TournamentsClient({
  tournaments: initial,
  tokenDefs,
}: {
  tournaments: Tournament[]
  tokenDefs:   { slug: string; label: string }[]
}) {
  const [tournaments, setTournaments] = useState(initial)
  const [creating, setCreating]       = useState(false)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const router                        = useRouter()

  const [form, setForm] = useState({
    name: '', description: '', mode: 'standard' as GameMode,
    format: 'single_elimination' as TournamentFormat,
    registrationEndsAt: '', startsAt: '',
    maxPlayers: '', minPlayers: '2', requiredTokenSlug: '',
  })
  const [stages, setStages] = useState<Stage[]>([{ ...BLANK_STAGE }])
  const [prizes, setPrizes] = useState<Prize[]>([])

  function setF(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function updateStage(i: number, k: keyof Stage, v: string) {
    setStages(ss => ss.map((s, idx) => idx === i ? { ...s, [k]: v } : s))
  }
  function updatePrize(i: number, k: keyof Prize, v: string) {
    setPrizes(ps => ps.map((p, idx) => idx === i ? { ...p, [k]: v } : p))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) { setError('Name is required'); return }
    setLoading(true)

    const body = {
      ...form,
      maxPlayers: form.maxPlayers ? parseInt(form.maxPlayers) : null,
      minPlayers: parseInt(form.minPlayers) || 2,
      requiredTokenSlug: form.requiredTokenSlug || null,
      registrationEndsAt: form.registrationEndsAt || null,
      startsAt:           form.startsAt           || null,
      stages: stages.map(s => ({
        format:              s.format,
        name:                s.name || null,
        advanceCount:        s.advanceCount ? parseInt(s.advanceCount) : null,
        startTimeType:       s.startTimeType,
        fixedStartAt:        s.fixedStartAt || null,
        relativeBreakMinutes: s.relativeBreakMinutes ? parseInt(s.relativeBreakMinutes) : null,
        totalRounds:         s.totalRounds ? parseInt(s.totalRounds) : null,
      })),
      prizes: prizes.map(p => ({
        rankFrom:    parseInt(p.rankFrom),
        rankTo:      parseInt(p.rankTo),
        prizeType:   p.prizeType,
        tokenSlug:   p.prizeType === 'token' ? p.tokenSlug : null,
        description: p.description || null,
      })),
    }

    const res  = await fetch('/admin/api/tournaments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) { setError(data.error); return }

    setTournaments(prev => [{ ...data.tournament, _count: { players: 0 } }, ...prev])
    setCreating(false)
  }

  return (
    <div style={S.page}>
      <div style={S.hdr}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <Link href="/admin" style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>← Dashboard</Link>
          <h1 style={S.h1}>Tournaments</h1>
        </div>
        <button style={{ ...S.btn, background: '#f0a500', color: '#0f1117' }} onClick={() => setCreating(v => !v)}>
          {creating ? 'Cancel' : '+ New tournament'}
        </button>
      </div>

      {/* ── Create form ── */}
      {creating && (
        <div style={{ ...S.card, marginBottom: '28px' }}>
          <p style={{ margin: '0 0 20px', fontWeight: 700, color: '#fff', fontSize: '16px' }}>New tournament</p>
          <form onSubmit={handleCreate}>
            {/* Basic fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              {[
                { k: 'name',               label: 'Name *',               ph: 'Spring Championship' },
                { k: 'description',        label: 'Description',          ph: 'Optional' },
                { k: 'registrationEndsAt', label: 'Registration closes',  ph: 'YYYY-MM-DDTHH:MM', type: 'datetime-local' },
                { k: 'startsAt',           label: 'Starts at',            ph: 'YYYY-MM-DDTHH:MM', type: 'datetime-local' },
                { k: 'maxPlayers',         label: 'Max players',          ph: 'blank = unlimited' },
                { k: 'minPlayers',         label: 'Min players',          ph: '2' },
              ].map(({ k, label, ph, type }) => (
                <div key={k}>
                  <label style={S.label}>{label}</label>
                  <input style={S.input} type={type ?? 'text'} value={(form as any)[k]} placeholder={ph} onChange={e => setF(k, e.target.value)} />
                </div>
              ))}

              <div>
                <label style={S.label}>Mode</label>
                <select style={{ ...S.input }} value={form.mode} onChange={e => setF('mode', e.target.value)}>
                  {['standard', 'pauper', 'royal'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <label style={S.label}>Required token (entry gate)</label>
                <select style={{ ...S.input }} value={form.requiredTokenSlug} onChange={e => setF('requiredTokenSlug', e.target.value)}>
                  <option value="">None</option>
                  {tokenDefs.map(t => <option key={t.slug} value={t.slug}>{t.label} ({t.slug})</option>)}
                </select>
              </div>
            </div>

            {/* Stages */}
            <p style={{ margin: '20px 0 10px', fontWeight: 700, color: '#fff', fontSize: '14px' }}>
              Stages ({stages.length})
              <button type="button" onClick={() => setStages(ss => [...ss, { ...BLANK_STAGE }])} style={{ ...S.btn, marginLeft: '10px', background: 'rgba(255,255,255,0.07)', color: '#e8eaf0', padding: '4px 10px' }}>+ Add stage</button>
            </p>

            {stages.map((stage, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '14px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>Stage {i + 1}</span>
                  {stages.length > 1 && (
                    <button type="button" onClick={() => setStages(ss => ss.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '12px' }}>Remove</button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={S.label}>Format</label>
                    <select style={{ ...S.input }} value={stage.format} onChange={e => updateStage(i, 'format', e.target.value)}>
                      {['swiss', 'single_elimination', 'round_robin'].map(f => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={S.label}>Name</label>
                    <input style={S.input} value={stage.name} placeholder="Optional" onChange={e => updateStage(i, 'name', e.target.value)} />
                  </div>
                  <div>
                    <label style={S.label}>Advance count</label>
                    <input style={S.input} value={stage.advanceCount} placeholder="blank = all (final stage)" onChange={e => updateStage(i, 'advanceCount', e.target.value)} />
                  </div>
                  {stage.format === 'swiss' && (
                    <div>
                      <label style={S.label}>Total rounds</label>
                      <input style={S.input} value={stage.totalRounds} placeholder="blank = auto" onChange={e => updateStage(i, 'totalRounds', e.target.value)} />
                    </div>
                  )}
                  <div>
                    <label style={S.label}>Start time</label>
                    <select style={{ ...S.input }} value={stage.startTimeType} onChange={e => updateStage(i, 'startTimeType', e.target.value as any)}>
                      <option value="relative">Relative (break after prev)</option>
                      <option value="fixed">Fixed date/time</option>
                    </select>
                  </div>
                  {stage.startTimeType === 'fixed' ? (
                    <div>
                      <label style={S.label}>Fixed start at</label>
                      <input style={S.input} type="datetime-local" value={stage.fixedStartAt} onChange={e => updateStage(i, 'fixedStartAt', e.target.value)} />
                    </div>
                  ) : (
                    <div>
                      <label style={S.label}>Break (minutes)</label>
                      <input style={S.input} value={stage.relativeBreakMinutes} placeholder="15" onChange={e => updateStage(i, 'relativeBreakMinutes', e.target.value)} />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Prizes */}
            <p style={{ margin: '20px 0 10px', fontWeight: 700, color: '#fff', fontSize: '14px' }}>
              Prizes
              <button type="button" onClick={() => setPrizes(ps => [...ps, { ...BLANK_PRIZE }])} style={{ ...S.btn, marginLeft: '10px', background: 'rgba(255,255,255,0.07)', color: '#e8eaf0', padding: '4px 10px' }}>+ Add prize</button>
            </p>
            {prizes.map((prize, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '8px', alignItems: 'end', marginBottom: '8px' }}>
                <div><label style={S.label}>Rank from</label><input style={S.input} value={prize.rankFrom} onChange={e => updatePrize(i, 'rankFrom', e.target.value)} /></div>
                <div><label style={S.label}>Rank to</label><input style={S.input} value={prize.rankTo} onChange={e => updatePrize(i, 'rankTo', e.target.value)} /></div>
                <div>
                  <label style={S.label}>Type</label>
                  <select style={{ ...S.input }} value={prize.prizeType} onChange={e => updatePrize(i, 'prizeType', e.target.value)}>
                    <option value="token">Token</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                {prize.prizeType === 'token' ? (
                  <div>
                    <label style={S.label}>Token</label>
                    <select style={{ ...S.input }} value={prize.tokenSlug} onChange={e => updatePrize(i, 'tokenSlug', e.target.value)}>
                      <option value="">Select…</option>
                      {tokenDefs.map(t => <option key={t.slug} value={t.slug}>{t.label}</option>)}
                    </select>
                  </div>
                ) : (
                  <div><label style={S.label}>Description</label><input style={S.input} value={prize.description} onChange={e => updatePrize(i, 'description', e.target.value)} /></div>
                )}
                <button type="button" onClick={() => setPrizes(ps => ps.filter((_, idx) => idx !== i))} style={{ ...S.btn, background: 'none', color: '#f87171', padding: '8px' }}>✕</button>
              </div>
            ))}

            {error && <p style={{ color: '#f87171', fontSize: '13px', margin: '12px 0 0' }}>{error}</p>}

            <button type="submit" disabled={loading} style={{ ...S.btn, marginTop: '20px', background: '#f0a500', color: '#0f1117', padding: '10px 24px', fontSize: '13px' }}>
              {loading ? 'Creating…' : 'Create tournament'}
            </button>
          </form>
        </div>
      )}

      {/* ── Tournament list ── */}
      {tournaments.map(t => (
        <Link key={t.id} href={`/admin/tournaments/${t.id}`} style={{ textDecoration: 'none' }}>
          <div style={S.card}>
            <div style={S.row}>
              <div>
                <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#fff', fontSize: '16px' }}>{t.name}</p>
                <p style={S.meta}>
                  {t.mode} · {t.stages.length} stage{t.stages.length !== 1 ? 's' : ''} · {t._count.players} player{t._count.players !== 1 ? 's' : ''}
                  {t.startsAt ? ` · starts ${new Date(t.startsAt).toLocaleDateString()}` : ''}
                </p>
              </div>
              <span style={{
                padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                background: `${STATUS_COLOR[t.status]}22`,
                color:      STATUS_COLOR[t.status],
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {t.status}
              </span>
            </div>
          </div>
        </Link>
      ))}

      {tournaments.length === 0 && !creating && (
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '14px', textAlign: 'center', marginTop: '40px' }}>
          No tournaments yet. Create one above.
        </p>
      )}
    </div>
  )
}
