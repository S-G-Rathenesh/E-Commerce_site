import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageWrapper from '../components/PageWrapper'
import StatusBadge from '../components/StatusBadge'
import { buildAuthHeaders, clearStoredUser, getStoredUser, setStoredUser } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const DELIVERY_TABS = ['ACTIVE', 'COMPLETED', 'FAILED']
const DELIVERY_STEPS = ['ASSIGNED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED']

function getStepState(order, step) {
  const status = String(order?.status || '').toUpperCase()
  const meta = order?.delivery_meta || {}

  const completed = {
    ASSIGNED: true,
    PICKED: Boolean(meta.picked_at),
    OUT_FOR_DELIVERY: status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED',
    DELIVERED: status === 'DELIVERED',
  }

  if (completed[step]) {
    if (step === 'DELIVERED' && status === 'DELIVERED') {
      return 'active'
    }
    if (step === 'OUT_FOR_DELIVERY' && status === 'OUT_FOR_DELIVERY') {
      return 'active'
    }
    return 'done'
  }
  return 'todo'
}

function buildMapsLink(order) {
  const rawAddress = String(order?.delivery_address || '').trim()
  const destination = rawAddress || `${order?.destination_pincode || ''}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`
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
  const [activeTab, setActiveTab] = useState('ACTIVE')
  const [isOnline, setIsOnline] = useState(() => {
    const stored = window.localStorage.getItem('delivery_online_status')
    return stored ? stored === 'ONLINE' : true
  })
  const [loading, setLoading] = useState(true)

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
      const response = await requestWithAuth(`${API_BASE}/auth/me`, {
        method: 'GET',
      })
      return response.ok
    } catch {
      return false
    }
  }

  const loadEarnings = async () => {
    try {
      const response = await requestWithAuth(`${API_BASE}/delivery/earnings`, {
        method: 'GET',
      })
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
      const response = await requestWithAuth(`${API_BASE}/delivery/orders`, {
        method: 'GET',
      })
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
            status: order.status === 'DELIVERED' ? 'DELIVERED' : order.status === 'DELIVERY_FAILED' ? 'FAILED' : 'OUT_FOR_DELIVERY',
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
      setMessage('You are offline. New orders will not be fetched.')
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

  const saveStatus = async (orderId, statusOverride = null) => {
    const draft = drafts[orderId] || {}
    const statusValue = statusOverride || draft.status

    try {
      const response = await requestWithAuth(`${API_BASE}/delivery/update-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_id: orderId,
          status: statusValue,
          current_location: draft.current_location,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Failed to update delivery status.')
        return
      }

      setMessage('Delivery status updated successfully.')
      const updatedOrder = data?.order || null
      if (updatedOrder?.order_id) {
        setOrders((current) => current.map((order) => (order.order_id === updatedOrder.order_id ? updatedOrder : order)))
        setDrafts((current) => ({
          ...current,
          [updatedOrder.order_id]: {
            status: updatedOrder.status === 'DELIVERED' ? 'DELIVERED' : 'OUT_FOR_DELIVERY',
            current_location: updatedOrder?.shipment?.current_location || draft.current_location || 'Last mile route',
          },
        }))
      } else {
        loadOrders()
      }
      await loadEarnings()
    } catch {
      setMessage('Failed to update delivery status.')
    }
  }

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const status = String(order.status || '').toUpperCase()
      if (activeTab === 'COMPLETED') {
        return status === 'DELIVERED'
      }
      if (activeTab === 'FAILED') {
        return status === 'DELIVERY_FAILED'
      }
      return status !== 'DELIVERED' && status !== 'DELIVERY_FAILED'
    })
  }, [orders, activeTab])

  return (
    <PageWrapper
      className="page-delivery"
      eyebrow="Delivery"
      title="Delivery dashboard"
      description="Accept tasks, navigate fast, update real-time delivery status, and track your earnings."
    >
      <section className="panel panel-stack">
        <div className="section-head">
          <h2>Last-mile control center</h2>
          <div className="admin-controls-row">
            <label className="field-group" style={{ margin: 0 }}>
              <span className="field-label">Partner status</span>
              <button
                type="button"
                className={`btn ${isOnline ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setIsOnline((current) => !current)}
              >
                {isOnline ? 'Online' : 'Offline'}
              </button>
            </label>
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
            <p>Total deliveries today</p>
            <h3 className="stat-value">{earnings.today_deliveries}</h3>
            <span>Successful drops</span>
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
              {tab === 'ACTIVE' ? 'Active Orders' : tab === 'COMPLETED' ? 'Completed Orders' : 'Failed Orders'}
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
              status: 'OUT_FOR_DELIVERY',
              current_location: shipment.current_location || 'Last mile route',
            }
            const phone = String(order.customer_phone || '').trim()
            const mapsLink = buildMapsLink(order)
            const rawStatus = String(order.status || '').toUpperCase()

            return (
              <article key={order.order_id} className={`section-card panel-stack delivery-order-card ${String(order.status || '').toUpperCase() === 'OUT_FOR_DELIVERY' ? 'delivery-order-card-active' : ''}`}>
                <div className="section-head">
                  <div>
                    <h3>{order.order_id}</h3>
                    <p>{order.customer_name || order.customer_email}</p>
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
                    <p>Rs. {Number(order.order_value || order.total_amount || 0).toFixed(2)}</p>
                  </div>

                  <div className="field-group">
                    <span className="field-label">Navigation</span>
                    <a href={mapsLink} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ width: 'fit-content' }}>
                      Open in Maps
                    </a>
                  </div>
                </div>

                <div className="field-group">
                  <span className="field-label">Delivery progress</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
                    {DELIVERY_STEPS.map((step) => {
                      const stepState = getStepState(order, step)
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
                    <span className="field-label">Status</span>
                    <select
                      className="field"
                      value={draft.status}
                      onChange={(event) => updateDraft(order.order_id, 'status', event.target.value)}
                    >
                      {['OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'].map((statusValue) => (
                        <option key={statusValue} value={statusValue}>
                          {statusValue}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-group">
                    <span className="field-label">Current Location</span>
                    <input
                      className="field"
                      value={draft.current_location}
                      onChange={(event) => updateDraft(order.order_id, 'current_location', event.target.value)}
                    />
                  </label>

                  <div className="field-group">
                    <span className="field-label">Tracking</span>
                    <p>{shipment.tracking_id || 'Pending tracking ID'}</p>
                  </div>

                  <button type="button" className="btn btn-primary" onClick={() => saveStatus(order.order_id)}>
                    Update Status
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => saveStatus(order.order_id, 'ACCEPTED')}
                    disabled={Boolean(order?.delivery_meta?.accepted_at) || rawStatus === 'DELIVERED' || rawStatus === 'DELIVERY_FAILED'}
                  >
                    Accept Order
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => saveStatus(order.order_id, 'PICKED_UP')}
                    disabled={!order?.delivery_meta?.accepted_at || Boolean(order?.delivery_meta?.picked_at) || rawStatus === 'DELIVERED' || rawStatus === 'DELIVERY_FAILED'}
                  >
                    Mark as Picked Up
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => saveStatus(order.order_id, 'OUT_FOR_DELIVERY')}
                    disabled={!order?.delivery_meta?.picked_at || rawStatus === 'OUT_FOR_DELIVERY' || rawStatus === 'DELIVERED' || rawStatus === 'DELIVERY_FAILED'}
                  >
                    Out for Delivery
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => saveStatus(order.order_id, 'DELIVERED')}
                    disabled={rawStatus === 'DELIVERED' || rawStatus === 'DELIVERY_FAILED'}
                  >
                    Mark Delivered
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => saveStatus(order.order_id, 'FAILED')}
                    disabled={rawStatus === 'DELIVERED' || rawStatus === 'DELIVERY_FAILED'}
                  >
                    Mark as Failed
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </PageWrapper>
  )
}
