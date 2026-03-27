// apps/web/src/app/admin/layout.tsx
// Separate layout — deliberately excludes the player app's Nav, SessionProvider,
// and ToastProvider. Admin pages manage their own context.

import type { ReactNode } from 'react'

export const metadata = { title: 'Admin — DraftChess' }

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight:  '100vh',
        background: '#0f1117',
        color:      '#e8eaf0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {children}
    </div>
  )
}
