import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { PageHeader } from '../../components/ui/PageHeader'
import { apiFetch } from '../../lib/api'

type Client = { _id: string; organisationName: string; address: string }
type Staff = { _id: string; name: string; role: string; designation?: string }
type Location = { latitude?: number; longitude?: number; recordedAt?: string; locationStatus?: string }
type ReportVisit = { _id: string; client: Client; assignedTo: Staff; marketingHead?: { name?: string }; marketingHeadName?: string; plannedDate: string; status: string; checkIn?: Location; checkOut?: Location; remarks?: string; followUpDate?: string }
type ReportResponse = { items: ReportVisit[]; page: number; pages: number; total: number }

function locationText(location?: Location) {
  if (!location) return '—'
  if (location.locationStatus === 'LOCATION_UNAVAILABLE') return 'Location unavailable'
  if (location.latitude === undefined || location.longitude === undefined) return '—'
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
}

function timeText(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

export function ReportsPage() {
  const [segment, setSegment] = useState<'client' | 'staff'>('client')
  const [clientSearch, setClientSearch] = useState('')
  const [staffSearch, setStaffSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'plannedDate' | 'clientName' | 'executiveName'>('plannedDate')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const clients = useQuery({ queryKey: ['report-options', 'clients'], queryFn: () => apiFetch<{ items: Client[] }>('/clients?limit=100') })
  const staff = useQuery({ queryKey: ['report-options', 'staff'], queryFn: () => apiFetch<Staff[]>('/users?role=MARKETING_EXECUTIVE') })
  const report = useQuery({
    queryKey: ['report', segment, clientId, staffId, page, sort, order],
    queryFn: () => apiFetch<ReportResponse>(`/reports/${segment === 'staff' ? 'staff/records' : 'client'}?page=${page}&limit=20&sort=${sort}&order=${order}${segment === 'client' && clientId ? `&clientId=${clientId}` : ''}${segment === 'staff' && staffId ? `&staffId=${staffId}` : ''}`),
  })
  const clientOptions = useMemo(() => (clients.data?.items ?? []).filter((item) => item.organisationName.toLowerCase().includes(clientSearch.toLowerCase())), [clients.data, clientSearch])
  const staffOptions = useMemo(() => (staff.data ?? []).filter((item) => item.name.toLowerCase().includes(staffSearch.toLowerCase())), [staff.data, staffSearch])
  const selectSegment = (next: 'client' | 'staff') => {
    setSegment(next)
    setPage(1)
    setClientId('')
    setStaffId('')
  }
  const changeSort = (next: typeof sort) => {
    if (sort === next) setOrder(order === 'asc' ? 'desc' : 'asc')
    else { setSort(next); setOrder('desc') }
    setPage(1)
  }
  return <div className="page">
    <PageHeader eyebrow="Operational reporting" title="Reports" description="Review permitted client and staff visit history from persisted CRM records." />
    <div className="report-tabs" role="tablist">
      <button className={segment === 'client' ? 'report-tab active' : 'report-tab'} onClick={() => selectSegment('client')} role="tab" aria-selected={segment === 'client'}>Client Wise</button>
      <button className={segment === 'staff' ? 'report-tab active' : 'report-tab'} onClick={() => selectSegment('staff')} role="tab" aria-selected={segment === 'staff'}>Staff Wise</button>
    </div>
    <Card>
      <div className="report-filter">
        <label>{segment === 'client' ? 'Select Client' : 'Select Executive / Staff'}
          <div className="search report-search"><Search size={15} /><input value={segment === 'client' ? clientSearch : staffSearch} onChange={(event) => { const value = event.target.value; const options = segment === 'client' ? clientOptions : staffOptions; const match = options.find((item) => (segment === 'client' ? (item as Client).organisationName : (item as Staff).name) === value); setPage(1); if (segment === 'client') { setClientSearch(value); setClientId(match?._id ?? '') } else { setStaffSearch(value); setStaffId(match?._id ?? '') } }} placeholder="Search and select..." list={segment === 'client' ? 'report-clients' : 'report-staff'} /><datalist id="report-clients">{clientOptions.map((item) => <option value={item.organisationName} key={item._id} />)}</datalist><datalist id="report-staff">{staffOptions.map((item) => <option value={item.name} key={item._id} />)}</datalist></div>
        </label>
        <select aria-label={segment === 'client' ? 'Select Client' : 'Select Executive / Staff'} value={segment === 'client' ? clientId : staffId} onChange={(event) => { setPage(1); if (segment === 'client') { setClientId(event.target.value); setClientSearch('') } else { setStaffId(event.target.value); setStaffSearch('') } }}>
          <option value="">{segment === 'client' ? 'All Clients' : 'All Staff'}</option>
          {(segment === 'client' ? clientOptions : staffOptions).map((item) => <option value={item._id} key={item._id}>{segment === 'client' ? (item as Client).organisationName : (item as Staff).name}</option>)}
        </select>
      </div>
      {report.isLoading ? <LoadingState /> : report.isError ? <ErrorState description={report.error instanceof Error ? report.error.message : 'The report could not be loaded.'} /> : <ReportTable segment={segment} visits={report.data?.items ?? []} sort={sort} order={order} onSort={changeSort} />}
      {report.data && report.data.pages > 1 && <div className="pagination"><button className="button button-secondary button-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {report.data.pages}</span><button className="button button-secondary button-sm" disabled={page >= report.data.pages} onClick={() => setPage(page + 1)}>Next</button></div>}
    </Card>
  </div>
}

function ReportTable({ segment, visits, sort, order, onSort }: { segment: 'client' | 'staff'; visits: ReportVisit[]; sort: string; order: string; onSort: (sort: 'plannedDate' | 'clientName' | 'executiveName') => void }) {
  const sortable = (label: string, value: 'plannedDate' | 'clientName' | 'executiveName') => <button className="table-sort" onClick={() => onSort(value)}>{label}{sort === value && (order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button>
  if (!visits.length) return <EmptyState title="No visits found" description="This record has no matching visit history." />
  return <div className="report-table-scroll"><table className="report-table"><thead><tr>{segment === 'client' ? <th>Client Name</th> : <th>{sortable('Executive Name', 'executiveName')}</th>}{segment === 'staff' && <th>{sortable('Client Name', 'clientName')}</th>}<th>Marketing Head</th><th>{sortable('Visit Date', 'plannedDate')}</th><th>Check-in Time</th><th>Check-out Time</th><th>Coordinates</th><th>Location</th>{segment === 'client' && <th>{sortable('Executive Name', 'executiveName')}</th>}<th>Remarks</th><th>Follow-up Date</th></tr></thead><tbody>{visits.map((visit) => <tr key={visit._id}><td>{segment === 'client' ? visit.client?.organisationName ?? '—' : visit.assignedTo?.name ?? '—'}</td>{segment === 'staff' && <td>{visit.client?.organisationName ?? '—'}</td>}<td>{visit.marketingHeadName ?? visit.marketingHead?.name ?? '—'}</td><td>{new Date(visit.plannedDate).toLocaleDateString()} <BadgeStatus status={visit.status} /></td><td>{timeText(visit.checkIn?.recordedAt)}</td><td>{timeText(visit.checkOut?.recordedAt)}</td><td><span className="report-coordinates">In: {locationText(visit.checkIn)}<br />Out: {locationText(visit.checkOut)}</span></td><td>{visit.client?.address ?? '—'}</td>{segment === 'client' && <td>{visit.assignedTo?.name ?? '—'}</td>}<td className="report-remarks" title={visit.remarks || undefined}>{visit.remarks || '—'}</td><td>{visit.followUpDate ? new Date(visit.followUpDate).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div>
}

function BadgeStatus({ status }: { status: string }) {
  return <span className={`report-status report-status-${status.toLowerCase()}`}>{status}</span>
}
