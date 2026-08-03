import { useEffect, useMemo, useState } from 'react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'
import RevenueChart from '../components/RevenueChart'
import { fetchCatalogProducts } from '../utils/catalog'

const palette = ['#0f62fe', '#3a80ff', '#69a1ff', '#9ec0ff', '#d0e2ff']

const defaultMetrics = {
  WEEKLY: { visitors: 0, orders: 0, revenue: 0 },
  MONTHLY: { visitors: 0, orders: 0, revenue: 0 },
  YEARLY: { visitors: 0, orders: 0, revenue: 0 },
}

function toCsv(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  rows.forEach((row) => {
    lines.push(headers.map((key) => JSON.stringify(row[key] ?? '')).join(','))
  })
  return lines.join('\n')
}

export default function AdminAnalyticsPage() {
  const [range, setRange] = useState('MONTHLY')
  const [catalogProducts, setCatalogProducts] = useState([])
  const [metricsByRange, setMetricsByRange] = useState(defaultMetrics)
  const [chartData, setChartData] = useState({ revenue: [] })
  const [analyticsLoading, setAnalyticsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const loadCatalog = async () => {
      const data = await fetchCatalogProducts()
      if (!mounted) {
        return
      }
      setCatalogProducts(Array.isArray(data) ? data : [])
    }

    const loadAnalyticsStats = async () => {
      setAnalyticsLoading(true)
      try {
        const { buildAuthHeaders } = await import('../utils/auth')
        const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
        const response = await fetch(`${API_BASE}/admin/analytics-stats`, {
          headers: buildAuthHeaders(),
          cache: 'no-store',
        })
        const data = await response.json()
        if (response.ok && mounted) {
          setMetricsByRange(data.metricsByRange || defaultMetrics)
          setChartData(data.chartData || { revenue: [] })
        }
      } catch {
        // keep defaults
      } finally {
        if (mounted) setAnalyticsLoading(false)
      }
    }

    loadCatalog()
    loadAnalyticsStats()

    return () => {
      mounted = false
    }
  }, [])

  const categorySales = useMemo(() => {
    const grouped = catalogProducts.reduce((accumulator, product) => {
      const key = product.category || 'Other'
      accumulator[key] = (accumulator[key] || 0) + Number(product.price || 0)
      return accumulator
    }, {})

    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .sort((first, second) => second.value - first.value)
      .slice(0, 5)
  }, [catalogProducts])

  const topProducts = useMemo(
    () =>
      [...catalogProducts]
        .sort((first, second) => Number(second.price || 0) - Number(first.price || 0))
        .slice(0, 5)
        .map((product, index) => ({
          id: product.id,
          name: product.name,
          value: Number(product.price || 0),
          progress: 100 - index * 14,
        })),
    [catalogProducts],
  )

  const metrics = metricsByRange[range] || defaultMetrics[range]
  const conversionRate = metrics.visitors > 0 ? ((metrics.orders / metrics.visitors) * 100).toFixed(2) : '0.00'

  const exportCsv = () => {
    const rows = topProducts.map((product) => ({
      product: product.name,
      revenue: product.value,
      share_percent: product.progress,
      period: range,
    }))

    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `analytics-${range.toLowerCase()}.csv`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <PageWrapper
      className="page-admin"
      eyebrow="Analytics"
      title="Business intelligence"
      description="Track revenue, category mix, top products, and funnel conversion with period-based insights."
      actions={
        <div className="row-gap">
          <button type="button" className="btn btn-secondary" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      }
    >
      <div className="container admin-container">
        <section className="section card panel panel-stack">
          <div className="tab-strip">
            {['WEEKLY', 'MONTHLY', 'YEARLY'].map((item) => (
              <button
                key={item}
                type="button"
                className={`tab-button ${range === item ? 'tab-button-active' : ''}`}
                onClick={() => setRange(item)}
              >
                {item.charAt(0) + item.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <div className="dashboard-grid">
            <article className="panel stat-card card">
              <p>Revenue</p>
              <h3 className="stat-value">Rs. {Number(metrics.revenue || 0).toLocaleString('en-IN')}</h3>
              <span>{range.toLowerCase()} period</span>
            </article>
            <article className="panel stat-card card">
              <p>Visitors</p>
              <h3 className="stat-value">{Number(metrics.visitors || 0).toLocaleString('en-IN')}</h3>
              <span>Traffic volume</span>
            </article>
            <article className="panel stat-card card">
              <p>Conversion rate</p>
              <h3 className="stat-value">{conversionRate}%</h3>
              <span>Visitors to orders</span>
            </article>
          </div>
        </section>

        <section className="section card panel panel-stack">
          <div className="section-head">
            <div>
              <p className="eyebrow">Revenue</p>
              <h2>Revenue trend</h2>
            </div>
          </div>
          <RevenueChart data={chartData?.revenue || []} />
        </section>

        <section className="section analytics-grid">
          <article className="card panel panel-stack">
            <div className="section-head">
              <div>
                <p className="eyebrow">Category mix</p>
                <h2>Category-wise sales</h2>
              </div>
            </div>

            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={categorySales}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={62}
                    outerRadius={88}
                    paddingAngle={4}
                  >
                    {categorySales.map((entry, index) => (
                      <Cell key={entry.name} fill={palette[index % palette.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `Rs. ${Number(value || 0).toLocaleString('en-IN')}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="card panel panel-stack">
            <div className="section-head">
              <div>
                <p className="eyebrow">Products</p>
                <h2>Top 5 products</h2>
              </div>
              <Button to="/admin/products" variant="secondary">Open products</Button>
            </div>

            <div className="analytics-list">
              {topProducts.map((product) => (
                <div key={product.id} className="analytics-list-item">
                  <div className="section-head">
                    <p>{product.name}</p>
                    <span>Rs. {product.value.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${product.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>
    </PageWrapper>
  )
}
