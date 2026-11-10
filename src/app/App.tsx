import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { useAuth } from '../features/auth/AuthContext'
import { ErrorState, LoadingState } from '../components/ui/States'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import type { Role } from '../types'

const LoginPage = lazy(() => import('../features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const DashboardPage = lazy(() =>
  import('../features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
)
const ModulePage = lazy(() => import('../features/module/ModulePage').then((m) => ({ default: m.ModulePage })))
const ReportsPage = lazy(() => import('../features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const SettingsPage = lazy(() => import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))

export function App() {
  const { user, isLoading, logout } = useAuth()
  const location = useLocation()

  if (isLoading) return <LoadingState />

  if (!user) {
    return (
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    )
  }

  const module = (name: string, allowed: Role[]) =>
    allowed.includes(user.role) ? <ModulePage module={name} /> : <ErrorState />

  return (
    <AppShell user={user} onLogout={logout}>
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/" element={<DashboardPage role={user.role} userName={user.name} />} />
            <Route path="/dashboard" element={<DashboardPage role={user.role} userName={user.name} />} />
            <Route path="/clients" element={module('clients', ['SUPER_ADMIN', 'MARKETING_HEAD', 'MARKETING_EXECUTIVE'])} />
            <Route path="/visits" element={module('visits', ['SUPER_ADMIN', 'MARKETING_HEAD', 'MARKETING_EXECUTIVE'])} />
            <Route path="/staff" element={module('staff', ['SUPER_ADMIN', 'MARKETING_HEAD'])} />
            <Route
              path="/reports"
              element={
                ['SUPER_ADMIN', 'MARKETING_HEAD', 'MARKETING_EXECUTIVE'].includes(user.role) ? (
                  <ReportsPage />
                ) : (
                  <ErrorState description="Reports are restricted to authorised staff." />
                )
              }
            />
            <Route path="/audit-logs" element={module('audit-logs', ['SUPER_ADMIN', 'MARKETING_HEAD'])} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  )
}
