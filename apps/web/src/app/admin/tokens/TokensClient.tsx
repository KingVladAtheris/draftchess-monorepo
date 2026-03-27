'use client'

// apps/web/src/app/admin/tokens/TokensClient.tsx

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

interface TokenDef {
  id:              number
  slug:            string
  label:           string
  description:     string | null
  icon:            string | null
  color:           string | null
  adminOnly:       boolean
  grantsPrivilege: boolean
  isPurchasable:   boolean
  consumeOnEntry:  boolean
  durationDays:    number | null
  _count:          { holders: number }
}

interface User { id: number; username: string; email: string }

const S: Record<string, React.CSSProperties> = {
  page:    { maxWidth: '960px', margin: '0 auto', padding: '40px 24px' },
  hdr:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' },
  h1:      { margin: 0, fontSize: '24px', fontWeight: 700, color: '#fff' },
  back:    { fontSize: '13px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none' },
  card:    { background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '24px', marginBottom: '12px' },
  row:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' },
  slug:    { fontSize: '13px', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' },
  label:   { fontSize: '17px', fontWeight: 700, color: '#fff', margin: '0 0 4px' },
  meta:    { fontSize: '12px', color: 'rgba(255,255,255,0.3)', margin: '0 0 2px' },
  btn:     { padding: '7px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: 'pointer' },
  input:   { width: '100%', padding: '9px 12px', fontSize: '13px', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', outline: 'none', boxSizing: 'border-box' as const },
  section: { marginTop: '40px' },
  sectionH: { fontSize: '13px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.35)', marginBottom: '16px' },
}

export default function TokensClient({ tokens: initial }: { tokens: TokenDef[] }) {
  const [tokens, setTokens]         = useState(initial)
  const [creating, setCreating]     = useState(false)
  const [form, setForm]             = useState({
    slug: '', label: '', description: '', icon: '', color: '',
    grantsPrivilege: false, consumeOnEntry: false, durationDays: '',
  })
  const [formErr, setFormErr]       = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)

  // Grant / revoke panel
  const [grantSlug, setGrantSlug]   = useState<string | null>(null)
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<User[]>([])
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [grantNote, setGrantNote]   = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMsg, setActionMsg]   = useState<string | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // User search with debounce
  useEffect(() => {
    clearTimeout(searchTimeout.current)
    if (userSearch.length < 2) { setUserResults([]); return }
    searchTimeout.current = setTimeout(async () => {
      const res = await fetch(`/admin/api/users/search?q=${encodeURIComponent(userSearch)}`)
      const data = await res.json()
      setUserResults(data.users ?? [])
    }, 300)
  }, [userSearch])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormErr(null)
    if (!form.slug.trim() || !form.label.trim()) { setFormErr('slug and label required'); return }
    setFormLoading(true)
    const res = await fetch('/admin/api/tokens', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ...form,
        durationDays: form.durationDays ? parseInt(form.durationDays) : null,
      }),
    })
    const data = await res.json()
    setFormLoading(false)
    if (!res.ok) { setFormErr(data.error); return }
    setTokens(prev => [{ ...data.token, _count: { holders: 0 } }, ...prev])
    setCreating(false)
    setForm({ slug: '', label: '', description: '', icon: '', color: '', grantsPrivilege: false, consumeOnEntry: false, durationDays: '' })
  }

  async function handleGrant() {
    if (!selectedUser || !grantSlug) return
    setActionLoading(true)
    const res = await fetch('/admin/api/tokens/grant', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId: selectedUser.id, tokenSlug: grantSlug, note: grantNote || undefined }),
    })
    const data = await res.json()
    setActionLoading(false)
    setActionMsg(res.ok ? `Granted to ${selectedUser.username}` : data.error)
    if (res.ok) {
      setTokens(prev => prev.map(t => t.slug === grantSlug ? { ...t, _count: { holders: t._count.holders + 1 } } : t))
      setSelectedUser(null); setUserSearch(''); setGrantNote('')
    }
  }

  async function handleRevoke() {
    if (!selectedUser || !grantSlug) return
    setActionLoading(true)
    const res = await fetch('/admin/api/tokens/revoke', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId: selectedUser.id, tokenSlug: grantSlug }),
    })
    const data = await res.json()
    setActionLoading(false)
    setActionMsg(res.ok ? `Revoked from ${selectedUser.username}` : data.error)
    if (res.ok) {
      setTokens(prev => prev.map(t => t.slug === grantSlug ? { ...t, _count: { holders: Math.max(0, t._count.holders - 1) } } : t))
      setSelectedUser(null); setUserSearch('')
    }
  }

  const grantToken = grantSlug ? tokens.find(t => t.slug === grantSlug) : null

  return (
    <div style={S.page}>
      <div style={S.hdr}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <Link href="/admin" style={S.back}>← Dashboard</Link>
          <h1 style={S.h1}>Tokens</h1>
        </div>
        <button style={{ ...S.btn, background: '#f0a500', color: '#0f1117' }} onClick={() => setCreating(v => !v)}>
          {creating ? 'Cancel' : '+ New token'}
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div style={{ ...S.card, marginBottom: '28px' }}>
          <p style={{ margin: '0 0 16px', fontWeight: 700, color: '#fff' }}>New token definition</p>
          <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {[
              { key: 'slug',        label: 'Slug',        placeholder: 'my-token' },
              { key: 'label',       label: 'Label',       placeholder: 'My Token' },
              { key: 'description', label: 'Description', placeholder: 'Optional' },
              { key: 'icon',        label: 'Icon',        placeholder: '👑' },
              { key: 'color',       label: 'Color',       placeholder: '#f59e0b' },
              { key: 'durationDays', label: 'Duration (days)', placeholder: 'blank = permanent' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label style={{ ...S.meta, display: 'block', marginBottom: '4px' }}>{label}</label>
                <input
                  style={S.input}
                  value={(form as any)[key]}
                  placeholder={placeholder}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div style={{ gridColumn: '1/-1', display: 'flex', gap: '20px' }}>
              {[
                { key: 'grantsPrivilege', label: 'Grants privilege' },
                { key: 'consumeOnEntry',  label: 'Consume on tournament entry' },
              ].map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
            {formErr && <p style={{ gridColumn: '1/-1', color: '#f87171', fontSize: '13px', margin: 0 }}>{formErr}</p>}
            <div style={{ gridColumn: '1/-1' }}>
              <button type="submit" disabled={formLoading} style={{ ...S.btn, background: '#f0a500', color: '#0f1117' }}>
                {formLoading ? 'Creating…' : 'Create token'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Token list */}
      {tokens.map(token => (
        <div key={token.slug} style={S.card}>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <p style={S.slug}>{token.slug}</p>
              <p style={S.label}>{token.icon && `${token.icon} `}{token.label}</p>
              {token.description && <p style={S.meta}>{token.description}</p>}
              <p style={{ ...S.meta, marginTop: '6px' }}>
                {token._count.holders} holder{token._count.holders !== 1 ? 's' : ''}
                {token.durationDays ? ` · ${token.durationDays}d duration` : ' · permanent'}
                {token.consumeOnEntry  ? ' · consumed on entry' : ''}
                {token.grantsPrivilege ? ' · grants privilege'  : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button
                style={{ ...S.btn, background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
                onClick={() => { setGrantSlug(token.slug); setActionMsg(null) }}
              >
                Grant / Revoke
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Grant / revoke panel */}
      {grantSlug && grantToken && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ ...S.card, width: '420px', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <p style={{ margin: 0, fontWeight: 700, color: '#fff' }}>
                {grantToken.icon} {grantToken.label}
              </p>
              <button onClick={() => { setGrantSlug(null); setSelectedUser(null); setUserSearch(''); setActionMsg(null) }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>

            <label style={{ ...S.meta, display: 'block', marginBottom: '4px' }}>Search player</label>
            <input
              style={{ ...S.input, marginBottom: '8px' }}
              value={userSearch}
              placeholder="Type username…"
              onChange={e => { setUserSearch(e.target.value); setSelectedUser(null) }}
            />

            {userResults.length > 0 && !selectedUser && (
              <div style={{ background: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', marginBottom: '8px', overflow: 'hidden' }}>
                {userResults.map(u => (
                  <div
                    key={u.id}
                    onClick={() => { setSelectedUser(u); setUserSearch(u.username); setUserResults([]) }}
                    style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '13px', color: '#e8eaf0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    {u.username} <span style={{ color: 'rgba(255,255,255,0.3)' }}>{u.email}</span>
                  </div>
                ))}
              </div>
            )}

            {selectedUser && (
              <>
                <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#10b981' }}>Selected: {selectedUser.username}</p>
                <label style={{ ...S.meta, display: 'block', marginBottom: '4px' }}>Note (optional)</label>
                <input style={{ ...S.input, marginBottom: '12px' }} value={grantNote} placeholder="Reason…" onChange={e => setGrantNote(e.target.value)} />
              </>
            )}

            {actionMsg && <p style={{ margin: '0 0 10px', fontSize: '13px', color: actionMsg.startsWith('Granted') || actionMsg.startsWith('Revoked') ? '#10b981' : '#f87171' }}>{actionMsg}</p>}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleGrant}
                disabled={!selectedUser || actionLoading}
                style={{ ...S.btn, background: selectedUser ? '#10b981' : 'rgba(16,185,129,0.2)', color: selectedUser ? '#fff' : 'rgba(255,255,255,0.3)', flex: 1 }}
              >
                {actionLoading ? '…' : 'Grant'}
              </button>
              <button
                onClick={handleRevoke}
                disabled={!selectedUser || actionLoading}
                style={{ ...S.btn, background: selectedUser ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.05)', color: selectedUser ? '#f87171' : 'rgba(255,255,255,0.2)', flex: 1 }}
              >
                {actionLoading ? '…' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
