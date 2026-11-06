import { Bell, ChevronDown, Menu, Search } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { titleFromPath } from '../../lib/utils'
import type { Role } from '../../types'

export function Topbar({ onMenu, role, onRoleChange }: { onMenu: () => void; role: Role; onRoleChange: (role: Role) => void }) {
  const location = useLocation()
  const identity = { SUPER_ADMIN: { name: 'Ranjit Singh', initials: 'RS' }, ADMIN: { name: 'Priya Shah', initials: 'PS' }, USER: { name: 'Aarav Mehta', initials: 'AM' } }[role]
  return <header className="topbar"><button className="menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{titleFromPath(location.pathname)}</strong></div><div className="topbar-actions"><label className="search"><Search size={16} /><input placeholder="Search anything" aria-label="Global search" /></label><button className="icon-button" aria-label="Notifications"><Bell size={18} /><i /></button><div className="role-preview"><select value={role} onChange={(event) => onRoleChange(event.target.value as Role)} aria-label="Development role preview"><option value="SUPER_ADMIN">Super Admin</option><option value="ADMIN">Admin</option><option value="USER">Marketing Executive</option></select><ChevronDown size={14} /></div><div className="avatar" title={identity.name}>{identity.initials}</div></div></header>
}
