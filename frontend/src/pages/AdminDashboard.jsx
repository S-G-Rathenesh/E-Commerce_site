import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Button from '../components/Button'
import ImageUploadField from '../components/ImageUploadField'
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
  const [bannerTitle, setBannerTitle] = useState('')
  const [bannerSubtitle, setBannerSubtitle] = useState('')
  const [bannerImageUrl, setBannerImageUrl] = useState('')
  const [bannerImageUploading, setBannerImageUploading] = useState(false)
  const [merchantBanners, setMerchantBanners] = useState([])
  const [bannerMessage, setBannerMessage] = useState('')
  const [trackingModalOrderId, setTrackingModalOrderId] = useState('')
  const [trackingModalData, setTrackingModalData] = useState(null)
  const [trackingModalLogs, setTrackingModalLogs] = useState([])

  const lowStockItems = catalogProducts
    .map((product) => ({ ...product, stock: Number(product.stock || 0) }))
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

  const loadMerchantBannerRequests = async () => {
    try {
      const response = await fetch(`${API_BASE}/merchant/banner-requests`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setMerchantBanners([])
        return
      }
      setMerchantBanners(Array.isArray(data?.banners) ? data.banners : [])
    } catch {
      setMerchantBanners([])
    }
  }

  const submitBannerRequest = async (event) => {
    event.preventDefault()
    setBannerMessage('')
    if (bannerImageUploading) {
      setBannerMessage('Please wait for the banner image upload to finish before submitting.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/merchant/banner-requests`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: bannerTitle,
          subtitle: bannerSubtitle,
          image_url: bannerImageUrl,
          target_path: '/products',
          offer_text: bannerSubtitle,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setBannerMessage(data?.detail || 'Unable to submit banner request.')
        return
      }

      setBannerMessage(data?.message || 'Banner submitted for approval.')
      setBannerTitle('')
      setBannerSubtitle('')
      setBannerImageUrl('')
      await loadMerchantBannerRequests()
    } catch {
      setBannerMessage('Unable to submit banner request right now.')
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
    loadMerchantBannerRequests()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadRecentOrders()
    }, 15000)

    const syncRecentOrders = () => {
      loadRecentOrders()
    }

    window.addEventListener('focus', syncRecentOrders)
    document.addEventListener('visibilitychange', syncRecentOrders)

    return () => {
      clearInterval(intervalId)
      window.removeEventListener('focus', syncRecentOrders)
      document.removeEventListener('visibilitychange', syncRecentOrders)
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
                    <th>Placed At</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th style={{ textAlign: 'right' }}>Track</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.order_id}>
                      <td>{order.order_id}</td>
                      <td>{order.customer_email}</td>
                      <td>{formatDateTime(order.created_at)}</td>
                      <td><StatusBadge status={order.status} /></td>
                      <td style={{ textAlign: 'right' }}>Rs. {Number(order.total_amount || order.order_value || 0).toLocaleString('en-IN')}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Button type="button" variant="secondary" onClick={() => openTrackingModal(order.order_id)}>
                          Track
                        </Button>
                      </td>
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

        <AnimatedSection as="section" delay={0.06} className="panel panel-stack section card dashboard-table-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Campaigns</p>
              <h2>Banner request workflow</h2>
              <p>Submit homepage banner requests for super admin approval.</p>
            </div>
          </div>

          <form className="form-grid" onSubmit={submitBannerRequest}>
            <Input
              label="Banner Title"
              value={bannerTitle}
              onChange={(event) => setBannerTitle(event.target.value)}
              required
            />
            <Input
              label="Banner Subtitle"
              value={bannerSubtitle}
              onChange={(event) => setBannerSubtitle(event.target.value)}
            />
            <ImageUploadField
              label="Banner image"
              value={bannerImageUrl}
              onChange={setBannerImageUrl}
              onUploadingChange={setBannerImageUploading}
              description="Upload the homepage banner artwork or paste a hosted image URL."
              required
            />
            <Button type="submit" disabled={bannerImageUploading}>
              {bannerImageUploading ? 'Upload in progress...' : 'Submit Banner Request'}
            </Button>
          </form>

          {bannerMessage ? <p>{bannerMessage}</p> : null}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {merchantBanners.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No banner requests yet.</td>
                  </tr>
                ) : (
                  merchantBanners.map((banner) => (
                    <tr key={banner.id}>
                      <td>{banner.title}</td>
                      <td>{banner.status}</td>
                      <td>{banner.updated_at ? new Date(banner.updated_at).toLocaleString() : 'N/A'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </AnimatedSection>

      </div>
    </PageWrapper>
  )
}
