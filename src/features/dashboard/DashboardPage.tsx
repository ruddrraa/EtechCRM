import { ArrowUpRight, CalendarDays, CheckCircle2, Clock3, UsersRound, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { PageHeader } from '../../components/ui/PageHeader'
import { ActivityChart } from '../../components/charts/ActivityChart'
import { LoadingState, ErrorState } from '../../components/ui/States'
import { apiFetch } from '../../lib/api'
import { formatIstShortDate, formatIstTime } from '../../lib/timezone'
import type { Role } from '../../types'
import { roleCopy } from './mockData'

type DashboardData = {
  range: { preset: string; from: string; to: string }
  metrics: {
    totalClients: number; activeStaff: number; totalHeads: number; totalExecutives: number
    assignedVisits: number; completedVisits: number; pendingVisits: number; cancelledVisits: number
    pendingFollowUps: number; overdueFollowUps: number; completionRate: number
  }
  activity: Array<{ day: string; visits: number; completed: number }>
  executivePerformance: Array<{ name: string; visits: number; completed: number; completionRate: number }>
  headPerformance: Array<{ name: string; visits: number; completed: number; completionRate: number }>
  topClients: Array<{ name: string; visits: number; completed: number }>
  upcomingVisits: Array<{ _id: string; plannedDate: string; status: string; client?: { organisationName: string }; assignedTo?: { name: string } }>
  recentCompleted: Array<{ _id: string; plannedDate: string; client?: { organisationName: string } }>
}

const datePresets = [
  ['today', 'Today'],
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['custom', 'Custom range'],
] as const

function formatDate(value: string) {
  return formatIstShortDate(value)
}

export function DashboardPage({ role, userName }: { role: Role; userName: string }) {
  const copy = roleCopy[role]
  const [preset, setPreset] = useState('this_month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const params = new URLSearchParams({ preset })
  if (preset === 'custom' && startDate && endDate) {
    params.set('startDate', startDate)
    params.set('endDate', endDate)
  }
  const dashboard = useQuery({
    queryKey: ['dashboard', preset, startDate, endDate],
    queryFn: () => apiFetch<DashboardData>(`/dashboard?${params.toString()}`),
    enabled: preset !== 'custom' || Boolean(startDate && endDate),
  })

  if (dashboard.isLoading) return <LoadingState />
  if (dashboard.isError || !dashboard.data) return <ErrorState description={dashboard.error instanceof Error ? dashboard.error.message : 'Dashboard data could not be loaded.'} />
  const { metrics } = dashboard.data
  const metricItems: Array<[string, string | number, LucideIcon]> = role === 'SUPER_ADMIN'
    ? [['Total clients', metrics.totalClients, UsersRound], ['Marketing heads', metrics.totalHeads, UsersRound], ['Assigned visits', metrics.assignedVisits, CalendarDays], ['Completed visits', metrics.completedVisits, CheckCircle2], ['Pending visits', metrics.pendingVisits, Clock3], ['Overdue follow-ups', metrics.overdueFollowUps, Clock3]]
    : role === 'MARKETING_HEAD'
      ? [['Team executives', metrics.totalExecutives, UsersRound], ['Team visits', metrics.assignedVisits, CalendarDays], ['Completed visits', metrics.completedVisits, CheckCircle2], ['Pending visits', metrics.pendingVisits, Clock3], ['Upcoming follow-ups', metrics.pendingFollowUps, CalendarDays], ['Overdue follow-ups', metrics.overdueFollowUps, Clock3]]
      : [['My assigned visits', metrics.assignedVisits, CalendarDays], ['Completed visits', metrics.completedVisits, CheckCircle2], ['Pending visits', metrics.pendingVisits, Clock3], ['Completion rate', `${metrics.completionRate}%`, CheckCircle2], ['Upcoming follow-ups', metrics.pendingFollowUps, CalendarDays], ['Overdue follow-ups', metrics.overdueFollowUps, Clock3]]

  const performance = role === 'SUPER_ADMIN' ? dashboard.data.headPerformance : dashboard.data.executivePerformance
  const performanceTitle = role === 'SUPER_ADMIN' ? 'Marketing Head performance' : role === 'MARKETING_HEAD' ? 'Executive performance' : 'My activity'
  return <div className="page">
    <div className="preview-banner">
      <span>Live analytics</span>
      <span>{formatDate(dashboard.data.range.from)} – {formatDate(dashboard.data.range.to)} · Server-side role-scoped data</span>
    </div>
    <PageHeader eyebrow={copy.eyebrow} title={`Good morning, ${userName}`} description={copy.description} />
    <div className="toolbar-actions">
      <select className="filter-select" value={preset} onChange={(event) => setPreset(event.target.value)} aria-label="Dashboard date range">
        {datePresets.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
      {preset === 'custom' && <><input className="filter-input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-label="Dashboard start date" /><input className="filter-input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} aria-label="Dashboard end date" /></>}
    </div>
    <div className="metric-grid">
      {metricItems.map(([label, value, Icon]) => <Card key={String(label)} className="metric-card"><div className="metric-icon"><Icon size={17} /></div><span>{label}</span><strong>{value}</strong><small><ArrowUpRight size={13} /> Live</small></Card>)}
    </div>
    <div className="dashboard-grid">
      <ActivityChart data={dashboard.data.activity} />
      <Card><div className="card-heading"><div><p className="eyebrow">Visit mix</p><h2>{performanceTitle}</h2></div></div><div className="staff-list">{performance.length === 0 ? <p className="empty-copy">No performance data in this range.</p> : performance.map((item) => <div className="staff-row" key={item.name}><span><strong>{item.name}</strong><small>{item.completed} completed of {item.visits} visits</small></span><b className="table-number">{Math.round(item.completionRate)}%</b></div>)}</div></Card>
    </div>
    <div className="dashboard-grid">
      <Card><div className="card-heading"><div><p className="eyebrow">Coverage</p><h2>Top visited clients</h2></div></div><div className="activity-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={dashboard.data.topClients} layout="vertical" margin={{ left: 8, right: 12 }}><CartesianGrid stroke="#e6e6e3" horizontal={false} /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={100} tick={{ fill: '#555', fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="visits" fill="#202020" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div></Card>
      <Card><div className="card-heading"><div><p className="eyebrow">Schedule</p><h2>Upcoming visits</h2></div></div><div className="visit-list">{dashboard.data.upcomingVisits.length === 0 ? <p className="empty-copy">No upcoming visits in this range.</p> : dashboard.data.upcomingVisits.map((visit) => <div className="visit-row" key={visit._id}><div className="visit-date"><CalendarDays size={16} /><span><b>{formatDate(visit.plannedDate)}</b><em>{formatIstTime(visit.plannedDate)}</em></span></div><div><strong>{visit.client?.organisationName ?? 'Unknown client'}</strong><small>{visit.assignedTo?.name ?? 'Assigned executive'}</small></div><Badge tone={visit.status === 'CHECKED_IN' ? 'warning' : 'success'}>{visit.status}</Badge></div>)}</div></Card>
    </div>
    <Card><div className="card-heading"><div><p className="eyebrow">History</p><h2>Recent completed visits</h2></div></div><div className="activity-list">{dashboard.data.recentCompleted.length === 0 ? <p className="empty-copy">No completed visits in this range.</p> : dashboard.data.recentCompleted.map((visit) => <div className="activity-row" key={visit._id}><span className="activity-dot dot-1" /><span><strong>{visit.client?.organisationName ?? 'Unknown client'}</strong><small>{formatDate(visit.plannedDate)}</small></span><Badge tone="success">COMPLETED</Badge></div>)}</div></Card>
  </div>
}
