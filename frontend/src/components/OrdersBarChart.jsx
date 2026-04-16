import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const ordersData = [
  { day: 'Mon', orders: 96 },
  { day: 'Tue', orders: 112 },
  { day: 'Wed', orders: 104 },
  { day: 'Thu', orders: 126 },
  { day: 'Fri', orders: 138 },
  { day: 'Sat', orders: 132 },
  { day: 'Sun', orders: 149 },
]

const barColor = 'rgba(15, 98, 254, 0.82)'
const barHoverColor = 'rgba(15, 98, 254, 1)'

export default function OrdersBarChart() {
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={ordersData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(208, 215, 222, 0.45)" vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={44} />
          <Tooltip
            formatter={(value) => [value, 'Orders']}
            labelFormatter={(label) => `${label}`}
            cursor={{ fill: 'rgba(15, 98, 254, 0.08)' }}
            contentStyle={{
              borderRadius: 10,
              border: '1px solid rgba(208, 215, 222, 0.8)',
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            }}
          />
          <Bar
            dataKey="orders"
            radius={[8, 8, 0, 0]}
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
            activeBar={{ fill: barHoverColor }}
          >
            {ordersData.map((entry) => (
              <Cell key={`order-cell-${entry.day}`} fill={barColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
