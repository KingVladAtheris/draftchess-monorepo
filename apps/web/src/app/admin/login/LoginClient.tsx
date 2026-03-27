'use client'

// apps/web/src/app/admin/login/LoginClient.tsx

import { useState, FormEvent } from 'react'
import { useRouter }           from 'next/navigation'

export default function LoginClient() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const router                  = useRouter()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Both fields are required')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/admin/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: username.trim(), password }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        return
      }

      router.push('/admin')
      router.refresh()
    } catch {
      setError('Connection error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight:      '100vh',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     '#0f1117',
      padding:        '16px',
    }}>
      <div style={{
        width:        '100%',
        maxWidth:     '360px',
        background:   '#1a1d2e',
        border:       '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
        padding:      '40px 36px',
      }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <p style={{
            fontSize:      '11px',
            fontWeight:    700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color:         'rgba(255,255,255,0.3)',
            margin:        '0 0 8px',
          }}>
            DraftChess
          </p>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#fff', margin: 0 }}>
            Admin panel
          </h1>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{
              display:       'block',
              fontSize:      '11px',
              fontWeight:    600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color:         'rgba(255,255,255,0.4)',
              marginBottom:  '6px',
            }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={loading}
              style={{
                width:        '100%',
                padding:      '10px 14px',
                fontSize:     '14px',
                color:        '#fff',
                background:   'rgba(255,255,255,0.05)',
                border:       '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                outline:      'none',
                boxSizing:    'border-box',
              }}
            />
          </div>

          <div>
            <label style={{
              display:       'block',
              fontSize:      '11px',
              fontWeight:    600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color:         'rgba(255,255,255,0.4)',
              marginBottom:  '6px',
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
              style={{
                width:        '100%',
                padding:      '10px 14px',
                fontSize:     '14px',
                color:        '#fff',
                background:   'rgba(255,255,255,0.05)',
                border:       '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                outline:      'none',
                boxSizing:    'border-box',
              }}
            />
          </div>

          {error && (
            <p style={{
              margin:     0,
              padding:    '10px 14px',
              fontSize:   '13px',
              color:      '#f87171',
              background: 'rgba(239,68,68,0.1)',
              border:     '1px solid rgba(239,68,68,0.2)',
              borderRadius: '8px',
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop:    '4px',
              padding:      '12px',
              fontSize:     '14px',
              fontWeight:   700,
              color:        '#0f1117',
              background:   loading ? 'rgba(240,165,0,0.5)' : '#f0a500',
              border:       'none',
              borderRadius: '8px',
              cursor:       loading ? 'not-allowed' : 'pointer',
              transition:   'background 0.15s',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
