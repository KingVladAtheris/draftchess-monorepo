// apps/web/src/app/admin/tokens/page.tsx

import { getAdminSession } from '@/app/lib/admin-auth'
import { redirect }        from 'next/navigation'
import { prisma }          from '@draftchess/db'
import TokensClient        from './TokensClient'

export const metadata = { title: 'Tokens — Admin' }

export default async function AdminTokensPage() {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const tokens = await prisma.tokenDefinition.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { holders: true } } },
  })

  return <TokensClient tokens={tokens} />
}
