import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { PageHeader } from '../../components/ui/PageHeader'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../auth/AuthContext'

type Option = { _id: string; name?: string; organisationName?: string; category?: string; designation?: string }
type Location = { latitude?: number; longitude?: number; recordedAt?: string; locationStatus?: string; verificationStatus?: string; distanceFromClient?: number }
type Visit = { _id: string; client: Option & { address?: string }; assignedTo: Option; marketingHead?: { name?: string }; plannedDate: string; status: string; checkIn?: Location; checkOut?: Location; remarks?: string; followUpDate?: string }
type ReportResponse = { items: Visit[]; page: number; pages: number; total: number }
const presets = [['today', 'Today'], ['this_week', 'This week'], ['this_month', 'This month'], ['last_month', 'Last month'], ['custom', 'Custom range']] as const
const statuses = ['', 'ASSIGNED', 'COMPLETED', 'CANCELLED']

function timeText(value?: string) { return value ? new Date(value).toLocaleString() : '—' }
function locationText(value?: Location) {
  if (!value || value.locationStatus === 'LOCATION_UNAVAILABLE') return '—'
  if (value.latitude === undefined || value.longitude === undefined) return '—'
  const dist = typeof value.distanceFromClient === 'number' ? ` (${value.distanceFromClient}m)` : ''
  const status = value.verificationStatus ? ` · ${value.verificationStatus}` : ''
  return `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}${dist}${status}`
}

export function ReportsPage() {
  const { user } = useAuth()
  const [segment, setSegment] = useState<'client' | 'staff'>('client')
  const [clientSearch, setClientSearch] = useState('')
  const [staffSearch, setStaffSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [headId, setHeadId] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [preset, setPreset] = useState('this_month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'plannedDate' | 'clientName' | 'executiveName'>('plannedDate')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [exporting, setExporting] = useState('')
  const [exportError, setExportError] = useState('')
  const canFilterHeads = user?.role === 'SUPER_ADMIN'
  const canFilterStaff = user?.role === 'SUPER_ADMIN' || user?.role === 'MARKETING_HEAD'
  const clients = useQuery({ queryKey: ['report-options', 'clients'], queryFn: () => apiFetch<{ items: Option[] }>('/clients?limit=100') })
  const staff = useQuery({ queryKey: ['report-options', 'staff', user?.role], enabled: canFilterStaff, queryFn: () => apiFetch<Option[]>('/users?role=MARKETING_EXECUTIVE&activeOnly=true') })
  const heads = useQuery({ queryKey: ['report-options', 'heads'], enabled: canFilterHeads, queryFn: () => apiFetch<Option[]>('/users?role=MARKETING_HEAD&activeOnly=true') })
  const categoriesQuery = useQuery({ queryKey: ['report-options', 'categories'], queryFn: () => apiFetch<Array<{ _id: string; name: string }>>('/categories') })
  const params = new URLSearchParams({ preset, page: String(page), limit: '20', sort, order })
  if (clientId) params.set('clientId', clientId)
  if (staffId) params.set('staffId', staffId)
  if (headId) params.set('headId', headId)
  if (category) params.set('category', category)
  if (status) params.set('status', status)
  if (preset === 'custom' && startDate && endDate) { params.set('startDate', startDate); params.set('endDate', endDate) }
  const report = useQuery({ queryKey: ['report', segment, params.toString()], enabled: preset !== 'custom' || Boolean(startDate && endDate), queryFn: () => apiFetch<ReportResponse>(`/reports/${segment === 'staff' ? 'staff/records' : 'client'}?${params.toString()}`) })
  const clientOptions = useMemo(() => (clients.data?.items ?? []).filter((item) => String(item.organisationName).toLowerCase().includes(clientSearch.toLowerCase())), [clients.data, clientSearch])
  const staffOptions = useMemo(() => (staff.data ?? []).filter((item) => String(item.name).toLowerCase().includes(staffSearch.toLowerCase())), [staff.data, staffSearch])
  const categories = useMemo(() => {
    const fromMaster = (categoriesQuery.data ?? []).map((item) => item.name).filter(Boolean) as string[]
    if (fromMaster.length > 0) return fromMaster
    return [...new Set((clients.data?.items ?? []).map((item) => item.category).filter(Boolean))] as string[]
  }, [categoriesQuery.data, clients.data])
  const reset = () => { setPreset('this_month'); setStartDate(''); setEndDate(''); setStatus(''); setCategory(''); setClientId(''); setStaffId(''); setHeadId(''); setClientSearch(''); setStaffSearch(''); setPage(1) }
  const changeSort = (next: typeof sort) => { setOrder(sort === next && order === 'desc' ? 'asc' : 'desc'); setSort(next); setPage(1) }
  async function download(format: 'csv' | 'xlsx' | 'pdf') {
    setExporting(format); setExportError('')
    try {
      const exportParams = new URLSearchParams(params); exportParams.delete('page'); exportParams.delete('limit'); exportParams.set('format', format); exportParams.set('view', segment)
      const response = await fetch(`/api/reports/export?${exportParams.toString()}`, { credentials: 'include' })
      if (!response.ok) throw new Error('Export could not be generated.')
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${segment}-visit-report.${format}`; link.click(); URL.revokeObjectURL(url)
    } catch (error) { setExportError(error instanceof Error ? error.message : 'Export failed.') } finally { setExporting('') }
  }
  return <div className="page">
    <PageHeader eyebrow="Operational reporting" title="Reports" description="Review permitted client and staff visit history from persisted CRM records." />
    <div className="report-tabs" role="tablist"><button className={segment === 'client' ? 'report-tab active' : 'report-tab'} onClick={() => { setSegment('client'); setPage(1) }}>Client Wise</button><button className={segment === 'staff' ? 'report-tab active' : 'report-tab'} onClick={() => { setSegment('staff'); setPage(1) }}>Staff Wise</button></div>
    <Card><div className="report-filter advanced-report-filter">
      <label>Date range<select value={preset} onChange={(event) => { setPreset(event.target.value); setPage(1) }}>{presets.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      {preset === 'custom' && <><label>From<input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setPage(1) }} /></label><label>To<input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setPage(1) }} /></label></>}
      <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>{statuses.map((item) => <option value={item} key={item}>{item || 'All statuses'}</option>)}</select></label>
      <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}><option value="">All categories</option>{categories.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      {canFilterHeads && <label>Marketing Head<select value={headId} onChange={(event) => { setHeadId(event.target.value); setPage(1) }}><option value="">All heads</option>{heads.data?.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label>}
      <label>{segment === 'client' ? 'Select Client' : 'Select Executive / Staff'}<div className="search report-search"><Search size={15} /><input value={segment === 'client' ? clientSearch : staffSearch} onChange={(event) => { const value = event.target.value; if (segment === 'client') { setClientSearch(value); setClientId(clientOptions.find((item) => item.organisationName === value)?._id ?? '') } else { setStaffSearch(value); setStaffId(staffOptions.find((item) => item.name === value)?._id ?? '') }; setPage(1) }} placeholder="Search and select..." list={segment === 'client' ? 'report-clients' : 'report-staff'} /><datalist id="report-clients">{clientOptions.map((item) => <option value={item.organisationName} key={item._id} />)}</datalist><datalist id="report-staff">{staffOptions.map((item) => <option value={item.name} key={item._id} />)}</datalist></div></label>
      <button className="button button-ghost button-sm" onClick={reset}>Reset</button>
    </div><div className="report-export-actions"><button className="button button-secondary button-sm" disabled={Boolean(exporting)} onClick={() => void download('csv')}><Download size={14} />{exporting === 'csv' ? 'Exporting…' : 'CSV'}</button><button className="button button-secondary button-sm" disabled={Boolean(exporting)} onClick={() => void download('xlsx')}>{exporting === 'xlsx' ? 'Exporting…' : 'XLSX'}</button><button className="button button-secondary button-sm" disabled={Boolean(exporting)} onClick={() => void download('pdf')}>{exporting === 'pdf' ? 'Exporting…' : 'PDF'}</button></div>{exportError && <p className="form-error">{exportError}</p>}</Card>
    <Card>{report.isLoading ? <LoadingState /> : report.isError ? <ErrorState description={report.error instanceof Error ? report.error.message : 'The report could not be loaded.'} /> : <ReportTable segment={segment} visits={report.data?.items ?? []} sort={sort} order={order} onSort={changeSort} />}{report.data && <div className="pagination"><button className="button button-secondary button-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {report.data.pages || 1}</span><button className="button button-secondary button-sm" disabled={page >= report.data.pages} onClick={() => setPage(page + 1)}>Next</button></div>}</Card>
  </div>
}

function ReportTable({ segment, visits, sort, order, onSort }: { segment: 'client' | 'staff'; visits: Visit[]; sort: string; order: string; onSort: (sort: 'plannedDate' | 'clientName' | 'executiveName') => void }) {
  const sortable = (label: string, value: 'plannedDate' | 'clientName' | 'executiveName') => <button className="table-sort" onClick={() => onSort(value)}>{label}{sort === value && (order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button>
  if (!visits.length) return <EmptyState title="No visits found" description="No records match the selected filters." />
  return <div className="report-table-scroll"><table className="report-table"><thead><tr>{segment === 'client' ? <th>Client Name</th> : <th>{sortable('Executive Name', 'executiveName')}</th>} {segment === 'staff' && <th>{sortable('Client Name', 'clientName')}</th>}<th>{sortable('Visit Date', 'plannedDate')}</th><th>Check-in Time</th><th>Check-out Time</th><th>Coordinates</th><th>Location</th>{segment === 'client' && <th>{sortable('Executive Name', 'executiveName')}</th>}{segment === 'staff' && <th>Marketing Head</th>}<th>Remarks</th><th>Follow-up Date</th></tr></thead><tbody>{visits.map((visit) => <tr key={visit._id}><td>{segment === 'client' ? visit.client.organisationName : visit.assignedTo.name}</td>{segment === 'staff' && <td>{visit.client.organisationName}</td>}<td>{new Date(visit.plannedDate).toLocaleDateString()} <StatusBadge status={visit.status} /></td><td>{timeText(visit.checkIn?.recordedAt)}</td><td>{timeText(visit.checkOut?.recordedAt)}</td><td><span className="report-coordinates">In: {locationText(visit.checkIn)}<br />Out: {locationText(visit.checkOut)}</span></td><td>{visit.client.address ?? '—'}</td>{segment === 'client' && <td>{visit.assignedTo.name}</td>}{segment === 'staff' && <td>{visit.marketingHead?.name ?? '—'}</td>}<td>{visit.remarks ?? '—'}</td><td>{visit.followUpDate ? new Date(visit.followUpDate).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div>
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status === 'COMPLETED' ? 'badge-success' : status === 'CANCELLED' ? 'badge-danger' : 'badge-neutral'}`}>{status}</span>
}
