import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Role } from '../../types'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell({ children, role, onRoleChange }: { children: ReactNode; role: Role; onRoleChange: (role: Role) => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return <div className="app-shell"><Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} /><div className="app-main"><Topbar onMenu={() => setMobileOpen(true)} role={role} onRoleChange={onRoleChange} /><main>{children}</main></div>{mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}</div>
}
