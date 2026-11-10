import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { FileUpload } from '../../components/ui/FileUpload'
import { LoadingState, ErrorState } from '../../components/ui/States'
import { OrganizationSettings } from './OrganizationSettings'
import { CategorySettings } from './CategorySettings'
import { GeofenceSettings } from './GeofenceSettings'
import { StorageDashboard } from './StorageDashboard'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import type { NotificationItem, NotificationPreferences } from '../../types'
import {
  requestDesktopNotificationPermission,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '../../lib/pushClient'
import {
  subscribeToNotificationDiagnostics,
  type NotificationDiagnosticReport,
} from '../../lib/useForegroundNotifications'
import {
  User as UserIcon,
  Sliders,
  Building2,
  Tags,
  MapPin,
  HardDrive,
  ShieldCheck,
  Lock,
  Smartphone,
  Mail,
  Briefcase,
  KeyRound,
  Edit3,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ChevronRight,
  BellRing,
} from 'lucide-react'

type SettingsTab = 'profile' | 'general' | 'organization' | 'categories' | 'geofence' | 'storage' | 'security'

export function SettingsPage() {
  const { user, updateUser } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [dialog, setDialog] = useState<'profile' | 'password' | null>(null)
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordError, setPasswordError] = useState('')

  // Notifications State for General Tab
  const [notifications, setNotifications] = useState({
    dailyProductivity: true,
    newEventCreated: true,
    addedToTeam: true,
    mobilePush: true,
    desktopAlerts: true,
    emailSummary: false,
  })

  useEffect(() => {
    if (searchParams.get('changePassword') === '1') {
      setActiveTab('security')
    }
  }, [searchParams])

  const profileQuery = useQuery({
    queryKey: ['profile', 'me'],
    queryFn: () =>
      apiFetch<{
        name: string
        email: string
        phone?: string
        avatar?: string
        avatarAsset?: string
        role: string
        designation?: string
        notificationPreferences?: {
          dailyProductivity?: boolean
          newEventCreated?: boolean
          mobilePush?: boolean
          desktopAlerts?: boolean
          emailSummary?: boolean
        }
      }>('/users/me'),
  })

  const currentUser = profileQuery.data ?? user

  useEffect(() => {
    if (profileQuery.data?.notificationPreferences) {
      setNotifications((prev) => ({
        ...prev,
        ...profileQuery.data?.notificationPreferences,
      }))
    }
  }, [profileQuery.data?.notificationPreferences])

  const [testStatusMessage, setTestStatusMessage] = useState<{ text: string; isError: boolean } | null>(null)
  const [bannerReport, setBannerReport] = useState<NotificationDiagnosticReport | null>(null)
  const [visualConfirmState, setVisualConfirmState] = useState<'pending' | 'confirmed' | 'not_visible'>('pending')
  const trackedDiagnosticIdRef = useRef<string | null>(null)

  useEffect(() => {
    return subscribeToNotificationDiagnostics((report) => {
      if (trackedDiagnosticIdRef.current && report.notificationId === trackedDiagnosticIdRef.current) {
        setBannerReport(report)
      }
    })
  }, [])

  const preferencesMutation = useMutation({
    mutationFn: (body: Partial<typeof notifications>) =>
      apiFetch<NotificationPreferences>('/users/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (updatedPrefs) => {
      void queryClient.invalidateQueries({ queryKey: ['profile', 'me'] })
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      if (user) {
        updateUser({
          ...user,
          notificationPreferences: {
            ...user.notificationPreferences,
            ...(updatedPrefs as NotificationPreferences),
          },
        })
      }
    },
  })

  const testNotificationMutation = useMutation({
    mutationFn: () => apiFetch<NotificationItem>('/notifications/test', { method: 'POST' }),
  })

  const handleTestWindowsDesktopBanner = async () => {
    setTestStatusMessage(null)
    setBannerReport(null)
    setVisualConfirmState('pending')
    trackedDiagnosticIdRef.current = null

    if (!('Notification' in window)) {
      setTestStatusMessage({ text: 'Web Notification API is not supported by this browser.', isError: true })
      return
    }

    let permission = Notification.permission
    if (permission !== 'granted') {
      permission = await requestDesktopNotificationPermission()
    }

    if (permission !== 'granted') {
      setTestStatusMessage({
        text: `Permission is "${permission}". Allow notifications for this site to test banner delivery.`,
        isError: true,
      })
      return
    }

    try {
      // Ensure the initial notification baseline has been fetched so Topbar's listener treats the new record as incremental
      await queryClient.ensureQueryData({
        queryKey: ['notifications'],
        queryFn: () => apiFetch<{ items: NotificationItem[]; unread: number }>('/notifications'),
      })

      // Create 1 unique CRM notification in MongoDB and trigger the exact same polling delivery path
      const created = await testNotificationMutation.mutateAsync()
      trackedDiagnosticIdRef.current = created._id

      await queryClient.refetchQueries({ queryKey: ['notifications'] })

      setTestStatusMessage({
        text: 'CRM alert created and routed through notification pipeline. Confirm visually whether the banner appeared.',
        isError: false,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create test notification'
      setTestStatusMessage({ text: msg, isError: true })
    }
  }

  const handleToggleNotification = async (key: keyof typeof notifications, value: boolean) => {
    if (key === 'desktopAlerts' && value) {
      const perm = await requestDesktopNotificationPermission()
      if (perm !== 'granted') {
        alert('Desktop notification permission was denied or dismissed. Please allow notifications in your browser settings.')
        return
      }
    }

    if (key === 'mobilePush') {
      if (value) {
        const res = await subscribeToWebPush()
        if (!res.success) {
          alert(res.message || 'Could not register push notifications.')
        }
      } else {
        await unsubscribeFromWebPush()
      }
    }

    setNotifications((prev) => ({ ...prev, [key]: value }))
    preferencesMutation.mutate({ [key]: value })
  }

  const logoutAllMutation = useMutation({
    mutationFn: () => apiFetch('/auth/logout-all', { method: 'POST' }),
    onSuccess: () => {
      window.location.href = '/login'
    },
    onError: (err: Error) => {
      alert(err.message || 'Failed to invalidate sessions.')
    },
  })

  // Profile Edit Mutation
  const profileMutation = useMutation({
    mutationFn: (body: { name: string; phone?: string }) =>
      apiFetch<{ name: string; phone?: string }>('/users/me', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (updated: { name: string; phone?: string }) => {
      if (user) {
        updateUser({ ...user, name: updated.name, phone: updated.phone })
      }
      void queryClient.invalidateQueries({ queryKey: ['profile', 'me'] })
      setProfileSuccess('Profile details updated successfully.')
      setDialog(null)
      setTimeout(() => setProfileSuccess(''), 4000)
    },
    onError: (err: Error) => {
      setProfileError(err.message || 'Failed to update profile.')
    },
  })

  // Change Password Mutation
  const passwordMutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiFetch<{ changed: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setPasswordSuccess('Password changed successfully.')
      setDialog(null)
      setTimeout(() => setPasswordSuccess(''), 4000)
    },
    onError: (err: Error) => {
      setPasswordError(err.message || 'Failed to change password.')
    },
  })

  const handleProfileSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setProfileError('')
    const form = new FormData(e.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const phone = String(form.get('phone') ?? '').trim()
    profileMutation.mutate({ name, phone })
  }

  const handlePasswordSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPasswordError('')
    const form = new FormData(e.currentTarget)
    const currentPassword = String(form.get('currentPassword') ?? '')
    const newPassword = String(form.get('newPassword') ?? '')
    const confirmPassword = String(form.get('confirmPassword') ?? '')

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }

    passwordMutation.mutate({ currentPassword, newPassword })
  }

  const hasValidAvatar = Boolean(currentUser?.avatar && !currentUser.avatar.includes('mock-storage.local'))

  // Navigation Items defined by Groups
  const accountNav = [
    { id: 'profile' as const, label: 'My Profile', icon: UserIcon },
    { id: 'general' as const, label: 'General', icon: Sliders },
    { id: 'security' as const, label: 'Security', icon: ShieldCheck },
  ]

  const workspaceNav = isSuperAdmin
    ? [
        { id: 'organization' as const, label: 'Organization', icon: Building2 },
        { id: 'categories' as const, label: 'Categories', icon: Tags },
        { id: 'geofence' as const, label: 'GPS & Geofencing', icon: MapPin },
        { id: 'storage' as const, label: 'File & Media Management', icon: HardDrive },
      ]
    : []

  const currentTabLabel =
    [...accountNav, ...workspaceNav].find((t) => t.id === activeTab)?.label ?? 'My Profile'

  return (
    <div className="page settings-page">
      {/* Two-Column Layout (Matching Reference Screenshot) */}
      <div className="settings-two-column-layout">
        {/* LEFT COLUMN — Secondary Settings Navigation */}
        <nav className="settings-nav-sidebar" aria-label="Settings navigation">
          {/* ACCOUNT GROUP */}
          <div className="settings-nav-group">
            <span className="settings-nav-group-title">Account</span>
            {accountNav.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>

          {/* WORKSPACE GROUP (Super Admin Only) */}
          {workspaceNav.length > 0 && (
            <div className="settings-nav-group">
              <span className="settings-nav-group-title">Workspace</span>
              {workspaceNav.map((item) => {
                const Icon = item.icon
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveTab(item.id)}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </nav>

        {/* RIGHT COLUMN — Settings Content Area */}
        <section className="settings-content-area">
          {/* Breadcrumb Header */}
          <div className="settings-breadcrumb-header">
            <span>Settings</span>
            <ChevronRight size={15} style={{ color: 'var(--muted)' }} />
            <strong>{currentTabLabel}</strong>
          </div>

          {/* Feedback Alerts */}
          {profileSuccess && (
            <div style={{ padding: '0.75rem 1rem', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', color: '#065f46', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={16} />
              <span>{profileSuccess}</span>
            </div>
          )}

          {passwordSuccess && (
            <div style={{ padding: '0.75rem 1rem', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', color: '#065f46', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={16} />
              <span>{passwordSuccess}</span>
            </div>
          )}

          {/* 1. MY PROFILE */}
          {activeTab === 'profile' && (
            <div className="settings-panel">
              <div className="settings-section-header">
                <h2>Profile Information</h2>
                <p>Manage your account credentials, avatar, and contact details.</p>
              </div>

              {profileQuery.isLoading ? (
                <LoadingState />
              ) : profileQuery.isError ? (
                <ErrorState description="Unable to load your profile." />
              ) : (
                <div>
                  {/* Avatar & Photo Upload Section */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                    <div className="profile-avatar-box">
                      {hasValidAvatar ? (
                        <img
                          src={currentUser?.avatar}
                          alt={currentUser?.name}
                        />
                      ) : (
                        <span style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--foreground)' }}>
                          {currentUser?.name?.slice(0, 2).toUpperCase() || 'U'}
                        </span>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: '220px', maxWidth: '380px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: '0.35rem' }}>
                        Profile Picture
                      </span>
                      <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '0.75rem', fontSize: '0.75rem' }}>
                        PNG, JPG or WebP (max 5MB). Standard 96x96px display.
                      </small>
                      {user && (
                        <FileUpload
                          ownerType="USER_AVATAR"
                          ownerId={user._id}
                          assetId={currentUser?.avatarAsset || (currentUser?.avatar?.includes('/api/files/') ? currentUser.avatar.split('/')[3] : undefined)}
                          label=""
                          description="Click or drop new photo"
                          accept="image/jpeg,image/png,image/webp"
                          maxSizeBytes={5 * 1024 * 1024}
                          currentUrl={currentUser?.avatar}
                          onUploadSuccess={(data) => {
                            updateUser({ ...user, avatar: data.viewUrl || data.signedUrl, avatarAsset: data.asset?._id })
                            void queryClient.invalidateQueries({ queryKey: ['profile', 'me'] })
                          }}
                          onDeleteSuccess={() => {
                            updateUser({ ...user, avatar: undefined, avatarAsset: undefined })
                            void queryClient.invalidateQueries({ queryKey: ['profile', 'me'] })
                          }}
                        />
                      )}
                    </div>
                  </div>

                  <hr className="settings-divider" />

                  {/* Profile Fields Details */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '4px' }}>
                        Full Name
                      </span>
                      <strong style={{ fontSize: '1.05rem', color: 'var(--foreground)' }}>{currentUser?.name}</strong>
                    </div>

                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '4px' }}>
                        Official Email
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--foreground)' }}>
                        <Mail size={15} style={{ color: 'var(--muted)' }} />
                        <span style={{ fontSize: '0.9rem' }}>{currentUser?.email}</span>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '4px' }}>
                        Phone Number
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--foreground)' }}>
                        <Smartphone size={15} style={{ color: 'var(--muted)' }} />
                        <span style={{ fontSize: '0.9rem' }}>{currentUser?.phone || 'Not configured'}</span>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '4px' }}>
                        Assigned Role
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Briefcase size={15} style={{ color: 'var(--muted)' }} />
                        <Badge tone="neutral">
                          {currentUser?.role === 'SUPER_ADMIN'
                            ? 'Super Admin'
                            : currentUser?.role === 'MARKETING_HEAD'
                            ? 'Marketing Head'
                            : 'Marketing Executive'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '1.5rem' }}>
                    <Lock size={13} />
                    <span>Your account role and official email address are controlled by system administrators.</span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={() => setDialog('profile')}>
                      <Edit3 size={15} style={{ marginRight: '6px' }} />
                      Edit Profile Details
                    </Button>
                    <Button variant="secondary" onClick={() => setDialog('password')}>
                      <KeyRound size={15} style={{ marginRight: '6px' }} />
                      Change Password
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. GENERAL PREFERENCES */}
          {activeTab === 'general' && (
            <div className="settings-panel">
              <div className="settings-section-header">
                <h2>General Preferences</h2>
                <p>Configure notifications, regional formats, and workspace appearance.</p>
              </div>

              {/* My Notifications Subsection */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>My Notifications</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <HelpCircle size={13} /> About notifications
                  </span>
                </div>

                <div className="settings-form-row">
                  <div className="settings-form-row-info">
                    <strong>Daily productivity update</strong>
                    <span>Receive a morning summary of pending client visits and performance metrics.</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={notifications.dailyProductivity}
                      onChange={(e) => void handleToggleNotification('dailyProductivity', e.target.checked)}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>

                <div className="settings-form-row">
                  <div className="settings-form-row-info">
                    <strong>New visit assignments</strong>
                    <span>Instant alerts when a client visit or schedule is assigned or rescheduled.</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={notifications.newEventCreated}
                      onChange={(e) => void handleToggleNotification('newEventCreated', e.target.checked)}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>

                <div className="settings-form-row">
                  <div className="settings-form-row-info">
                    <strong>Mobile push notifications</strong>
                    <span>Receive real-time push alerts whenever client action or location exception requires attention.</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={notifications.mobilePush}
                      onChange={(e) => void handleToggleNotification('mobilePush', e.target.checked)}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>

                <div className="settings-form-row">
                  <div className="settings-form-row-info">
                    <strong>Desktop notification banners</strong>
                    <span>Display desktop browser notifications when in-app alerts arrive.</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={notifications.desktopAlerts}
                      onChange={(e) => void handleToggleNotification('desktopAlerts', e.target.checked)}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>

                {/* Dedicated Desktop & Mobile Banner Diagnostic Trigger */}
                <div style={{ margin: '0.25rem 0 1.25rem 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <Button
                      variant="secondary"
                      disabled={testNotificationMutation.isPending}
                      onClick={() => void handleTestWindowsDesktopBanner()}
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', height: '32px' }}
                    >
                      <BellRing size={13} style={{ marginRight: '6px' }} />
                      {testNotificationMutation.isPending ? 'Dispatching...' : 'Test Windows Desktop Banner'}
                    </Button>
                    {testStatusMessage && (
                      <span
                        style={{
                          fontSize: '0.8rem',
                          color: testStatusMessage.isError ? '#dc2626' : 'var(--muted)',
                          fontWeight: 500,
                        }}
                      >
                        {testStatusMessage.text}
                      </span>
                    )}
                  </div>

                  {bannerReport && (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        padding: '0.85rem 1rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: '#fafafa',
                        fontSize: '0.78rem',
                        lineHeight: 1.5,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '0.82rem' }}>Notification Delivery Diagnostic</strong>
                        <Badge
                          tone={
                            bannerReport.status === 'error'
                              ? 'danger'
                              : bannerReport.status === 'suppressed'
                              ? 'warning'
                              : visualConfirmState === 'confirmed'
                              ? 'success'
                              : visualConfirmState === 'not_visible'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {bannerReport.status === 'error'
                            ? 'Delivery Error'
                            : bannerReport.status === 'suppressed'
                            ? 'Suppressed'
                            : visualConfirmState === 'confirmed'
                            ? 'Banner Visually Confirmed'
                            : visualConfirmState === 'not_visible'
                            ? 'API Dispatched — Banner Not Visible'
                            : 'API Dispatched — Awaiting Visual Check'}
                        </Badge>
                      </div>

                      {bannerReport.reason && (
                        <p style={{ margin: '0 0 0.5rem 0', color: '#dc2626', fontWeight: 500 }}>{bannerReport.reason}</p>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.35rem 1rem', color: 'var(--muted)' }}>
                        <div>Delivery path: <code>{bannerReport.method}</code></div>
                        <div>Permission: <code>{bannerReport.environment.permission}</code></div>
                        <div>Service Worker: <code>{bannerReport.environment.serviceWorkerState}</code></div>
                        <div>Tab visibility: <code>{bannerReport.environment.visibilityState}</code> (focus: <code>{String(bannerReport.environment.hasFocus)}</code>)</div>
                        <div>Tag: <code>{bannerReport.tag}</code></div>
                        <div>Active in OS/browser store: <code>{bannerReport.activeInNotificationCenterCount ?? 'checking...'}</code></div>
                      </div>

                      {bannerReport.events.length > 0 && (
                        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
                          <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--ink)' }}>Event Log:</strong>
                          {bannerReport.events.map((ev, idx) => (
                            <div key={`${ev.type}-${idx}`} style={{ fontFamily: 'monospace', fontSize: '0.73rem' }}>
                              [{new Date(ev.timestamp).toLocaleTimeString()}] {ev.type}: {ev.detail || ''}
                            </div>
                          ))}
                        </div>
                      )}

                      {bannerReport.status === 'dispatched' && visualConfirmState === 'pending' && (
                        <div style={{ marginTop: '0.65rem', paddingTop: '0.65rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 500, color: 'var(--ink)' }}>Did a visible toast banner appear on your screen?</span>
                          <Button
                            variant="secondary"
                            onClick={() => setVisualConfirmState('confirmed')}
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', height: '28px' }}
                          >
                            Yes, banner appeared
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setVisualConfirmState('not_visible')}
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', height: '28px' }}
                          >
                            No visible banner
                          </Button>
                        </div>
                      )}

                      {visualConfirmState === 'not_visible' && (
                        <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.65rem', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '6px', color: '#9a3412' }}>
                          Browser accepted the notification without error, but Windows/device did not show a toast popup. Press <strong>Win + N</strong> (Notification Center) or swipe down on mobile to check if it arrived silently in Notification Center, or test while switching to another tab / minimizing the browser.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="settings-form-row">
                  <div className="settings-form-row-info">
                    <strong>Email activity digests</strong>
                    <span>Receive weekly summaries of team visit completions and client records.</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={notifications.emailSummary}
                      onChange={(e) => void handleToggleNotification('emailSummary', e.target.checked)}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>

              <hr className="settings-divider" />

              {/* Regional & Localization */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 1rem 0' }}>Regional &amp; Localization</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  <div className="settings-form-row-info">
                    <strong>Timezone</strong>
                    <span>Asia/Kolkata (IST, UTC+05:30)</span>
                  </div>
                  <div className="settings-form-row-info">
                    <strong>Date &amp; Time Format</strong>
                    <span>DD/MM/YYYY (24h clock)</span>
                  </div>
                  <div className="settings-form-row-info">
                    <strong>System Language</strong>
                    <span>English (India)</span>
                  </div>
                  <div className="settings-form-row-info">
                    <strong>Currency Format</strong>
                    <span>INR (₹)</span>
                  </div>
                </div>
              </div>

              <hr className="settings-divider" />

              {/* Appearance */}
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>Appearance</h3>
                <p style={{ fontSize: '0.825rem', color: 'var(--muted)', margin: '0 0 1rem 0' }}>
                  Standard enterprise theme configured for Excel Technologies &amp; Services.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Badge tone="neutral">Light SaaS Theme (Active)</Badge>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Optimized for desktop &amp; field mobile viewports.</span>
                </div>
              </div>
            </div>
          )}

          {/* 3. ORGANIZATION (Super Admin Only) */}
          {activeTab === 'organization' && isSuperAdmin && (
            <OrganizationSettings />
          )}

          {/* 4. CATEGORIES (Super Admin Only) */}
          {activeTab === 'categories' && isSuperAdmin && (
            <CategorySettings />
          )}

          {/* 5. GPS & GEOFENCING (Super Admin Only) */}
          {activeTab === 'geofence' && isSuperAdmin && (
            <GeofenceSettings />
          )}

          {/* 6. FILE & MEDIA MANAGEMENT (Super Admin Only) */}
          {activeTab === 'storage' && isSuperAdmin && (
            <StorageDashboard />
          )}

          {/* 7. SECURITY */}
          {activeTab === 'security' && (
            <div className="settings-panel">
              <div className="settings-section-header">
                <h2>Security &amp; Authentication</h2>
                <p>Manage your account password, security credentials, and active session.</p>
              </div>

              {passwordError && (
                <div style={{ padding: '0.75rem 1rem', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', color: '#e11d48', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <AlertCircle size={16} />
                  <span>{passwordError}</span>
                </div>
              )}

              {/* Change Password Form */}
              <div style={{ maxWidth: '440px', marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 1rem 0' }}>Change Password</h3>
                <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
                    Current Password
                    <input
                      name="currentPassword"
                      type="password"
                      required
                      placeholder="Enter your current password"
                      style={{ height: '38px', padding: '0 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.875rem' }}
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
                    New Password (Min 8 characters)
                    <input
                      name="newPassword"
                      type="password"
                      required
                      placeholder="Enter new secure password"
                      style={{ height: '38px', padding: '0 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.875rem' }}
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
                    Confirm New Password
                    <input
                      name="confirmPassword"
                      type="password"
                      required
                      placeholder="Confirm your new password"
                      style={{ height: '38px', padding: '0 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.875rem' }}
                    />
                  </label>

                  <div style={{ paddingTop: '0.5rem' }}>
                    <Button type="submit" disabled={passwordMutation.isPending}>
                      {passwordMutation.isPending ? 'Updating password...' : 'Update Password'}
                    </Button>
                  </div>
                </form>
              </div>

              <hr className="settings-divider" />

              {/* Active Session & Compliance */}
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>Session &amp; Token Architecture</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', color: 'var(--foreground-secondary)', marginBottom: '1.25rem' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block' }}>Session Security</span>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--foreground)' }}>HTTP-Only Signed JWT Cookie</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block' }}>Session Invalidation</span>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--foreground)' }}>Atomic Token Versioning Active</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block' }}>Role Boundary</span>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--foreground)' }}>{currentUser?.role}</strong>
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--surface-muted, #f8fafc)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div>
                    <strong style={{ fontSize: '0.875rem', display: 'block' }}>Global Session Revocation</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      Immediately invalidate all active login sessions and JWT tokens across all browsers, mobile devices, and computers.
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={logoutAllMutation.isPending}
                    onClick={() => {
                      if (window.confirm('Are you sure you want to log out of all active sessions across all devices? You will need to log in again.')) {
                        logoutAllMutation.mutate()
                      }
                    }}
                  >
                    {logoutAllMutation.isPending ? 'Revoking sessions...' : 'Sign out of all devices'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Profile Details Edit Modal */}
      {dialog === 'profile' && (
        <Modal title="Edit Profile Details" onClose={() => setDialog(null)}>
          <form className="modal-form" onSubmit={handleProfileSubmit}>
            {profileError && (
              <div style={{ padding: '0.5rem 0.75rem', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '6px', color: '#e11d48', fontSize: '0.85rem' }}>
                {profileError}
              </div>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
              Full Name
              <input
                name="name"
                defaultValue={currentUser?.name}
                required
                style={{ height: '38px', padding: '0 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.875rem' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
              Phone Number
              <input
                name="phone"
                defaultValue={currentUser?.phone || ''}
                placeholder="+91 98765 43210"
                style={{ height: '38px', padding: '0 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.875rem' }}
              />
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              <Lock size={12} />
              <span>Email address and assigned role are strictly managed by system administrators.</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={profileMutation.isPending}>
                {profileMutation.isPending ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Change Password Modal */}
      {dialog === 'password' && (
        <Modal title="Change Password" onClose={() => setDialog(null)}>
          <form className="modal-form" onSubmit={handlePasswordSubmit}>
            {passwordError && (
              <div style={{ padding: '0.5rem 0.75rem', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '6px', color: '#e11d48', fontSize: '0.85rem' }}>
                {passwordError}
              </div>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
              Current Password
              <input
                name="currentPassword"
                type="password"
                required
                style={{ height: '38px', padding: '0 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.875rem' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
              New Password (Min 8 characters)
              <input
                name="newPassword"
                type="password"
                required
                style={{ height: '38px', padding: '0 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.875rem' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500 }}>
              Confirm New Password
              <input
                name="confirmPassword"
                type="password"
                required
                style={{ height: '38px', padding: '0 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.875rem' }}
              />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={passwordMutation.isPending}>
                {passwordMutation.isPending ? 'Updating...' : 'Update Password'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
