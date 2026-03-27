// apps/web/src/app/admin/page.tsx

import { getAdminSession } from '@/app/lib/admin-auth'
import { redirect }        from 'next/navigation'
import { prisma }          from '@draftchess/db'
import Link                from 'next/link'
import LogoutButton        from './_components/LogoutButton'

export const metadata = { title: 'Admin Dashboard — DraftChess' }

export default async function AdminDashboardPage() {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const [tokenCount, tournamentCount, activePlayerCount] = await Promise.all([
    prisma.tokenDefinition.count(),
    prisma.tournament.count(),
    prisma.tournamentPlayer.count({ where: { tournament: { status: 'active' } } }),
  ])

  const cards = [
    {
      href:    '/admin/tokens',
      label:   'Token definitions',
      value:   tokenCount,
      sublabel: 'defined token types',
      color:   '#f0a500',
    },
    {
      href:    '/admin/tournaments',
      label:   'Tournaments',
      value:   tournamentCount,
      sublabel: 'total tournaments',
      color:   '#6366f1',
    },
    {
      href:    '/admin/tournaments',
      label:   'Active players',
      value:   activePlayerCount,
      sublabel: 'in live tournaments',
      color:   '#10b981',
    },
  ]

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '40px' }}>
        <div>
          <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            DraftChess admin
          </p>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 700, color: '#fff' }}>
            Welcome, {session.username}
          </h1>
        </div>
        <LogoutButton />
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '40px' }}>
        {cards.map(card => (
          <Link
            key={card.href + card.label}
            href={card.href}
            style={{
              display:        'block',
              padding:        '24px',
              background:     '#1a1d2e',
              border:         '1px solid rgba(255,255,255,0.07)',
              borderRadius:   '12px',
              textDecoration: 'none',
              transition:     'border-color 0.15s',
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              {card.label}
            </p>
            <p style={{ margin: '0 0 4px', fontSize: '36px', fontWeight: 800, color: card.color, lineHeight: 1 }}>
              {card.value}
            </p>
            <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>
              {card.sublabel}
            </p>
          </Link>
        ))}
      </div>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: '12px' }}>
        {[
          { href: '/admin/tokens',      label: '→ Manage tokens' },
          { href: '/admin/tournaments', label: '→ Manage tournaments' },
        ].map(link => (
          <Link
            key={link.href}
            href={link.href}
            style={{
              padding:        '10px 20px',
              background:     'rgba(255,255,255,0.05)',
              border:         '1px solid rgba(255,255,255,0.1)',
              borderRadius:   '8px',
              color:          '#e8eaf0',
              fontSize:       '14px',
              fontWeight:     600,
              textDecoration: 'none',
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
