'use client'

// apps/web/src/app/tournaments/[id]/[roundId]/pick/DraftPickClient.tsx
//
// 1-minute countdown. Player picks a draft from their collection.
// When both players have picked (or 1 minute expires), the backend creates
// the game and fires tournament-game-ready → we redirect to /play/game/[id].

import { useState, useEffect, useRef } from 'react'
import { useRouter }                    from 'next/navigation'
import { getSocket }                    from '@/app/lib/socket'

interface Draft {
  id:        number
  name:      string | null
  points:    number
  updatedAt: string
}

const PICK_WINDOW_SECS = 60

const MODE_LABEL: Record<string, string> = {
  standard: 'Standard',
  pauper:   'Pauper',
  royal:    'Royal',
}

export default function DraftPickClient({
  tournamentId,
  tournamentName,
  mode,
  roundId,
  roundNumber,
  deadline,
  drafts,
  alreadyPicked,
  pickedDraftId,
}: {
  tournamentId:   number
  tournamentName: string
  mode:           string
  roundId:        number
  roundNumber:    number
  deadline:       string | null
  drafts:         Draft[]
  alreadyPicked:  boolean
  pickedDraftId:  number | null
}) {
  const router = useRouter()

  // Countdown from deadline or PICK_WINDOW_SECS
  const [secs, setSecs] = useState(() => {
    if (!deadline) return PICK_WINDOW_SECS
    return Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000))
  })

  const [selected, setSelected]   = useState<number | null>(pickedDraftId)
  const [picked, setPicked]       = useState(alreadyPicked)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [waiting, setWaiting]     = useState(alreadyPicked) // waiting for opponent
  const mounted                   = useRef(true)

  // ── Countdown ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (secs <= 0) return
    const interval = setInterval(() => {
      setSecs(s => {
        if (s <= 1) { clearInterval(interval); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [secs > 0])

  // ── Socket: wait for tournament-game-ready ────────────────────────────────
  useEffect(() => {
    mounted.current = true

    getSocket().then(socket => {
      if (!mounted.current) return

      socket.on('tournament-game-ready', (data: { gameId: number; tournamentId: number }) => {
        if (!mounted.current) return
        if (data.tournamentId === tournamentId) {
          router.push(`/play/game/${data.gameId}`)
        }
      })
    }).catch(() => {})

    return () => {
      mounted.current = false
      getSocket().then(s => s.off('tournament-game-ready')).catch(() => {})
    }
  }, [tournamentId, router])

  async function handlePick(draftId: number) {
    if (picked || submitting) return
    setSelected(draftId)
    setSubmitting(true)
    setError(null)

    const res  = await fetch(`/api/tournaments/rounds/${roundId}/pick`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ draftId }),
    })
    const data = await res.json()

    if (!mounted.current) return
    setSubmitting(false)

    if (!res.ok) {
      setError(data.error ?? 'Failed to submit pick')
      setSelected(null)
      return
    }

    setPicked(true)
    setWaiting(!data.bothPicked) // if both picked, game is creating — socket will redirect
    if (data.bothPicked) {
      // Game is being created — socket event will redirect us
      // Show brief "Game starting…" state
    }
  }

  const m = Math.floor(secs / 60)
  const s = secs % 60
  const urgent = secs > 0 && secs <= 15

  return (
    <div style={{
      minHeight:      '100vh',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     '#0f1117',
      padding:        '24px',
    }}>
      <div style={{ width: '100%', maxWidth: '560px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {tournamentName} · Round {roundNumber}
          </p>
          <h1 style={{ margin: '0 0 16px', fontSize: '24px', fontWeight: 800, color: '#fff' }}>
            {picked ? (waiting ? 'Waiting for opponent…' : 'Game starting…') : 'Pick your draft'}
          </h1>

          {/* Countdown ring */}
          <div style={{
            display:        'inline-flex',
            alignItems:     'center',
            justifyContent: 'center',
            width:          '72px',
            height:         '72px',
            borderRadius:   '50%',
            border:         `3px solid ${secs === 0 ? 'rgba(255,255,255,0.1)' : urgent ? '#f87171' : '#f0a500'}`,
            marginBottom:   '8px',
            transition:     'border-color 0.5s',
          }}>
            <span style={{ fontSize: '22px', fontWeight: 800, color: secs === 0 ? 'rgba(255,255,255,0.3)' : urgent ? '#f87171' : '#f0a500', fontFamily: 'monospace' }}>
              {secs === 0 ? '—' : `${m}:${String(s).padStart(2, '0')}`}
            </span>
          </div>

          {secs === 0 && !picked && (
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
              Time's up — auto-assigning your most recent draft
            </p>
          )}
          {picked && waiting && (
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
              Pick submitted. Waiting for your opponent to pick…
            </p>
          )}
        </div>

        {/* Mode badge */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 12px', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {MODE_LABEL[mode] ?? mode} mode
          </span>
        </div>

        {error && (
          <div style={{ marginBottom: '16px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', fontSize: '13px', color: '#f87171', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* Draft list */}
        {drafts.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', background: '#1a1d2e', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.4)', fontSize: '14px' }}>
              You have no {mode} drafts.
            </p>
            <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.25)', fontSize: '13px' }}>
              Your most recently updated draft will be auto-assigned, or you will forfeit if none exists.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {drafts.map(draft => {
              const isSelected = selected === draft.id
              const isPicked   = picked && selected === draft.id
              return (
                <button
                  key={draft.id}
                  onClick={() => !picked && !submitting && handlePick(draft.id)}
                  disabled={picked || submitting || secs === 0}
                  style={{
                    width:        '100%',
                    padding:      '14px 18px',
                    display:      'flex',
                    alignItems:   'center',
                    justifyContent: 'space-between',
                    background:   isPicked
                      ? 'rgba(16,185,129,0.12)'
                      : isSelected && submitting
                        ? 'rgba(240,165,0,0.08)'
                        : '#1a1d2e',
                    border:       `1px solid ${isPicked ? 'rgba(16,185,129,0.35)' : isSelected ? 'rgba(240,165,0,0.3)' : 'rgba(255,255,255,0.07)'}`,
                    borderRadius: '10px',
                    cursor:       picked || submitting || secs === 0 ? 'not-allowed' : 'pointer',
                    textAlign:    'left',
                    transition:   'border-color 0.15s, background 0.15s',
                    opacity:      picked && !isSelected ? 0.4 : 1,
                  }}
                >
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: '15px', fontWeight: 600, color: isPicked ? '#10b981' : '#fff' }}>
                      {draft.name ?? `Draft #${draft.id}`}
                    </p>
                    <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                      {draft.points} pts · updated {new Date(draft.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={{ flexShrink: 0, marginLeft: '12px' }}>
                    {isPicked ? (
                      <span style={{ fontSize: '18px', color: '#10b981' }}>✓</span>
                    ) : isSelected && submitting ? (
                      <span style={{ fontSize: '13px', color: '#f0a500' }}>…</span>
                    ) : (
                      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.2)', padding: '4px 10px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px' }}>
                        Pick
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Info footer */}
        {!picked && (
          <p style={{ marginTop: '16px', textAlign: 'center', fontSize: '12px', color: 'rgba(255,255,255,0.25)', lineHeight: 1.5 }}>
            If time runs out, your most recently updated {mode} draft is used automatically.
          </p>
        )}
      </div>
    </div>
  )
}
