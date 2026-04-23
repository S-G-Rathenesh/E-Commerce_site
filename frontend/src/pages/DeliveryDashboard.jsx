import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageWrapper from '../components/PageWrapper'
import StatusBadge from '../components/StatusBadge'
import { buildAuthHeaders, clearStoredUser, getStoredUser, setStoredUser } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const DELIVERY_TABS = ['READY', 'ACTIVE', 'COMPLETED', 'FAILED']
const DELIVERY_FLOW = ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']

function buildMapsLink(order) {
  const rawAddress = String(order?.delivery_address || '').trim()
  const destination = rawAddress || `${order?.destination_pincode || ''}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`
}

function getDeliveryQueueState(order) {
  const status = String(order?.status || '').toUpperCase()
  const meta = order?.delivery_meta || {}

  if (status === 'DELIVERED') {
    return 'COMPLETED'
  }
  if (status === 'DELIVERY_FAILED') {
    return 'FAILED'
  }
  if (meta.rejected_at) {
    return 'FAILED'
  }
  if (status === 'OUT_FOR_DELIVERY') {
    return 'ACTIVE'
  }
  return 'READY'
}

function getFlowState(order, step) {
  const status = String(order?.status || '').toUpperCase()

  const completed = {
    SHIPPED: true,
    OUT_FOR_DELIVERY: status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED',
    DELIVERED: status === 'DELIVERED',
  }

  if (!completed[step]) {
    return 'todo'
  }

  if (status === 'DELIVERED' && step === 'DELIVERED') {
    return 'active'
  }
  if (status === 'OUT_FOR_DELIVERY' && step === 'OUT_FOR_DELIVERY') {
    return 'active'
  }
  return 'done'
}

function getOrderTitle(order) {
  return order?.customer_name || order?.customer_email || order?.order_id || 'Delivery order'
}

function formatOrderTime(value) {
  if (!value) {
    return 'N/A'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'N/A'
  }
  return date.toLocaleString()
}

function getReadyForPickupLabel(order) {
  if (String(order?.status || '').toUpperCase() === 'SHIPPED') {
    return 'Ready for Pickup'
  }
  return 'Awaiting Pickup'
}

export default function DeliveryDashboard() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [earnings, setEarnings] = useState({
    today_earnings: 0,
    today_deliveries: 0,
    weekly_earnings: 0,
  })
  const [message, setMessage] = useState('')
  const [drafts, setDrafts] = useState({})
  const [activeTab, setActiveTab] = useState('READY')
  const [isOnline, setIsOnline] = useState(() => window.localStorage.getItem('delivery_online_status') !== 'OFFLINE')
  const [loading, setLoading] = useState(true)
  const [actionLoadingByOrder, setActionLoadingByOrder] = useState({})

  const refreshAccessToken = async () => {
    const user = getStoredUser()
    const refreshToken = String(user?.refresh_token || '').trim()
    if (!refreshToken) {
      return false
    }

    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      const data = await response.json()
      if (!response.ok || !data?.token) {
        return false
      }

      setStoredUser({
        ...(user || {}),
        ...(data?.user || {}),
        token: data.token,
        refresh_token: data.refresh_token || refreshToken,
      })
      return true
    } catch {
      return false
    }
  }

  const requestWithAuth = async (url, options = {}) => {
    const headers = buildAuthHeaders(options.headers || {})
    let response = await fetch(url, { ...options, headers })
    if (response.status !== 401) {
      return response
    }

    const refreshed = await refreshAccessToken()
    if (!refreshed) {
      clearStoredUser()
      navigate('/login', { replace: true })
      throw new Error('Auth expired')
    }

    response = await fetch(url, {
      ...options,
      headers: buildAuthHeaders(options.headers || {}),
    })
    return response
  }

  const validateTokenOnLoad = async () => {
    try {
      const response = await requestWithAuth(`${API_BASE}/auth/me`, { method: 'GET' })
      return response.ok
    } catch {
      return false
    }
  }

  const loadEarnings = async () => {
    try {
      const response = await requestWithAuth(`${API_BASE}/delivery/earnings`, { method: 'GET' })
      const data = await response.json()
      if (!response.ok) {
        return
      }
      setEarnings({
        today_earnings: Number(data?.today_earnings || 0),
        today_deliveries: Number(data?.today_deliveries || 0),
        weekly_earnings: Number(data?.weekly_earnings || 0),
      })
    } catch {
      // keep current earnings values
    }
  }

  const loadOrders = async () => {
    if (!isOnline) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const response = await requestWithAuth(`${API_BASE}/delivery/orders`, { method: 'GET' })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load delivery orders.')
        setOrders([])
        return
      }

      const nextOrders = Array.isArray(data?.orders) ? data.orders : []
      setOrders(nextOrders)
      setDrafts(
        nextOrders.reduce((accumulator, order) => {
          accumulator[order.order_id] = {
            current_location: order?.shipment?.current_location || 'Last mile route',
          }
          return accumulator
        }, {}),
      )
      setMessage('')
      await loadEarnings()
    } catch {
      setMessage('Unable to load delivery orders.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const initialize = async () => {
      const valid = await validateTokenOnLoad()
      if (!valid) {
        clearStoredUser()
        navigate('/login', { replace: true })
        return
      }
      loadOrders()
    }

    initialize()
  }, [navigate])

  useEffect(() => {
    window.localStorage.setItem('delivery_online_status', isOnline ? 'ONLINE' : 'OFFLINE')
    if (isOnline) {
      loadOrders()
    } else {
      setMessage('You are offline. New delivery tasks will not refresh.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  useEffect(() => {
    if (!isOnline) {
      return undefined
    }

    const intervalId = setInterval(() => {
      loadOrders()
    }, 15000)
    return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  const updateDraft = (orderId, key, value) => {
    setDrafts((current) => ({
      ...current,
      [orderId]: {
        ...(current[orderId] || {}),
        [key]: value,
      },
    }))
  }

  const performDeliveryAction = async (orderId, action, currentLocationOverride = null) => {
    if (actionLoadingByOrder[orderId]) {
      return
    }

    setActionLoadingByOrder((current) => ({
      ...current,
      [orderId]: true,
    }))

    const draft = drafts[orderId] || {}
    const currentLocation = currentLocationOverride || draft.current_location || 'Last mile route'

    const startDeliveryEndpoint = `${API_BASE}/orders/${encodeURIComponent(orderId)}/start-delivery`
    const legacyStartDeliveryEndpoint = `${API_BASE}/orders/${encodeURIComponent(orderId)}/out-for-delivery`
    let endpoint = startDeliveryEndpoint
    let method = 'POST'
    let body = { current_location: currentLocation }

    if (action === 'DELIVERED') {
      endpoint = `${API_BASE}/orders/${encodeURIComponent(orderId)}/delivered`
    }

    try {
      let response = await requestWithAuth(endpoint, {
        method,
        headers: body && Object.keys(body).length > 0 ? { 'Content-Type': 'application/json' } : undefined,
        body: body && Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
      })

      // Backward compatibility for older backend instances still exposing /out-for-delivery.
      if (action !== 'DELIVERED' && response.status === 404) {
        response = await requestWithAuth(legacyStartDeliveryEndpoint, {
          method,
          headers: body && Object.keys(body).length > 0 ? { 'Content-Type': 'application/json' } : undefined,
          body: body && Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
        })
      }

      const data = await response.json()

      if (!response.ok) {
        setMessage(data?.detail || 'Failed to update delivery task.')
        return
      }

      setMessage(data?.message || 'Delivery task updated successfully.')
      await loadOrders()
    } catch {
      setMessage('Failed to update delivery task.')
    } finally {
      setActionLoadingByOrder((current) => {
        const next = { ...current }
        delete next[orderId]
        return next
      })
    }
  }

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => getDeliveryQueueState(order) === activeTab)
  }, [orders, activeTab])

  const stats = useMemo(() => {
    return orders.reduce(
      (accumulator, order) => {
        const queueState = getDeliveryQueueState(order)
        accumulator[queueState] += 1
        return accumulator
      },
      { READY: 0, ACTIVE: 0, COMPLETED: 0, FAILED: 0 },
    )
  }, [orders])

  return (
    <PageWrapper
      className="page-delivery"
      eyebrow="Delivery"
      title="Delivery dashboard"
      description="Manage ready-for-pickup shipments, start deliveries, and confirm final delivery in real time."
    >
      <section className="panel panel-stack">
        <div className="section-head">
          <div>
            <h2>Last-mile control center</h2>
            <p>Only your assigned orders are shown here.</p>
          </div>
          <div className="admin-controls-row">
            <button
              type="button"
              className={`btn ${isOnline ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setIsOnline((current) => !current)}
            >
              {isOnline ? 'Online' : 'Offline'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={loadOrders} disabled={!isOnline}>
              Refresh
            </button>
          </div>
        </div>

        <div className="dashboard-grid">
          <article className="panel stat-card card">
            <p>Today earnings</p>
            <h3 className="stat-value">Rs. {earnings.today_earnings.toFixed(2)}</h3>
            <span>Delivered today: {earnings.today_deliveries}</span>
          </article>
          <article className="panel stat-card card">
            <p>Ready for Pickup</p>
            <h3 className="stat-value">{stats.READY}</h3>
            <span>Shipped orders awaiting pickup</span>
          </article>
          <article className="panel stat-card card">
            <p>Completed</p>
            <h3 className="stat-value">{stats.COMPLETED}</h3>
            <span>Delivered successfully</span>
          </article>
          <article className="panel stat-card card">
            <p>Weekly earnings</p>
            <h3 className="stat-value">Rs. {earnings.weekly_earnings.toFixed(2)}</h3>
            <span>Current week</span>
          </article>
        </div>

        <div className="tab-strip" style={{ marginTop: '16px' }}>
          {DELIVERY_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab-button ${activeTab === tab ? 'tab-button-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'READY'
                ? 'Ready for Pickup'
                : tab === 'ACTIVE'
                  ? 'Out for Delivery'
                  : tab === 'COMPLETED'
                    ? 'Completed Orders'
                    : 'Failed Orders'}
            </button>
          ))}
        </div>

        {message ? <p className="wishlist-message">{message}</p> : null}
        {loading ? <p>Loading delivery orders...</p> : null}

        {!loading && filteredOrders.length === 0 ? <p>No orders found in this section.</p> : null}

        <div className="admin-orders-stack">
          {filteredOrders.map((order) => {
            const shipment = order.shipment || {}
            const draft = drafts[order.order_id] || {
              current_location: shipment.current_location || 'Last mile route',
            }
            const phone = String(order.customer_phone || '').trim()
            const mapsLink = buildMapsLink(order)
            const status = String(order.status || '').toUpperCase()
            const queueState = getDeliveryQueueState(order)
            const canStart = status === 'SHIPPED'
            const canComplete = status === 'OUT_FOR_DELIVERY'
            const isDelivered = status === 'DELIVERED'
            const isActionLoading = Boolean(actionLoadingByOrder[order.order_id])

            console.log('ORDER STATUS:', order.status)

            return (
              <article key={order.order_id} className={`section-card panel-stack delivery-order-card ${queueState === 'ACTIVE' ? 'delivery-order-card-active' : ''}`}>
                <div className="section-head">
                  <div>
                    <h3>{order.order_id}</h3>
                    <p>{getOrderTitle(order)}</p>
                    <p>{getReadyForPickupLabel(order)}</p>
                  </div>
                  <StatusBadge status={order.status} />
                </div>

                <div className="admin-orders-grid">
                  <div className="field-group">
                    <span className="field-label">Customer phone</span>
                    {phone ? (
                      <a href={`tel:${phone}`} className="btn btn-secondary" style={{ width: 'fit-content' }}>
                        Call {phone}
                      </a>
                    ) : (
                      <p>Phone not available</p>
                    )}
                  </div>

                  <div className="field-group">
                    <span className="field-label">Delivery address</span>
                    <p>{order.delivery_address || 'Address not available'}</p>
                  </div>

                  <div className="field-group">
                    <span className="field-label">Order value</span>
                    <p>Rs. {Number(order.order_value || order.total_amount || 0).toLocaleString('en-IN')}</p>
                  </div>

                  <div className="field-group">
                    <span className="field-label">Navigation</span>
                    <a href={mapsLink} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ width: 'fit-content' }}>
                      Open in Maps
                    </a>
                  </div>
                </div>

                <div className="field-group">
                  <span className="field-label">Delivery flow</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
                    {DELIVERY_FLOW.map((step) => {
                      const stepState = getFlowState(order, step)
                      return (
                        <div
                          key={`${order.order_id}-${step}`}
                          style={{
                            padding: '8px',
                            borderRadius: '8px',
                            textAlign: 'center',
                            fontSize: '12px',
                            fontWeight: 700,
                            border: '1px solid #d1d5db',
                            backgroundColor:
                              stepState === 'active' ? '#dbeafe' : stepState === 'done' ? '#dcfce7' : '#f3f4f6',
                            color: stepState === 'todo' ? '#6b7280' : '#111827',
                          }}
                        >
                          {step.replaceAll('_', ' ')}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="admin-orders-grid">
                  <label className="field-group">
                    <span className="field-label">Current location</span>
                    <input
                      className="field"
                      value={draft.current_location}
                      onChange={(event) => updateDraft(order.order_id, 'current_location', event.target.value)}
                      placeholder="Last mile route"
                    />
                  </label>

                  <div className="field-group">
                    <span className="field-label">Tracking</span>
                    <p>{shipment.tracking_id || 'Pending tracking ID'}</p>
                  </div>

                  {isDelivered ? (
                    <button type="button" className="btn btn-secondary" disabled>
                      ✔ Delivered
                    </button>
                  ) : canStart ? (
                    <button type="button" className="btn btn-primary" onClick={() => performDeliveryAction(order.order_id, 'START_DELIVERY')} disabled={!canStart || isActionLoading}>
                      {isActionLoading ? 'Starting...' : 'Start Delivery'}
                    </button>
                  ) : null}
                  {canComplete ? (
                    <button type="button" className="btn btn-secondary" onClick={() => performDeliveryAction(order.order_id, 'DELIVERED')} disabled={!canComplete || isActionLoading}>
                      {isActionLoading ? 'Updating...' : 'Mark Delivered'}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </PageWrapper>
  )
}
