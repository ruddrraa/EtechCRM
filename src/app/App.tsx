import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { ModulePage } from '../features/module/ModulePage'
import { LoginPage } from '../features/auth/LoginPage'
import { useAuth } from '../features/auth/AuthContext'
import { LoadingState } from '../components/ui/States'
import type { Role } from '../types'
import { ErrorState } from '../components/ui/States'
import { ReportsPage } from '../features/reports/ReportsPage'

export function App() {
  const { user, isLoading, logout } = useAuth()
  if (isLoading) return <LoadingState />
  if (!user) {
    return <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  }
  const module = (name: string, allowed: Role[]) => allowed.includes(user.role) ? <ModulePage module={name} /> : <ErrorState />
  return <AppShell user={user} onLogout={logout}><Routes>
    <Route path="/login" element={<Navigate to="/" replace />} />
    <Route path="/" element={<DashboardPage role={user.role} userName={user.name} />} />
    <Route path="/dashboard" element={<DashboardPage role={user.role} userName={user.name} />} />
    <Route path="/clients" element={module('clients', ['SUPER_ADMIN', 'MARKETING_HEAD', 'MARKETING_EXECUTIVE'])} />
    <Route path="/visits" element={module('visits', ['SUPER_ADMIN', 'MARKETING_HEAD', 'MARKETING_EXECUTIVE'])} />
    <Route path="/staff" element={module('staff', ['SUPER_ADMIN', 'MARKETING_HEAD'])} />
    <Route path="/reports" element={['SUPER_ADMIN', 'MARKETING_HEAD', 'MARKETING_EXECUTIVE'].includes(user.role) ? <ReportsPage /> : <ErrorState description="Reports are restricted to authorised staff." />} />
    <Route path="/audit-logs" element={module('audit-logs', ['SUPER_ADMIN', 'MARKETING_HEAD'])} />
    <Route path="/settings" element={module('settings', ['SUPER_ADMIN', 'MARKETING_HEAD', 'MARKETING_EXECUTIVE'])} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AppShell>
}
