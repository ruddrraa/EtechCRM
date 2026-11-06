import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { ModulePage } from '../features/module/ModulePage'
import type { Role } from '../types'

export function App() {
  const [role, setRole] = useState<Role>('SUPER_ADMIN')
  return <AppShell role={role} onRoleChange={setRole}><Routes>
    <Route path="/" element={<DashboardPage role={role} />} />
    <Route path="/clients" element={<ModulePage module="clients" />} />
    <Route path="/visits" element={<ModulePage module="visits" />} />
    <Route path="/staff" element={<ModulePage module="staff" />} />
    <Route path="/reports" element={<ModulePage module="reports" />} />
    <Route path="/audit-logs" element={<ModulePage module="audit-logs" />} />
    <Route path="/settings" element={<ModulePage module="settings" />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AppShell>
}
