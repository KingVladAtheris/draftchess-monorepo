'use client'

// apps/web/src/app/admin/_components/LogoutButton.tsx

import { useRouter } from 'next/navigation'
import { useState }  from 'react'

export default function LogoutButton() {
  const [loading, setLoading] = useState(false)
  const router                = useRouter()

  async function handleLogout() {
    setLoading(true)
    await fetch('/admin/api/auth/logout', { method: 'POST' })
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      style={{
        padding:      '8px 18px',
        fontSize:     '13px',
        fontWeight:   600,
        color:        'rgba(255,255,255,0.5)',
        background:   'transparent',
        border:       '1px solid rgba(255,255,255,0.12)',
        borderRadius: '8px',
        cursor:       loading ? 'not-allowed' : 'pointer',
      }}
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
