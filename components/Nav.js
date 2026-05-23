'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
  }

  const links = [
    { href: '/dashboard', label: 'HOME' },
    { href: '/expenses', label: 'EXPENSES' },
    { href: '/analytics', label: 'ANALYTICS' },
  ]

  return (
    <nav style={s.nav}>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          style={{
            ...s.link,
            ...(pathname === href ? s.active : {}),
          }}
        >
          {label}
        </Link>
      ))}
      <button onClick={handleLogout} style={s.logout}>
        EXIT
      </button>
    </nav>
  )
}

const s = {
  nav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: 'var(--nav-h)',
    background: '#fff',
    borderTop: '1px solid #000',
    display: 'flex',
    alignItems: 'stretch',
    zIndex: 100,
    maxWidth: '480px',
    margin: '0 auto',
  },
  link: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 500,
    letterSpacing: '0.08em',
    color: 'var(--muted)',
    borderRight: '1px solid var(--border-light)',
    transition: 'background 0.1s',
  },
  active: {
    color: '#000',
    background: 'var(--subtle)',
    fontWeight: 600,
  },
  logout: {
    width: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 500,
    letterSpacing: '0.08em',
    color: 'var(--muted)',
    background: 'transparent',
    border: 'none',
  },
}
