import { useEffect, useMemo, useState } from 'react'
import { Filter, MoreHorizontal, Search } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { PageHeader } from '../../components/ui/PageHeader'
import { Modal } from '../../components/ui/Modal'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../auth/AuthContext'
import { useSearchParams } from 'react-router-dom'
import type { AuthUser, Role } from '../../types'

type RecordValue = Record<string, unknown>
type Client = { _id: string; organisationName: string; category: string; address: string; contactPerson?: string; phone?: string; email?: string; notes?: string; isActive: boolean; createdBy?: { name?: string }; createdByName?: string }
type User = { _id: string; name: string; email: string; phone?: string; role: Role; designation?: string; reportingTo?: { _id: string; name: string } | string | null; isActive: boolean; isArchived?: boolean }
type Visit = { _id: string; client: Client; assignedTo: User; assignedBy?: User; plannedDate: string; status: string; source: string; arrivedAt?: string; remarks?: string; followUpDate?: string; checkIn?: RecordValue; checkOut?: RecordValue }

const pageContent: Record<string, { title: string; description: string; action?: string; columns: string[] }> = {
  clients: { title: 'Client directory', description: 'Manage the organisations and relationships that matter most.', action: 'Add client', columns: ['Organisation', 'Category', 'Primary contact', 'Added by', 'Status'] },
  staff: { title: 'Staff directory', description: 'Manage access and field team availability.', action: 'Invite staff', columns: ['Name', 'Role', 'Email', 'Status'] },
  visits: { title: 'Visit assignments', description: 'Plan, track and review field activity in one place.', action: 'Assign visit', columns: ['Client', 'Executive', 'Planned date', 'Status', 'Location'] },
  reports: { title: 'Reports', description: 'Review client-wise and staff-wise activity with useful filters.', columns: ['Report', 'Coverage', 'Completed', 'Total visits'] },
  'audit-logs': { title: 'Audit logs', description: 'A transparent record of important actions across the workspace.', columns: ['Action', 'Actor', 'Affected record', 'Timestamp'] },
  settings: { title: 'Settings', description: 'Manage your permitted profile settings.', columns: [] },
}

function getLocation(): Promise<{ latitude?: number; longitude?: number; locationStatus: 'AVAILABLE' | 'LOCATION_UNAVAILABLE' }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ locationStatus: 'LOCATION_UNAVAILABLE' })
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, locationStatus: 'AVAILABLE' }),
      () => resolve({ locationStatus: 'LOCATION_UNAVAILABLE' }),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  })
}

export function ModulePage({ module }: { module: string }) {
  const { user, updateUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<'client' | 'staff' | 'staffDetail' | 'staffArchive' | 'visit' | 'profile' | 'password' | 'complete' | 'reschedule' | null>(null)
  const [selected, setSelected] = useState<RecordValue | null>(null)
  const [selectedReport, setSelectedReport] = useState<RecordValue | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState(false)
  const content = pageContent[module]
  useEffect(() => {
    if (module === 'settings' && searchParams.get('changePassword') === '1') {
      setDialog('password')
      searchParams.delete('changePassword')
      setSearchParams(searchParams, { replace: true })
    }
  }, [module, searchParams, setSearchParams])
  const live = useQuery({
    queryKey: [module, 'live'],
    enabled: Boolean(content),
    queryFn: async () => {
      if (module === 'clients') return apiFetch<{ items: Client[] }>('/clients')
      if (module === 'visits') return apiFetch<{ items: Visit[] }>('/visits')
      if (module === 'staff') return apiFetch<User[]>('/users')
      if (module === 'reports') return apiFetch<{ clients: RecordValue[]; staff: RecordValue[] }>('/reports/overview')
      if (module === 'audit-logs') return apiFetch<{ items: RecordValue[] }>('/audit-logs')
      return null
    },
  })
  const profileQuery = useQuery({
    queryKey: ['profile', 'me'],
    enabled: module === 'settings',
    queryFn: () => apiFetch<AuthUser>('/users/me'),
  })
  const clients = useQuery({ queryKey: ['clients', 'options'], enabled: dialog === 'visit', queryFn: () => apiFetch<{ items: Client[] }>('/clients') })
  const staff = useQuery({ queryKey: ['staff', 'options', 'active'], enabled: dialog === 'visit' && user?.role !== 'MARKETING_EXECUTIVE', queryFn: () => apiFetch<User[]>('/users?role=MARKETING_EXECUTIVE&activeOnly=true') })
  const heads = useQuery({ queryKey: ['staff', 'heads'], enabled: module === 'staff' && user?.role === 'SUPER_ADMIN', queryFn: () => apiFetch<User[]>('/users?role=MARKETING_HEAD&activeOnly=true') })
  const reportDetail = useQuery({
    queryKey: ['report-detail', selectedReport?._id, selectedReport?.organisationName ? 'client' : 'staff'],
    enabled: module === 'reports' && Boolean(selectedReport),
    queryFn: () => apiFetch<Visit[]>(selectedReport?.organisationName ? `/reports/client/${String(selectedReport._id)}` : `/reports/staff/${String(selectedReport?._id)}`),
  })
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [module, 'live'] })
    void queryClient.invalidateQueries({ queryKey: ['clients', 'options'] })
    void queryClient.invalidateQueries({ queryKey: ['staff', 'options'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }
  const mutation = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: RecordValue }) => apiFetch<RecordValue>(path, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: (data, variables) => {
      if (variables.path === '/users/me') updateUser(data as AuthUser)
      if (variables.path === '/users/me') queryClient.setQueryData(['profile', 'me'], data)
      invalidate()
      setDialog(null)
      setSelected(null)
    },
  })
  const raw = live.data
  const records = useMemo<RecordValue[]>(() => Array.isArray(raw) ? raw as RecordValue[] : (raw as { items?: RecordValue[] } | null)?.items ?? [], [raw])
  const rows = useMemo(() => {
    if (module === 'clients') return (records as Client[]).map((item) => [item.organisationName, item.category, item.contactPerson ?? item.email ?? item.phone ?? '—', item.createdByName ?? item.createdBy?.name ?? '—', item.isActive ? 'Active' : 'Inactive'])
    if (module === 'staff') return (records as User[]).map((item) => [item.name, item.role === 'MARKETING_EXECUTIVE' ? 'Marketing Executive' : 'Marketing Head', item.email, item.isActive ? 'Active' : 'Deactivated'])
    if (module === 'visits') return (records as Visit[]).map((item) => [item.client?.organisationName ?? '—', item.assignedTo?.name ?? '—', new Date(item.plannedDate).toLocaleString(), item.status, item.client?.address ?? '—'])
    if (module === 'reports') {
      const reportData = raw as { clients?: RecordValue[]; staff?: RecordValue[] } | null
      return [...(reportData?.clients ?? []).map((item) => [String(item.organisationName ?? '—'), 'Client activity', String(item.completedVisits ?? 0), String(item.totalVisits ?? 0)]), ...(reportData?.staff ?? []).map((item) => [String(item.name ?? '—'), 'Staff activity', String(item.completedVisits ?? 0), String(item.totalVisits ?? 0)])]
    }
    if (module === 'audit-logs') return records.map((item) => [String(item.action), String((item.actor as RecordValue | undefined)?.name ?? '—'), `${String(item.entityType)} ${String(item.entityId)}`, new Date(String(item.timestamp)).toLocaleString()])
    return []
  }, [module, records, raw])
  if (!content) return <ErrorState />
  if (live.isLoading) return <LoadingState />
  if (live.isError) return <ErrorState />

  const actionFor = (record: RecordValue) => {
    if (module === 'clients' && user && (user.role === 'MARKETING_HEAD' || user.role === 'SUPER_ADMIN')) { setSelected(record); setDialog('client') }
    if (module === 'staff' && user && (user.role === 'MARKETING_HEAD' || user.role === 'SUPER_ADMIN')) {
      setSelected(record)
      setDialog('staffDetail')
    }
    if (module === 'visits') { setSelected(record); setDialog(null) }
    if (module === 'reports') setSelectedReport(record)
  }
  const submitClient = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = Object.fromEntries(form.entries()) as RecordValue
    const organisationName = String(body.organisationName ?? '').trim().toLowerCase()
    const duplicate = !selected && (records as Client[]).some((item) => item.organisationName.toLowerCase() === organisationName)
    setDuplicateWarning(duplicate)
    if (duplicate && !window.confirm('An organisation with this name already exists. Continue anyway?')) return
    mutation.mutate({ path: selected ? `/clients/${String(selected._id)}` : '/clients', method: selected ? 'PATCH' : 'POST', body })
  }
  const submitStaff = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = Object.fromEntries(form.entries()) as RecordValue
    mutation.mutate({ path: '/auth/users', method: 'POST', body: { ...body, role: String(body.role), password: String(body.password) } })
  }
  const submitVisit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = Object.fromEntries(form.entries()) as RecordValue
    mutation.mutate({ path: '/visits', method: 'POST', body })
  }
  const candidateVisit = selected as Visit | null
  const validVisit = module === 'visits' && Boolean(candidateVisit?._id && candidateVisit.status && candidateVisit.plannedDate && !Number.isNaN(new Date(candidateVisit.plannedDate).getTime()))
  const visit = validVisit ? candidateVisit : null
  const isExecutive = user?.role === 'MARKETING_EXECUTIVE'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const unassignedExecutives = (records as User[]).filter((item) => item.role === 'MARKETING_EXECUTIVE' && !item.reportingTo)
  return <div className="page"><PageHeader eyebrow="Workspace module" title={content.title} description={content.description} action={content.action} onAction={() => { setSelected(null); setDialog(module === 'clients' ? 'client' : module === 'staff' ? 'staff' : 'visit') }} />
    {module === 'settings' ? profileQuery.isLoading ? <LoadingState /> : profileQuery.isError ? <ErrorState description="Unable to load your profile." /> : <ProfileCard user={profileQuery.data ?? user} onEdit={() => setDialog('profile')} onPassword={() => setDialog('password')} /> : <>
    {module === 'staff' && isSuperAdmin && unassignedExecutives.length > 0 && <Card><div className="section-heading"><div><h2>Unassigned Executives</h2><p>Assign legacy executives to an active Marketing Head before they can receive team assignments.</p></div></div><div className="stack-list">{unassignedExecutives.map((item) => <div className="list-row" key={item._id}><span><strong>{item.name}</strong><small>{item.email}</small></span><select aria-label={`Assign ${item.name}`} defaultValue="" onChange={(event) => { if (event.target.value) mutation.mutate({ path: `/users/${item._id}/reporting`, method: 'PATCH', body: { reportingTo: event.target.value } }) }}><option value="">Select Marketing Head</option>{heads.data?.map((head) => <option value={head._id} key={head._id}>{head.name}{head.designation ? ` · ${head.designation}` : ''}</option>)}</select></div>)}</div></Card>}
    <Card><div className="table-toolbar"><label className="search"><Search size={16} /><input placeholder={`Search ${content.title.toLowerCase()}`} /></label><div className="toolbar-actions"><Button variant="secondary" size="sm"><Filter size={15} /> Filter</Button></div></div>{rows.length ? <div className={`table-wrap ${module === 'reports' ? 'reports-table-wrap' : ''}`}><table><thead><tr>{content.columns.map((column) => <th key={column}>{column}</th>)}<th aria-label="Actions" /></tr></thead><tbody>{rows.map((row, index) => { const record = module === 'reports' ? (index < ((raw as { clients?: RecordValue[] } | null)?.clients?.length ?? 0) ? (raw as { clients: RecordValue[] }).clients[index] : (raw as { staff: RecordValue[] }).staff[index - ((raw as { clients?: RecordValue[] } | null)?.clients?.length ?? 0)]) : records[index] as RecordValue; return <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td data-label={content.columns[cellIndex]} key={`${cell}-${cellIndex}`}>{cellIndex === row.length - 1 && ['Active', 'Deactivated', 'Assigned', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'PLANNED'].includes(cell) ? <Badge tone={cell === 'CHECKED_IN' ? 'warning' : cell === 'Active' || cell === 'Assigned' ? 'success' : 'neutral'}>{cell}</Badge> : cell}</td>)}<td>{(module === 'clients' && !isExecutive) || module === 'staff' || module === 'visits' || module === 'reports' ? <button className="more-button" aria-label={`Actions for ${row[0]}`} onClick={(event) => { event.stopPropagation(); actionFor(record) }}><MoreHorizontal size={17} /></button> : null}</td></tr> })}</tbody></table></div> : <EmptyState />}</Card>
    {selectedReport && <Modal title={`${String(selectedReport.organisationName ?? selectedReport.name)} report`} onClose={() => setSelectedReport(null)}>{reportDetail.isLoading ? <LoadingState /> : reportDetail.isError ? <ErrorState /> : <div className="report-detail-list">{(reportDetail.data ?? []).map((item) => <div className="report-detail-row" key={item._id}><strong>{item.client?.organisationName}</strong><span>{new Date(item.plannedDate).toLocaleString()} · {item.status}</span><span>Arrival: {item.arrivedAt ? new Date(item.arrivedAt).toLocaleString() : '—'}</span><span>Check-in: {formatLocation(item.checkIn)}</span><span>Check-out: {formatLocation(item.checkOut)}</span><span>Remarks: {item.remarks || '—'}</span><span>Follow-up: {item.followUpDate ? new Date(item.followUpDate).toLocaleDateString() : '—'}</span></div>)}</div>}</Modal>}
    {dialog === 'client' && <Modal title={selected ? 'Edit client' : 'Add client'} onClose={() => setDialog(null)}><form className="modal-form" onSubmit={submitClient}><Field name="organisationName" label="Organisation name" defaultValue={String(selected?.organisationName ?? '')} required /><Field name="category" label="Category" defaultValue={String(selected?.category ?? '')} required /><Field name="address" label="Address" defaultValue={String(selected?.address ?? '')} required /><Field name="contactPerson" label="Contact person" defaultValue={String(selected?.contactPerson ?? '')} /><Field name="phone" label="Phone" defaultValue={String(selected?.phone ?? '')} /><Field name="email" label="Email" type="email" defaultValue={String(selected?.email ?? '')} /><Field name="notes" label="Notes" defaultValue={String(selected?.notes ?? '')} />{duplicateWarning && <p className="form-warning" role="status">An organisation with this name already exists. You can continue, but please confirm it is a separate record.</p>}<p className="form-hint">Provide at least one valid contact method.</p><MutationError error={mutation.error} /><ModalActions submitting={mutation.isPending} />{selected && user?.role === 'SUPER_ADMIN' && <Button type="button" variant="danger" onClick={() => mutation.mutate({ path: `/clients/${String(selected._id)}`, method: 'DELETE' })}>Archive client</Button>}</form></Modal>}
    {dialog === 'staff' && <Modal title="Invite staff" onClose={() => setDialog(null)}><form className="modal-form" onSubmit={submitStaff}><Field name="name" label="Full name" required /><Field name="email" label="Email" type="email" required /><Field name="phone" label="Phone" /><Field name="designation" label="Designation" required /><Field name="password" label="Temporary password" type="password" minLength={8} required /><label>Role<select name="role" defaultValue="MARKETING_EXECUTIVE"><option value="MARKETING_EXECUTIVE">Marketing Executive</option>{user?.role === 'SUPER_ADMIN' && <option value="MARKETING_HEAD">Marketing Head</option>}</select></label>{user?.role === 'SUPER_ADMIN' && <label>Reporting To<select name="reportingTo" defaultValue=""><option value="">Select a Marketing Head</option>{heads.data?.map((head) => <option value={head._id} key={head._id}>{head.name}</option>)}</select></label>}<p className="form-hint">Reporting relationships and roles are enforced by the server.</p><MutationError error={mutation.error} /><ModalActions submitting={mutation.isPending} /></form></Modal>}
    {dialog === 'staffDetail' && selected && <Modal title="Staff details" onClose={() => { setDialog(null); setSelected(null) }}><div className="visit-detail"><p><strong>{String(selected.name)}</strong><span>{String(selected.role) === 'MARKETING_EXECUTIVE' ? 'Marketing Executive' : 'Marketing Head'}</span></p><p>{String(selected.email)}</p><p>{String(selected.phone ?? 'No phone number')}</p><Badge>{selected.isActive ? 'Active' : 'Deactivated'}</Badge><div className="modal-actions"><Button variant={selected.isActive ? 'danger' : 'primary'} onClick={(event) => { event.stopPropagation(); const nextStatus = !selected.isActive; if (!window.confirm(nextStatus ? `Activate ${String(selected.name)}?` : `Deactivate ${String(selected.name)}? This will prevent login.`)) return; mutation.mutate({ path: `/users/${String(selected._id)}/status`, method: 'PATCH', body: { isActive: nextStatus } }) }}>{selected.isActive ? 'Deactivate account' : 'Activate account'}</Button>{!selected.isActive && <Button type="button" variant="danger" onClick={(event) => { event.stopPropagation(); setDialog('staffArchive') }}>Delete staff</Button>}</div><MutationError error={mutation.error} /></div></Modal>}
    {dialog === 'staffArchive' && selected && <Modal title="Delete staff account" onClose={() => { setDialog(null); setSelected(null) }}><div className="visit-detail"><p>This archives the account, prevents login and removes it from the active staff directory. Historical visits, reports, clients and audit records will be preserved.</p><div className="modal-actions"><Button variant="secondary" onClick={() => { setDialog('staffDetail') }}>Keep account</Button><Button variant="danger" onClick={() => mutation.mutate({ path: `/users/${String(selected._id)}`, method: 'DELETE' })}>Delete staff</Button></div><MutationError error={mutation.error} /></div></Modal>}
    {dialog === 'visit' && <Modal title={isExecutive ? 'Self-assign visit' : 'Assign visit'} onClose={() => { setDialog(null); setSelected(null) }}><form className="modal-form" onSubmit={submitVisit}><label>Client<select name="clientId" required><option value="">Select a client</option>{clients.data?.items.map((item) => <option value={item._id} key={item._id}>{item.organisationName}</option>)}</select></label>{!isExecutive && <label>Marketing Executive<select name="assignedTo" required><option value="">Select an executive</option>{staff.data?.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label>}<Field name="plannedDate" label="Planned date" type="datetime-local" required /><Field name="instructions" label="Instructions" /><MutationError error={mutation.error} /><ModalActions submitting={mutation.isPending} /></form></Modal>}
    {dialog === 'profile' && <Modal title="Edit profile" onClose={() => setDialog(null)}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget).entries()) as RecordValue; mutation.mutate({ path: '/users/me', method: 'PATCH', body }) }}><Field name="name" label="Name" defaultValue={user?.name} required /><Field name="phone" label="Phone" defaultValue={user?.phone} /><p className="form-hint">Your role is controlled by an administrator and cannot be changed here.</p><ModalActions submitting={mutation.isPending} /></form></Modal>}
    {dialog === 'password' && <Modal title="Change password" onClose={() => setDialog(null)}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget).entries()) as RecordValue; mutation.mutate({ path: '/auth/change-password', method: 'POST', body }) }}><Field name="currentPassword" label="Current password" type="password" minLength={8} required /><Field name="newPassword" label="New password" type="password" minLength={8} required /><MutationError error={mutation.error} /><ModalActions submitting={mutation.isPending} /></form></Modal>}
    {visit && !dialog && <Modal title="Visit actions" onClose={() => setSelected(null)}><div className="visit-detail"><p><strong>{visit.client?.organisationName ?? 'Visit'}</strong><span>{new Date(visit.plannedDate).toLocaleString()}</span></p><p>Status: <Badge>{visit.status}</Badge></p>{visit.arrivedAt && <p>Arrived: {new Date(visit.arrivedAt).toLocaleString()}</p>}{visit.checkIn && <p>Check-in: {new Date(String(visit.checkIn.recordedAt)).toLocaleString()}</p>}{visit.checkOut && <p>Check-out: {new Date(String(visit.checkOut.recordedAt)).toLocaleString()}</p>}{visit.remarks && <p>Remarks: {visit.remarks}</p>}{visit.followUpDate && <p>Follow-up: {new Date(visit.followUpDate).toLocaleDateString()}</p>}<div className="modal-actions">{isExecutive && (visit.status === 'ASSIGNED' || visit.status === 'PLANNED') && <Button onClick={() => mutation.mutate({ path: `/visits/${visit._id}/arrived`, method: 'POST' })}>Mark arrived</Button>}{isExecutive && visit.status === 'ARRIVED' && <Button onClick={async () => mutation.mutate({ path: `/visits/${visit._id}/check-in`, method: 'POST', body: await getLocation() })}>Check in</Button>}{isExecutive && visit.status === 'CHECKED_IN' && <Button onClick={() => setDialog('complete')}>Check out</Button>}{!isExecutive && visit.status !== 'COMPLETED' && visit.status !== 'CANCELLED' && <><Button variant="secondary" onClick={() => setDialog('reschedule')}>Reschedule</Button><Button variant="danger" onClick={() => { const reason = window.prompt('Cancellation reason'); if (reason) mutation.mutate({ path: `/visits/${visit._id}/cancel`, method: 'POST', body: { reason } }) }}>Cancel visit</Button></>}</div></div></Modal>}
    {dialog === 'complete' && visit && <Modal title="Complete visit" onClose={() => setDialog(null)}><form className="modal-form" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutation.mutate({ path: `/visits/${visit._id}/complete`, method: 'POST', body: { remarks: String(form.get('remarks') ?? ''), followUpDate: form.get('followUpDate') || undefined, location: await getLocation() } }) }}><Field name="remarks" label="Meeting remarks" required /><Field name="followUpDate" label="Follow-up date" type="date" /><ModalActions submitting={mutation.isPending} /></form></Modal>}
    {dialog === 'reschedule' && visit && <Modal title="Reschedule visit" onClose={() => setDialog(null)}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const date = new FormData(event.currentTarget).get('plannedDate'); mutation.mutate({ path: `/visits/${visit._id}/reschedule`, method: 'POST', body: { plannedDate: date } }) }}><Field name="plannedDate" label="New planned date" type="datetime-local" required /><ModalActions submitting={mutation.isPending} /></form></Modal>}
    </>}
  </div>
}

function Field({ name, label, type = 'text', defaultValue, required, minLength }: { name: string; label: string; type?: string; defaultValue?: string; required?: boolean; minLength?: number }) {
  return <label>{label}<input name={name} type={type} defaultValue={defaultValue} required={required} minLength={minLength} /></label>
}
function ModalActions({ submitting }: { submitting: boolean }) {
  return <div className="modal-actions"><Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button></div>
}
function formatLocation(location?: RecordValue) {
  if (!location) return '—'
  if (location.locationStatus === 'LOCATION_UNAVAILABLE') return 'Location unavailable'
  return `${String(location.latitude)}, ${String(location.longitude)} · ${location.recordedAt ? new Date(String(location.recordedAt)).toLocaleString() : '—'}`
}
function MutationError({ error }: { error: Error | null }) {
  return error ? <p className="form-error" role="alert">{error.message}</p> : null
}
function ProfileCard({ user, onEdit, onPassword }: { user: { name: string; email: string; phone?: string; avatar?: string; role: string } | null; onEdit: () => void; onPassword: () => void }) {
  return <div className="settings-grid"><Card><p className="eyebrow">Profile</p>{user?.avatar ? <img className="profile-image" src={user.avatar} alt={`${user.name} profile`} /> : null}<h2>{user?.name}</h2><p className="page-description">{user?.email}</p><p className="page-description">{user?.phone || 'No phone number added'}</p><Badge>{user?.role}</Badge><div className="modal-actions"><Button variant="secondary" onClick={onEdit}>Edit profile</Button><Button variant="secondary" onClick={onPassword}>Change password</Button></div></Card></div>
}
