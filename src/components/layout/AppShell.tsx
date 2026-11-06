import { useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthUser } from '../../types'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useAuth } from '../../features/auth/AuthContext'

export function AppShell({ children, user, onLogout }: { children: ReactNode; user: AuthUser; onLogout: () => Promise<void> }) {
  const { user: currentUser } = useAuth()
  const activeUser = currentUser ?? user
  const [mobileOpen, setMobileOpen] = useState(false)
  return <div className="app-shell"><Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} role={activeUser.role} /><div className="app-main"><Topbar onMenu={() => setMobileOpen(true)} user={activeUser} onLogout={onLogout} /><main>{children}</main></div>{mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}</div>
}
