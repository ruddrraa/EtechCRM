import {
  Bell,
  ChevronDown,
  Menu,
  Search,
  X,
  BriefcaseBusiness,
  Users,
  CalendarDays,
  LayoutDashboard,
  Settings,
  FileClock,
  Trash2,
  FileText,
} from 'lucide-react'
import { useEffect, useRef, useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { titleFromPath } from '../../lib/utils'
import { apiFetch } from '../../lib/api'
import type { AuthUser, NotificationItem } from '../../types'
import { useAuth } from '../../features/auth/AuthContext'
import { useForegroundNotifications } from '../../lib/useForegroundNotifications'

export function Topbar({ onMenu, user, onLogout }: { onMenu: () => void; user: AuthUser; onLogout: () => Promise<void> }) {
  const { user: currentUser } = useAuth()
  const activeUser = currentUser ?? user
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const notificationRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  // Notifications queries and mutations
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<{ items: NotificationItem[]; unread: number }>('/notifications'),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // Connect polling notifications to unified desktop & mobile OS notification pipeline
  useForegroundNotifications({
    user: activeUser,
    items: notifications.data?.items,
    onNavigate: (path) => navigate(path),
    onMarkRead: (id) => markRead.mutate(id),
  })

  const markAll = useMutation({
    mutationFn: () => apiFetch('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const clearAll = useMutation({
    mutationFn: () => apiFetch('/notifications', { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const deleteOne = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // Global Search Queries (only fetched when search bar is focused)
  const clientsSearch = useQuery({
    queryKey: ['clients', 'globalSearch'],
    enabled: searchOpen,
    queryFn: () => apiFetch<{ items: Array<{ _id: string; organisationName: string; category?: string; address?: string }> }>('/clients'),
    staleTime: 60000,
  })

  const staffSearch = useQuery({
    queryKey: ['staff', 'globalSearch'],
    enabled: searchOpen && activeUser.role !== 'MARKETING_EXECUTIVE',
    queryFn: () => apiFetch<Array<{ _id: string; name: string; role: string; email: string; designation?: string }>>('/users'),
    staleTime: 60000,
  })

  const visitsSearch = useQuery({
    queryKey: ['visits', 'globalSearch'],
    enabled: searchOpen,
    queryFn: () => apiFetch<{ items: Array<{ _id: string; status: string; client?: { organisationName?: string; address?: string }; plannedDate: string }> }>('/visits'),
    staleTime: 60000,
  })

  // Filtered global search results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null

    const matchingClients = (clientsSearch.data?.items ?? []).filter(
      (c) => c.organisationName.toLowerCase().includes(q) || (c.address && c.address.toLowerCase().includes(q)) || (c.category && c.category.toLowerCase().includes(q))
    ).slice(0, 4)

    const matchingStaff = (staffSearch.data ?? []).filter(
      (s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || (s.designation && s.designation.toLowerCase().includes(q))
    ).slice(0, 4)

    const matchingVisits = (visitsSearch.data?.items ?? []).filter(
      (v) => (v.client?.organisationName && v.client.organisationName.toLowerCase().includes(q)) || (v.client?.address && v.client.address.toLowerCase().includes(q)) || v.status.toLowerCase().includes(q)
    ).slice(0, 4)

    const modules = [
      { name: 'Dashboard', path: '/', icon: LayoutDashboard },
      { name: 'Clients', path: '/clients', icon: BriefcaseBusiness },
      { name: 'Visits', path: '/visits', icon: CalendarDays },
      { name: 'Staff Directory', path: '/staff', icon: Users, adminOnly: true },
      { name: 'Reports & Analytics', path: '/reports', icon: FileText },
      { name: 'Audit Logs', path: '/audit-logs', icon: FileClock, adminOnly: true },
      { name: 'Settings & Organization', path: '/settings', icon: Settings },
    ].filter((m) => {
      if (m.adminOnly && activeUser.role === 'MARKETING_EXECUTIVE') return false
      return m.name.toLowerCase().includes(q)
    })

    return {
      clients: matchingClients,
      staff: matchingStaff,
      visits: matchingVisits,
      modules,
      hasResults: matchingClients.length > 0 || matchingStaff.length > 0 || matchingVisits.length > 0 || modules.length > 0,
    }
  }, [searchQuery, clientsSearch.data, staffSearch.data, visitsSearch.data, activeUser.role])

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false)
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false)
      }
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setSearchOpen(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotificationsOpen(false)
        setProfileOpen(false)
        setSearchOpen(false)
      }
      // Ctrl + K or Cmd + K shortcut to focus search
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  const initials = activeUser.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

  const openNotification = (item: NotificationItem) => {
    if (!item.readAt) markRead.mutate(item._id)
    setNotificationsOpen(false)
    if (item.entityType === 'Visit') navigate('/visits')
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    setSearchOpen(false)
    navigate(`/clients?q=${encodeURIComponent(searchQuery.trim())}`)
  }

  const hasValidAvatar = Boolean(activeUser.avatar && !activeUser.avatar.includes('mock-storage.local'))

  return (
    <header className="topbar">
      <button className="menu-button" onClick={onMenu} aria-label="Open navigation">
        <Menu size={20} />
      </button>

      <div className="breadcrumbs">
        <span>Workspace</span>
        <b>/</b>
        <strong>{titleFromPath(location.pathname)}</strong>
      </div>

      <div className="topbar-actions">
        {/* Global Search Bar with Autocomplete Dropdown */}
        <div className="search-wrapper" ref={searchRef}>
          <form onSubmit={handleSearchSubmit}>
            <label className="search">
              <Search size={16} />
              <input
                placeholder="Search anything (Clients, Visits, Staff)..."
                aria-label="Global search"
                value={searchQuery}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (!searchOpen) setSearchOpen(true)
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--muted)', display: 'flex' }}
                  aria-label="Clear search input"
                >
                  <X size={14} />
                </button>
              )}
            </label>
          </form>

          {/* Search Results Dropdown */}
          {searchOpen && searchQuery.trim() && (
            <div className="search-results-dropdown">
              {searchResults?.hasResults ? (
                <>
                  {/* Matching Navigation Modules */}
                  {searchResults.modules.length > 0 && (
                    <div className="search-result-group">
                      <span className="search-result-group-title">Pages</span>
                      {searchResults.modules.map((m) => {
                        const Icon = m.icon
                        return (
                          <button
                            key={m.path}
                            type="button"
                            className="search-result-item"
                            onClick={() => {
                              setSearchOpen(false)
                              navigate(m.path)
                            }}
                          >
                            <div className="search-result-item-main">
                              <Icon size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                              <strong>{m.name}</strong>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Matching Clients */}
                  {searchResults.clients.length > 0 && (
                    <div className="search-result-group">
                      <span className="search-result-group-title">Clients</span>
                      {searchResults.clients.map((c) => (
                        <button
                          key={c._id}
                          type="button"
                          className="search-result-item"
                          onClick={() => {
                            setSearchOpen(false)
                            navigate(`/clients?q=${encodeURIComponent(c.organisationName)}`)
                          }}
                        >
                          <div className="search-result-item-main" style={{ minWidth: 0 }}>
                            <BriefcaseBusiness size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                              <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.organisationName}</strong>
                              {c.address && (
                                <span
                                  title={c.address}
                                  style={{
                                    fontSize: '0.75rem',
                                    color: 'var(--muted)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    display: 'block',
                                  }}
                                >
                                  {c.address}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Matching Visits */}
                  {searchResults.visits.length > 0 && (
                    <div className="search-result-group">
                      <span className="search-result-group-title">Visits</span>
                      {searchResults.visits.map((v) => (
                        <button
                          key={v._id}
                          type="button"
                          className="search-result-item"
                          onClick={() => {
                            setSearchOpen(false)
                            navigate(`/visits?q=${encodeURIComponent(v.client?.organisationName || '')}`)
                          }}
                        >
                          <div className="search-result-item-main">
                            <CalendarDays size={15} style={{ color: '#0284c7', flexShrink: 0 }} />
                            <div>
                              <strong>{v.client?.organisationName || 'Visit'}</strong>
                              <span> · Status: {v.status}</span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Matching Staff */}
                  {searchResults.staff.length > 0 && (
                    <div className="search-result-group">
                      <span className="search-result-group-title">Staff Members</span>
                      {searchResults.staff.map((s) => (
                        <button
                          key={s._id}
                          type="button"
                          className="search-result-item"
                          onClick={() => {
                            setSearchOpen(false)
                            navigate(`/staff?q=${encodeURIComponent(s.name)}`)
                          }}
                        >
                          <div className="search-result-item-main">
                            <Users size={15} style={{ color: '#16a34a', flexShrink: 0 }} />
                            <div>
                              <strong>{s.name}</strong>
                              <span> · {s.email}</span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="search-no-results">
                  <span>No matching records found for "{searchQuery}".</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notification Bell & Panel */}
        <div className="notification-wrap" ref={notificationRef}>
          <button
            className="icon-button"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            onClick={() => setNotificationsOpen(!notificationsOpen)}
          >
            <Bell size={18} />
            {Boolean(notifications.data?.unread) && <i>{notifications.data?.unread}</i>}
          </button>

          {notificationsOpen && (
            <div className="notification-panel">
              <div className="notification-header">
                <strong>Notifications</strong>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="text-button"
                    disabled={!notifications.data?.unread || markAll.isPending}
                    onClick={() => markAll.mutate()}
                  >
                    Mark all read
                  </button>
                  <button
                    className="text-button"
                    style={{ color: '#e11d48' }}
                    disabled={!notifications.data?.items?.length || clearAll.isPending}
                    onClick={() => {
                      if (window.confirm('Are you sure you want to clear all notifications? This will delete them permanently from the database.')) {
                        clearAll.mutate()
                      }
                    }}
                  >
                    {clearAll.isPending ? 'Clearing...' : 'Clear all'}
                  </button>
                </div>
              </div>

              {notifications.isLoading ? (
                <p className="notification-state">Loading notifications...</p>
              ) : notifications.isError ? (
                <p className="notification-state error">Unable to load notifications.</p>
              ) : notifications.data?.items.length ? (
                <div>
                  {notifications.data.items.map((item) => (
                    <div className={`notification-item-wrap ${item.readAt ? '' : 'unread'}`} key={item._id}>
                      <button
                        className="notification-item"
                        onClick={() => openNotification(item)}
                      >
                        <strong>{item.title}</strong>
                        <span>{item.message}</span>
                        <small>{new Date(item.createdAt).toLocaleString()}</small>
                      </button>

                      <button
                        className="notification-delete-btn"
                        title="Delete this notification"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteOne.mutate(item._id)
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="notification-state">No notifications yet.</p>
              )}
            </div>
          )}
        </div>

        {/* User Profile Menu */}
        <div className="profile-menu" ref={profileRef}>
          <button
            className="profile-trigger"
            onClick={() => setProfileOpen(!profileOpen)}
            aria-expanded={profileOpen}
          >
            <span className="avatar">
              {hasValidAvatar ? <img src={activeUser.avatar} alt="" /> : initials}
            </span>
            <span className="profile-copy">
              <strong>{activeUser.name}</strong>
              <small>
                {activeUser.role === 'MARKETING_EXECUTIVE'
                  ? 'Marketing Executive'
                  : activeUser.role === 'SUPER_ADMIN'
                  ? 'Super Admin'
                  : 'Marketing Head'}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>

          {profileOpen && (
            <div className="profile-dropdown">
              <button
                onClick={() => {
                  setProfileOpen(false)
                  navigate('/settings')
                }}
              >
                My Profile
              </button>
              <button
                onClick={() => {
                  setProfileOpen(false)
                  navigate('/settings?changePassword=1')
                }}
              >
                Change Password
              </button>
              <button onClick={() => void onLogout()}>Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
