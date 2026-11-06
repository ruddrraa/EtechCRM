import { Bell, ChevronDown, Menu, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { titleFromPath } from '../../lib/utils'
import { apiFetch } from '../../lib/api'
import type { AuthUser } from '../../types'
import { useAuth } from '../../features/auth/AuthContext'

export function Topbar({ onMenu, user, onLogout }: { onMenu: () => void; user: AuthUser; onLogout: () => Promise<void> }) {
  const { user: currentUser } = useAuth()
  const activeUser = currentUser ?? user
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const notificationRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => apiFetch<{ items: NotificationItem[]; unread: number }>('/notifications'), refetchInterval: 30000 })
  const markAll = useMutation({ mutationFn: () => apiFetch('/notifications/read-all', { method: 'POST' }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }) })
  const markRead = useMutation({ mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }) })
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) setNotificationsOpen(false)
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setNotificationsOpen(false); setProfileOpen(false) } }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  const initials = activeUser.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const openNotification = (item: NotificationItem) => { if (!item.readAt) markRead.mutate(item._id); setNotificationsOpen(false); if (item.entityType === 'Visit') navigate('/visits') }
  return <header className="topbar"><button className="menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{titleFromPath(location.pathname)}</strong></div><div className="topbar-actions"><label className="search"><Search size={16} /><input placeholder="Search anything" aria-label="Global search" /></label><div className="notification-wrap" ref={notificationRef}><button className="icon-button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell size={18} />{Boolean(notifications.data?.unread) && <i>{notifications.data?.unread}</i>}</button>{notificationsOpen && <div className="notification-panel"><div className="notification-header"><strong>Notifications</strong><button className="text-button" disabled={!notifications.data?.unread || markAll.isPending} onClick={() => markAll.mutate()}>Mark all as read</button></div>{notifications.isLoading ? <p className="notification-state">Loading notifications...</p> : notifications.isError ? <p className="notification-state error">Unable to load notifications.</p> : notifications.data?.items.length ? notifications.data.items.map((item) => <button className={`notification-item ${item.readAt ? '' : 'unread'}`} key={item._id} onClick={() => openNotification(item)}><strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.createdAt).toLocaleString()}</small></button>) : <p className="notification-state">No notifications yet.</p>}</div>}</div><div className="profile-menu" ref={profileRef}><button className="profile-trigger" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen}>{activeUser.avatar ? <img className="avatar" src={activeUser.avatar} alt="" /> : <span className="avatar">{initials}</span>}<span className="profile-copy"><strong>{activeUser.name}</strong><small>{activeUser.role === 'MARKETING_EXECUTIVE' ? 'Marketing Executive' : activeUser.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Marketing Head'}</small></span><ChevronDown size={15} /></button>{profileOpen && <div className="profile-dropdown"><button onClick={() => { setProfileOpen(false); navigate('/settings') }}>My Profile</button><button onClick={() => { setProfileOpen(false); navigate('/settings?changePassword=1') }}>Change Password</button><button onClick={() => void onLogout()}>Sign out</button></div>}</div></div></header>
}

type NotificationItem = { _id: string; title: string; message: string; readAt?: string; createdAt: string; entityType?: string }
