import { Card } from '../ui/Card'
import { activityData } from '../../features/dashboard/mockData'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export function ActivityChart() {
  return (
    <Card className="chart-card">
      <div className="card-heading"><div><p className="eyebrow">Field activity</p><h2>Visits this week</h2></div><span className="chart-legend"><i /> Visits <i className="legend-muted" /> Completed</span></div>
      <div className="activity-chart" role="img" aria-label="Weekly visit activity preview">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={activityData} margin={{ top: 10, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid stroke="#e6e6e3" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="day" tick={{ fill: '#858585', fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 32]} tick={{ fill: '#858585', fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ border: '1px solid #e6e6e3', borderRadius: 6, fontSize: 11 }} />
            <Line type="monotone" dataKey="visits" stroke="#aaaaaa" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="completed" stroke="#202020" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
