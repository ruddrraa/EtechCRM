import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { BarChart3, BriefcaseBusiness, CalendarDays, ChevronLeft, ClipboardList, FileClock, LayoutDashboard, Settings, Users, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Role } from '../../types'
import { BrandLogo } from '../ui/BrandLogo'

const items = [
  ['Dashboard', '/', LayoutDashboard],
  ['Clients', '/clients', BriefcaseBusiness],
  ['Visits', '/visits', CalendarDays],
  ['Staff', '/staff', Users],
  ['Reports', '/reports', BarChart3],
  ['Audit Logs', '/audit-logs', FileClock],
  ['Settings', '/settings', Settings],
] as const

export function Sidebar({ mobileOpen, onClose, role }: { mobileOpen: boolean; onClose: () => void; role: Role }) {
  const [collapsed, setCollapsed] = useState(false)
  const visibleItems = items.filter(([, path]) => role === 'MARKETING_EXECUTIVE' ? ['/','/clients','/visits','/settings'].includes(path) : true)
  return <aside className={cn('sidebar', collapsed && 'sidebar-collapsed', mobileOpen && 'sidebar-open')}>
    <div className="brand"><span className="brand-expanded"><BrandLogo size="sidebar" /></span><span className="brand-collapsed"><BrandLogo size="collapsed" /></span><button className="mobile-close" onClick={onClose} aria-label="Close navigation"><X size={18} /></button></div>
    <nav>{visibleItems.map(([label, path, Icon]) => <NavLink key={path} to={path} end={path === '/'} onClick={onClose} className={({ isActive }) => cn('nav-item', isActive && 'nav-item-active')}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
    <div className="sidebar-bottom"><button className="collapse-button" onClick={() => setCollapsed(!collapsed)}><ChevronLeft size={17} className={collapsed ? 'rotate-180' : ''} /><span>{collapsed ? 'Expand' : 'Collapse'} menu</span></button><div className="sidebar-help"><ClipboardList size={17} /><span><strong>Need help?</strong><small>View product guide</small></span></div></div>
  </aside>
}
