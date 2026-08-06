import { useEffect, useState, useRef } from 'react'
import { motion } from 'framer-motion'
import Button from '../components/Button'
import Input from '../components/Input'
import RevenueChart from '../components/RevenueChart'
import OrdersBarChart from '../components/OrdersBarChart'
import AnimatedCounter from '../components/AnimatedCounter'
import AnimatedSection from '../components/AnimatedSection'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders } from '../utils/auth'
import StatusBadge from '../components/StatusBadge'
import { getSlaState } from '../utils/adminUi'
import { fetchCatalogProducts } from '../utils/catalog'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const TRACKING_STEPS = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']



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

function formatDateTime(value) {
  if (!value) {
    return 'N/A'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'N/A'
  }
  return date.toLocaleString()
}

export default function AdminDashboard() {
  const MotionArticle = motion.article
  const [catalogProducts, setCatalogProducts] = useState([])
  const [recentOrders, setRecentOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [range, setRange] = useState('WEEK')
  const [dashboardStats, setDashboardStats] = useState(null)
  const [chartData, setChartData] = useState({ revenue: [], orders: [] })
  const lastFetchTimeRef = useRef(0)
  const [statsLoading, setStatsLoading] = useState(true)
  const [trackingModalOrderId, setTrackingModalOrderId] = useState('')
  const [trackingModalData, setTrackingModalData] = useState(null)
  const [trackingModalLogs, setTrackingModalLogs] = useState([])
  const [productFeedback, setProductFeedback] = useState([])
  const [productFeedbackLoading, setProductFeedbackLoading] = useState(true)
  const [deliveryRatings, setDeliveryRatings] = useState([])
  const [deliveryRatingsLoading, setDeliveryRatingsLoading] = useState(true)

  const lowStockItems = catalogProducts
    .map((product) => ({ ...product, stock: Number(product.stock || 0) }))
    .filter((item) => item.stock < 8)
    .slice(0, 3)
  const delayedOrders = recentOrders.filter((order) => getSlaState(order).label === 'Delayed')

  const renderSparkline = (values) => {
    if (!values || values.length === 0) return null
    const max = Math.max(...values, 1) // Ensure max > min if all zero
    const min = Math.min(...values, 0)
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

  const getStepState = (currentStatus, step) => {
    const status = String(currentStatus || '').trim().toUpperCase()
    const currentIndex = TRACKING_STEPS.indexOf(status)
    const stepIndex = TRACKING_STEPS.indexOf(step)

    if (stepIndex < currentIndex) {
      return 'completed'
    }
    if (stepIndex === currentIndex) {
      return 'active'
    }
    return 'pending'
  }

  const openTrackingModal = async (orderId) => {
    setTrackingModalOrderId(orderId)
    setTrackingModalData(null)
    setTrackingModalLogs([])

    try {
      const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/tracking`, {
        headers: buildAuthHeaders(),
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) {
        return
      }
      setTrackingModalData(data)
      setTrackingModalLogs(Array.isArray(data?.logs) ? data.logs : [])
    } catch {
      // keep modal open even if the latest tracking request fails
    }
  }

  const closeTrackingModal = () => {
    setTrackingModalOrderId('')
    setTrackingModalData(null)
    setTrackingModalLogs([])
  }

  const loadRecentOrders = async () => {
    lastFetchTimeRef.current = Date.now()
    setOrdersLoading(true)
    try {
      const response = await fetch(`${API_BASE}/admin/orders`, {
        headers: buildAuthHeaders(),
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) {
        setRecentOrders([])
        return
      }

      const nextOrders = Array.isArray(data) ? data : (Array.isArray(data?.orders) ? data.orders : [])
      setRecentOrders(nextOrders.slice(0, 5))
    } catch {
      setRecentOrders([])
    } finally {
      setOrdersLoading(false)
    }
  }

  const loadFeedbackPanels = async () => {
    setProductFeedbackLoading(true)
    setDeliveryRatingsLoading(true)
    try {
      const [productResponse, deliveryResponse] = await Promise.all([
        fetch(`${API_BASE}/admin/product-feedback?limit=12`, {
          headers: buildAuthHeaders(),
          cache: 'no-store',
        }),
        fetch(`${API_BASE}/admin/delivery-ratings?limit=12`, {
          headers: buildAuthHeaders(),
          cache: 'no-store',
        }),
      ])

      const productData = await productResponse.json().catch(() => ({}))
      const deliveryData = await deliveryResponse.json().catch(() => ({}))

      setProductFeedback(Array.isArray(productData?.reviews) ? productData.reviews : [])
      setDeliveryRatings(Array.isArray(deliveryData?.ratings) ? deliveryData.ratings : [])
    } catch {
      setProductFeedback([])
      setDeliveryRatings([])
    } finally {
      setProductFeedbackLoading(false)
      setDeliveryRatingsLoading(false)
    }
  }

  const loadDashboardStats = async () => {
    lastFetchTimeRef.current = Date.now()
    setStatsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/admin/dashboard-stats`, {
        headers: buildAuthHeaders(),
        cache: 'no-store',
      })
      const data = await response.json()
      if (response.ok) {
        setDashboardStats(data.statsByRange)
        setChartData(data.chartData)
      }
    } catch {
      // Keep previous data on error
    } finally {
      setStatsLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    const loadCatalogProducts = async () => {
      const data = await fetchCatalogProducts()
      if (!mounted) {
        return
      }
      setCatalogProducts(Array.isArray(data) ? data : [])
    }

    loadCatalogProducts()
    loadRecentOrders()
    loadFeedbackPanels()
    loadDashboardStats()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadRecentOrders()
    }, 15000)

    const syncRecentOrders = () => {
      if (Date.now() - lastFetchTimeRef.current > 5000) {
        loadRecentOrders()
        loadDashboardStats()
      }
    }

    window.addEventListener('focus', syncRecentOrders)
    document.addEventListener('visibilitychange', syncRecentOrders)
    window.addEventListener('notifications-changed', syncRecentOrders)

    return () => {
      clearInterval(intervalId)
      window.removeEventListener('focus', syncRecentOrders)
      document.removeEventListener('visibilitychange', syncRecentOrders)
      window.removeEventListener('notifications-changed', syncRecentOrders)
    }
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
            {statsLoading && !dashboardStats ? (
              <p>Loading stats...</p>
            ) : (
              (dashboardStats?.[range] || []).map((stat, index) => (
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
              ))
            )}
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
            <RevenueChart data={chartData?.revenue || []} />
            <div className="section-head" style={{ marginTop: 8 }}>
              <div>
                <h2>Orders overview</h2>
                <p>Weekly order volume summary.</p>
              </div>
              <p>Last 7 days</p>
            </div>
            <OrdersBarChart data={chartData?.orders || []} />
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
                    <th>Placed At</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th style={{ textAlign: 'right' }}>Track</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => {
                    const shipping = order.shipping_details || {}
                    const customerDisplay = String(shipping.full_name || order.customer_name || order.customer_email || '').trim()
                    const customerPhone = String(shipping.phone || '').trim()
                    return (
                    <tr key={order.order_id}>
                      <td>{order.order_id}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontWeight: 700, fontSize: '13px' }}>{customerDisplay}</span>
                          {customerPhone ? <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>📞 {customerPhone}</span> : null}
                        </div>
                      </td>
                      <td>{formatDateTime(order.created_at)}</td>
                      <td><StatusBadge status={order.status} /></td>
                      <td style={{ textAlign: 'right' }}>Rs. {Number(order.total_amount || order.order_value || 0).toLocaleString('en-IN')}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Button type="button" variant="secondary" onClick={() => openTrackingModal(order.order_id)}>
                          Track
                        </Button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </AnimatedSection>

        <AnimatedSection as="section" delay={0.06} className="panel panel-stack section card dashboard-table-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Feedback</p>
              <h2>Customer product reviews</h2>
              <p>Latest approved reviews with the live product rating beside each item.</p>
            </div>
          </div>

          {productFeedbackLoading ? <p>Loading customer feedback...</p> : null}
          {!productFeedbackLoading && productFeedback.length === 0 ? <p>No customer reviews available yet.</p> : null}

          {!productFeedbackLoading && productFeedback.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Customer</th>
                    <th>Rating</th>
                    <th>Review</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {productFeedback.map((review) => (
                    <tr key={review.review_id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <strong>{review.product_name || `Product #${review.product_id}`}</strong>
                          <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                            {review.product_section || ''}{review.product_category ? ` • ${review.product_category}` : ''}
                          </span>
                        </div>
                      </td>
                      <td>{review.customer_name || review.customer_email || 'Customer'}</td>
                      <td>
                        <strong>{review.rating} / 5</strong>
                        {review.product_rating ? <div style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>Live: {review.product_rating.toFixed(1)}</div> : null}
                      </td>
                      <td style={{ maxWidth: '320px' }}>{review.review_text || 'No written review'}</td>
                      <td>{formatDateTime(review.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </AnimatedSection>

        <AnimatedSection as="section" delay={0.08} className="panel panel-stack section card dashboard-table-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Delivery</p>
              <h2>Customer delivery ratings</h2>
              <p>Track how delivery associates are being rated by customers.</p>
            </div>
          </div>

          {deliveryRatingsLoading ? <p>Loading delivery ratings...</p> : null}
          {!deliveryRatingsLoading && deliveryRatings.length === 0 ? <p>No delivery ratings available yet.</p> : null}

          {!deliveryRatingsLoading && deliveryRatings.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Partner</th>
                    <th>Rating</th>
                    <th>Feedback</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryRatings.map((rating) => (
                    <tr key={rating.rating_id || `${rating.order_id}-${rating.customer_email}`}>
                      <td>{rating.order_id}</td>
                      <td>{rating.customer_email || 'Customer'}</td>
                      <td>{rating.delivery_partner_email || 'Unassigned'}</td>
                      <td><strong>{rating.rating} / 5</strong></td>
                      <td style={{ maxWidth: '320px' }}>{rating.feedback || 'No written feedback'}</td>
                      <td>{formatDateTime(rating.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </AnimatedSection>

        {trackingModalOrderId ? (() => {
          const modalOrder = recentOrders.find((order) => order.order_id === trackingModalOrderId)
          const modalStatus = String(trackingModalData?.current_status || modalOrder?.status || '').toUpperCase()
          const modalHistory = Array.isArray(trackingModalData?.order?.status_history)
            ? trackingModalData.order.status_history
            : []
          const latestByStatus = modalHistory.reduce((accumulator, entry) => {
            const key = String(entry?.status || '').trim().toUpperCase()
            if (key) {
              accumulator[key] = entry
            }
            return accumulator
          }, {})
          const progressRatio = Math.max(0, TRACKING_STEPS.indexOf(modalStatus)) / (TRACKING_STEPS.length - 1 || 1)
          const shipment = trackingModalData?.order?.shipment || {}

          return (
            <div
              role="presentation"
              onClick={closeTrackingModal}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.62)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                zIndex: 60,
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`Tracking details for ${trackingModalOrderId}`}
                onClick={(event) => event.stopPropagation()}
                className="section-card panel-stack"
                style={{ maxWidth: '920px', width: '100%', maxHeight: '85vh', overflow: 'auto' }}
              >
                <div className="section-head">
                  <div>
                    <p className="eyebrow">TRACKING</p>
                    <h3>{trackingModalOrderId}</h3>
                    <p>{modalOrder?.customer_email}</p>
                    {shipment?.tracking_id ? <p>Tracking ID: {shipment.tracking_id}</p> : null}
                    {shipment?.status ? <p>Shipment status: {shipment.status}</p> : null}
                    {shipment?.estimated_delivery ? <p>Estimated delivery: {shipment.estimated_delivery}</p> : null}
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={closeTrackingModal}>
                    Close
                  </button>
                </div>

                <section className="tracking-progress-shell">
                  <div className="tracking-progress-line" aria-hidden="true">
                    <span className="tracking-progress-fill" style={{ width: `${Number.isFinite(progressRatio) ? progressRatio * 100 : 0}%` }} />
                  </div>
                  <div className="tracking-progress-steps" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
                    {TRACKING_STEPS.map((step) => {
                      const state = getStepState(modalStatus, step)
                      return (
                        <div
                          key={`${trackingModalOrderId}-${step}`}
                          className={`tracking-progress-step ${state === 'completed' ? 'tracking-progress-step-completed' : ''} ${state === 'active' ? 'tracking-progress-step-active' : ''}`}
                        >
                          <span className="tracking-progress-dot" aria-hidden="true">
                            {state === 'completed' ? '✓' : state === 'active' ? '●' : '○'}
                          </span>
                          <span className="tracking-progress-label-wrap">
                            <span>{step.replaceAll('_', ' ')}</span>
                            <span className="tracking-progress-time">{formatDateTime(latestByStatus[step]?.timestamp)}</span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="section-card panel-stack tracking-subcard">
                  <p className="field-label">Timeline</p>
                  <div className="tracking-vertical-timeline">
                    {TRACKING_STEPS.map((step) => {
                      const state = getStepState(modalStatus, step)
                      const entry = latestByStatus[step]
                      return (
                        <div key={`${trackingModalOrderId}-timeline-${step}`} className={`tracking-vertical-item ${state === 'completed' ? 'tracking-vertical-item-completed' : ''} ${state === 'active' ? 'tracking-vertical-item-active' : ''}`}>
                          <span className="tracking-vertical-marker">{state === 'completed' ? '✓' : state === 'active' ? '●' : '○'}</span>
                          <div>
                            <p className="tracking-vertical-title">{step.replaceAll('_', ' ')}</p>
                            <p className="tracking-vertical-time">{entry?.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Pending'}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="section-card panel-stack tracking-subcard">
                  <p className="field-label">Tracking Details</p>
                  {trackingModalLogs.length ? (
                    trackingModalLogs.map((entry) => (
                      <p key={`${trackingModalOrderId}-modal-log-${entry.id || entry.timestamp}`}>
                        {String(entry.status || '').replaceAll('_', ' ')} · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Updated'}
                        {entry.location ? ` · ${entry.location}` : ''}
                      </p>
                    ))
                  ) : (
                    <p>No tracking events available yet.</p>
                  )}
                </section>
              </div>
            </div>
          )
        })() : null}
      </div>
    </PageWrapper>
  )
}
