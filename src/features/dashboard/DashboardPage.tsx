import { ArrowUpRight, CalendarDays, CheckCircle2, Clock3, MoreHorizontal, UsersRound } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { PageHeader } from '../../components/ui/PageHeader'
import { ActivityChart } from '../../components/charts/ActivityChart'
import { roleCopy } from './mockData'
import type { Role } from '../../types'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { LoadingState, ErrorState } from '../../components/ui/States'
import { roleMetricLabels } from './mockData'

export function DashboardPage({ role, userName }: { role: Role; userName: string }) {
  const copy = roleCopy[role]
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => apiFetch<{ metrics: { totalClients: number; activeStaff: number; assignedVisits: number; completedVisits: number }; upcomingVisits: Array<{ _id: string; plannedDate: string; status: string; client: { organisationName: string }; assignedTo: { name: string } }>; activity: Array<{ _id: { day: number }; visits: number; completed: number }> }>('/dashboard') })
  if (dashboard.isLoading) return <LoadingState />
  if (dashboard.isError || !dashboard.data) return <ErrorState description={dashboard.error instanceof Error ? dashboard.error.message : 'Dashboard data could not be loaded.'} />
  const metrics = role === 'MARKETING_EXECUTIVE' ? [dashboard.data.metrics.assignedVisits, dashboard.data.metrics.assignedVisits, dashboard.data.metrics.assignedVisits, dashboard.data.metrics.completedVisits] : [dashboard.data.metrics.totalClients, dashboard.data.metrics.activeStaff, dashboard.data.metrics.assignedVisits, dashboard.data.metrics.completedVisits]
  const activity = dashboard.data.activity.map((item) => ({ day: String(item._id.day), visits: item.visits, completed: item.completed }))
  return <div className="page"><div className="preview-banner">Authenticated workspace <span>Live data loaded from the API for {userName}.</span></div><PageHeader eyebrow={copy.eyebrow} title={`Good morning, ${userName}`} description={copy.description} /><div className="metric-grid">{roleMetricLabels[role].map((label, index) => { const MetricIcon = [UsersRound, CalendarDays, Clock3, CheckCircle2][index]; return <Card key={label} className="metric-card"><div className="metric-icon"><MetricIcon size={17} /></div><span>{label}</span><strong>{metrics[index]}</strong><small><ArrowUpRight size={13} /> Live</small></Card> })}</div><div className="dashboard-grid"><ActivityChart data={activity} /><Card><div className="card-heading"><div><p className="eyebrow">Schedule</p><h2>Upcoming visits</h2></div><button className="more-button" aria-label="More upcoming visit options"><MoreHorizontal size={18} /></button></div><div className="visit-list">{dashboard.data.upcomingVisits.map((visit) => <div className="visit-row" key={visit._id}><div className="visit-date"><CalendarDays size={16} /><span><b>{new Date(visit.plannedDate).toLocaleDateString()}</b><em>{new Date(visit.plannedDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</em></span></div><div><strong>{visit.client.organisationName}</strong><small>{visit.assignedTo.name}</small></div><Badge tone={visit.status === 'CHECKED_IN' ? 'warning' : 'success'}>{visit.status}</Badge></div>)}</div><button className="text-button">View all visits <ArrowUpRight size={15} /></button></Card></div></div>
}
