import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const revenueData = [
  { day: 'Mon', revenue: 24000 },
  { day: 'Tue', revenue: 26800 },
  { day: 'Wed', revenue: 25200 },
  { day: 'Thu', revenue: 29600 },
  { day: 'Fri', revenue: 33400 },
  { day: 'Sat', revenue: 31200 },
  { day: 'Sun', revenue: 35800 },
]

function formatRevenue(value) {
  return `Rs. ${Number(value || 0).toLocaleString('en-IN')}`
}

export default function RevenueChart() {
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={revenueData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(15, 98, 254, 0.38)" />
              <stop offset="100%" stopColor="rgba(15, 98, 254, 0.05)" />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="rgba(208, 215, 222, 0.55)" vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `Rs. ${Math.round(Number(value || 0) / 1000)}k`}
            width={56}
          />
          <Tooltip
            formatter={(value) => [formatRevenue(value), 'Revenue']}
            labelFormatter={(label) => `${label}`}
            contentStyle={{
              borderRadius: 10,
              border: '1px solid rgba(208, 215, 222, 0.8)',
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            }}
          />

          <Area
            type="monotone"
            dataKey="revenue"
            stroke="none"
            fill="url(#revenueFill)"
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
          />
          <Line
            type="monotone"
            dataKey="revenue"
            stroke="rgba(15, 98, 254, 0.95)"
            strokeWidth={3}
            dot={{ r: 3, fill: '#0f62fe', stroke: '#fff', strokeWidth: 1.5 }}
            activeDot={{ r: 5, fill: '#0f62fe', stroke: '#fff', strokeWidth: 2 }}
            isAnimationActive
            animationDuration={1100}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
