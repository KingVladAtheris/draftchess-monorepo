// apps/web/src/app/admin/login/page.tsx

import { getAdminSession } from '@/app/lib/admin-auth'
import { redirect }        from 'next/navigation'
import LoginClient         from './LoginClient'

export const metadata = { title: 'Admin Login — DraftChess' }

export default async function AdminLoginPage() {
  // If already authenticated, send straight to dashboard
  const session = await getAdminSession()
  if (session) redirect('/admin')

  return <LoginClient />
}
