import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Button from '../components/Button'
import RevenueChart from '../components/RevenueChart'
import OrdersBarChart from '../components/OrdersBarChart'
import AnimatedCounter from '../components/AnimatedCounter'
import AnimatedSection from '../components/AnimatedSection'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders } from '../utils/auth'
import { products } from '../data/products'
import StatusBadge from '../components/StatusBadge'
import { generateStock, getSlaState } from '../utils/adminUi'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const statsByRange = {
  TODAY: [
    { label: 'Total Sales', value: 'Rs. 84,000', trend: '+4.2%', sparkline: [42, 48, 44, 50, 53, 57, 60] },
    { label: 'Orders', value: '214', trend: '+3.1%', sparkline: [22, 28, 26, 31, 33, 30, 34] },
    { label: 'New Customers', value: '38', trend: '+1.5%', sparkline: [4, 6, 5, 7, 6, 8, 9] },
  ],
  WEEK: [
    { label: 'Total Sales', value: 'Rs. 4,62,000', trend: '+9.5%', sparkline: [260, 280, 276, 292, 315, 328, 344] },
    { label: 'Orders', value: '1,284', trend: '+8.2%', sparkline: [92, 108, 99, 116, 121, 127, 138] },
    { label: 'New Customers', value: '206', trend: '+2.4%', sparkline: [21, 26, 24, 28, 30, 36, 41] },
  ],
  MONTH: [
    { label: 'Total Sales', value: 'Rs. 18,40,000', trend: '+12.5%', sparkline: [880, 930, 910, 980, 1050, 1130, 1210] },
    { label: 'Orders', value: '5,320', trend: '+10.8%', sparkline: [280, 300, 325, 341, 366, 390, 418] },
    { label: 'New Customers', value: '804', trend: '+4.7%', sparkline: [40, 43, 51, 56, 60, 63, 68] },
  ],
}

const dashboardSummary = {
  dashboard: {
    eyebrow: 'Admin',
    title: 'Store operations dashboard',
    description: 'A compact, grid-based admin area with matching cards, spacing, and strong visual hierarchy.',
  },
  orders: {
    eyebrow: 'Orders',
    title: 'Order management',
    description: 'Track processing states, fulfillment progress, and order volume from one place.',
  },
  customers: {
    eyebrow: 'Customers',
    title: 'Customer overview',
    description: 'See customer activity and relationship status to support retention and service quality.',
  },
  analytics: {
    eyebrow: 'Analytics',
    title: 'Sales analytics',
    description: 'Review performance trends and revenue movement across your recent selling window.',
  },
  profile: {
    eyebrow: 'Profile',
    title: 'Merchant profile',
    description: 'Manage merchant account details and keep your storefront identity up to date.',
  },
}

export default function AdminDashboard() {
  const MotionArticle = motion.article
  const [recentOrders, setRecentOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [range, setRange] = useState('WEEK')

  const lowStockItems = products
    .map((product) => ({ ...product, stock: generateStock(product.id) }))
    .filter((item) => item.stock < 8)
    .slice(0, 3)
  const delayedOrders = recentOrders.filter((order) => getSlaState(order).label === 'Delayed')

  const renderSparkline = (values) => {
    const max = Math.max(...values)
    const min = Math.min(...values)
    const points = values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100
        const y = max === min ? 50 : 100 - ((value - min) / (max - min)) * 100
        return `${x},${y}`
      })
      .join(' ')

    return (
      <svg className="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} />
      </svg>
    )
  }

  const loadRecentOrders = async () => {
    setOrdersLoading(true)
    try {
      const response = await fetch(`${API_BASE}/admin/orders`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setRecentOrders([])
        return
      }

      const nextOrders = Array.isArray(data?.orders) ? data.orders : []
      setRecentOrders(nextOrders.slice(0, 5))
    } catch {
      setRecentOrders([])
    } finally {
      setOrdersLoading(false)
    }
  }

  useEffect(() => {
    loadRecentOrders()
  }, [])

  const page = dashboardSummary.dashboard
  const pageActions = (
    <div className="row-gap">
      <Button to="/admin/products">+ Add Product</Button>
      <Button to="/admin/orders" variant="secondary">+ Create Order</Button>
      <Button to="/admin/orders" variant="secondary">View Orders</Button>
    </div>
  )

  return (
    <PageWrapper
      className="page-admin"
      eyebrow={page.eyebrow}
      title={page.title}
      description={page.description}
      actions={pageActions}
    >
      <div className="admin-layout container admin-container">
        <section className="section">
          <div className="section-head section-head-tight">
            <div className="tab-strip">
              {[
                { key: 'TODAY', label: 'Today' },
                { key: 'WEEK', label: 'This Week' },
                { key: 'MONTH', label: 'This Month' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`tab-button ${range === item.key ? 'tab-button-active' : ''}`}
                  onClick={() => setRange(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="dashboard-grid">
            {statsByRange[range].map((stat, index) => (
              <MotionArticle
                key={stat.label}
                className={`panel stat-card card stat-card-${['blue', 'green', 'orange'][index] || 'blue'}`}
                whileHover={{
                  y: -4,
                  scale: 1.03,
                  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.16)',
                }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                style={{ willChange: 'transform, opacity' }}
              >
                <p>{stat.label}</p>
                <h3 className="stat-value">
                  <AnimatedCounter value={stat.value} duration={420 + index * 40} />
                </h3>
                <span>{stat.trend}</span>
                {renderSparkline(stat.sparkline)}
              </MotionArticle>
            ))}
          </div>
        </section>

        {lowStockItems.length > 0 || delayedOrders.length > 0 ? (
          <section className="section dashboard-alerts">
            {lowStockItems.length > 0 ? (
              <div className="dashboard-alert-card dashboard-alert-card-warning">
                <p className="eyebrow">Low stock</p>
                <p>{lowStockItems.map((item) => `${item.name} (${item.stock})`).join(', ')}</p>
              </div>
            ) : null}
            {delayedOrders.length > 0 ? (
              <div className="dashboard-alert-card dashboard-alert-card-danger">
                <p className="eyebrow">Delayed orders</p>
                <p>{delayedOrders.map((order) => order.order_id).join(', ')}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        <AnimatedSection as="section" className="panel panel-stack section card dashboard-chart-card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Performance</p>
                <h2>Revenue activity</h2>
                <p>Track sales trend and weekly order movement from one summary block.</p>
              </div>
              <p>Last 30 days</p>
            </div>
            <RevenueChart />
            <div className="section-head" style={{ marginTop: 8 }}>
              <div>
                <h2>Orders overview</h2>
                <p>Weekly order volume summary.</p>
              </div>
              <p>Last 7 days</p>
            </div>
            <OrdersBarChart />
        </AnimatedSection>

        <AnimatedSection as="section" delay={0.04} className="panel panel-stack section card dashboard-table-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Orders</p>
              <h2>Recent orders summary</h2>
              <p>Latest five orders for quick health checks.</p>
            </div>
            <Button to="/admin/orders" variant="secondary">Open control center</Button>
          </div>

          {ordersLoading ? <p>Loading recent orders...</p> : null}
          {!ordersLoading && recentOrders.length === 0 ? <p>No recent orders available.</p> : null}

          {!ordersLoading && recentOrders.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.order_id}>
                      <td>{order.order_id}</td>
                      <td>{order.customer_email}</td>
                      <td><StatusBadge status={order.status} /></td>
                      <td style={{ textAlign: 'right' }}>Rs. {Number(order.total_amount || 0).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </AnimatedSection>

      </div>
    </PageWrapper>
  )
}
