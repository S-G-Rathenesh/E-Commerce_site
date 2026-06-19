import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageWrapper from '../components/PageWrapper'
import StatusBadge from '../components/StatusBadge'
import { buildAuthHeaders, clearStoredUser, getStoredUser, setStoredUser } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
// Tabs: MY_ORDERS shows assigned+pincode orders, rest are filtered from combined list
const DELIVERY_TABS = ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'COMPLETED', 'FAILED']
const DELIVERY_FLOW = ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED']

function buildMapsLink(order) {
  const shipping = order?.shipping_details || {}
  // Build the most specific destination possible
  const parts = [
    String(shipping.address || '').trim(),
    String(shipping.city || '').trim(),
    String(shipping.state || '').trim(),
    String(shipping.pincode || order?.destination_pincode || '').trim(),
    'India',
  ].filter(Boolean)
  const destination = parts.length > 1 ? parts.join(', ') : String(order?.delivery_address || order?.destination_pincode || '').trim()
  // Use directions URL with destination= so Google Maps opens turn-by-turn nav from current location
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`
}

function getDeliveryQueueState(order) {
  const status = String(order?.status || '').toUpperCase()
  const shipmentStatus = String(order?.shipment?.status || '').toUpperCase()
  const meta = order?.delivery_meta || {}

  if (status === 'DELIVERED' || shipmentStatus === 'DELIVERED') return 'COMPLETED'
  if (status === 'DELIVERY_FAILED') return 'FAILED'
  if (meta.rejected_at) return 'FAILED'
  if (status === 'OUT_FOR_DELIVERY' || shipmentStatus === 'OUT_FOR_DELIVERY') return 'OUT_FOR_DELIVERY'
  if (
    shipmentStatus === 'ARRIVED_AT_CITY' ||
    shipmentStatus === 'IN_TRANSIT' ||
    shipmentStatus === 'DISPATCHED' ||
    status === 'SHIPPED' ||
    status === 'DISPATCHED' ||
    status === 'PACKED' ||
    status === 'CONFIRMED' ||
    status === 'PLACED'
  ) {
    return 'READY_FOR_PICKUP'
  }
  return 'PENDING'
}

function getFlowState(order, step) {
  const status = String(order?.status || '').toUpperCase()
  const shipmentStatus = String(order?.shipment?.status || '').toUpperCase()
  const completed = {
    READY_FOR_PICKUP:
      ['ARRIVED_AT_CITY', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(shipmentStatus) ||
      ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(status),
    OUT_FOR_DELIVERY:
      shipmentStatus === 'OUT_FOR_DELIVERY' ||
      status === 'OUT_FOR_DELIVERY' ||
      status === 'DELIVERED',
    DELIVERED: shipmentStatus === 'DELIVERED' || status === 'DELIVERED',
  }
  if (!completed[step]) return 'todo'
  if (status === 'DELIVERED' && step === 'DELIVERED') return 'active'
  if (status === 'OUT_FOR_DELIVERY' && step === 'OUT_FOR_DELIVERY') return 'active'
  return 'done'
}

function getOrderTitle(order) {
  return order?.customer_name || order?.customer_email || order?.order_id || 'Delivery order'
}

function getReadyForPickupLabel(order) {
  const shipmentStatus = String(order?.shipment?.status || '').toUpperCase()
  const orderStatus = String(order?.status || '').toUpperCase()
  if (shipmentStatus === 'ARRIVED_AT_CITY') return 'Ready for Pickup'
  if (shipmentStatus === 'IN_TRANSIT') return 'In Transit — Arriving Soon'
  if (shipmentStatus === 'DISPATCHED') return 'Dispatched — On the Way'
  if (orderStatus === 'PACKED') return 'Packed — Awaiting Dispatch'
  if (orderStatus === 'CONFIRMED') return 'Confirmed — Preparing'
  if (orderStatus === 'PLACED') return 'Order Placed'
  return 'Awaiting Pickup'
}

export default function DeliveryDashboard() {
  const navigate = useNavigate()
  // assignedOrders = from /delivery/orders (explicitly assigned to me)
  // pincodeOrders  = from /delivery/pincode-orders (all orders in my coverage area)
  const [assignedOrders, setAssignedOrders] = useState([])
  const [pincodeOrders, setPincodeOrders] = useState([])
  const [earnings, setEarnings] = useState({ today_earnings: 0, today_deliveries: 0, weekly_earnings: 0 })
  const [message, setMessage] = useState('')
  const [drafts, setDrafts] = useState({})
  const [activeTab, setActiveTab] = useState('READY_FOR_PICKUP')
  const [isOnline, setIsOnline] = useState(true)
  const [loading, setLoading] = useState(true)
  const [actionLoadingByOrder, setActionLoadingByOrder] = useState({})

  // Merge assigned + pincode orders, dedup by order_id, assigned takes precedence
  const orders = useMemo(() => {
    const map = new Map()
    for (const o of pincodeOrders) map.set(o.order_id, o)
    for (const o of assignedOrders) map.set(o.order_id, { ...o, assigned_to_me: true })
    return Array.from(map.values())
  }, [assignedOrders, pincodeOrders])

  // ── Auth helpers ──────────────────────────────────────────────────────────
  const refreshAccessToken = async () => {
    const user = getStoredUser()
    const refreshToken = String(user?.refresh_token || '').trim()
    if (!refreshToken) return false
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      const data = await res.json()
      if (!res.ok || !data?.token) return false
      setStoredUser({ ...(user || {}), ...(data?.user || {}), token: data.token, refresh_token: data.refresh_token || refreshToken })
      return true
    } catch {
      return false
    }
  }

  const requestWithAuth = async (url, options = {}) => {
    const headers = buildAuthHeaders(options.headers || {})
    let res = await fetch(url, { ...options, headers, cache: 'no-store' })
    if (res.status !== 401) return res
    const refreshed = await refreshAccessToken()
    if (!refreshed) {
      clearStoredUser()
      navigate('/login', { replace: true })
      throw new Error('Auth expired')
    }
    return fetch(url, { ...options, headers: buildAuthHeaders(options.headers || {}), cache: 'no-store' })
  }

  const validateTokenOnLoad = async () => {
    try {
      const res = await requestWithAuth(`${API_BASE}/auth/me`, { method: 'GET' })
      return res.ok
    } catch { return false }
  }

  // ── Data loaders ──────────────────────────────────────────────────────────
  const loadEarnings = async () => {
    try {
      const res = await requestWithAuth(`${API_BASE}/delivery/earnings`, { method: 'GET' })
      const data = await res.json()
      if (!res.ok) return
      setEarnings({
        today_earnings: Number(data?.today_earnings || 0),
        today_deliveries: Number(data?.today_deliveries || 0),
        weekly_earnings: Number(data?.weekly_earnings || 0),
      })
    } catch { /* keep */ }
  }

  const loadDeliveryProfile = async () => {
    try {
      const res = await requestWithAuth(`${API_BASE}/delivery/profile`, { method: 'GET' })
      const data = await res.json()
      if (!res.ok) return
      const serverUser = data?.user || {}
      const serverProfile = data?.profile_details || {}
      const nextOnline = serverProfile.is_online ?? serverUser.is_online
      if (typeof nextOnline === 'boolean') setIsOnline(nextOnline)
    } catch { /* keep */ }
  }

  const loadOrders = async () => {
    if (!isOnline) { setLoading(false); return }
    setLoading(true)
    try {
      // Fetch both in parallel
      const [assignedRes, pincodeRes] = await Promise.all([
        requestWithAuth(`${API_BASE}/delivery/orders`, { method: 'GET' }),
        requestWithAuth(`${API_BASE}/delivery/pincode-orders`, { method: 'GET' }),
      ])

      const assignedData = await assignedRes.json()
      const pincodeData = await pincodeRes.json()

      if (assignedRes.ok) {
        const next = Array.isArray(assignedData?.orders) ? assignedData.orders : []
        setAssignedOrders(next)
        setDrafts(prev => {
          const updated = { ...prev }
          for (const o of next) {
            if (!updated[o.order_id]) {
              updated[o.order_id] = { current_location: o?.shipment?.current_location || 'Last mile route' }
            }
          }
          return updated
        })
      } else {
        setMessage(assignedData?.detail || 'Unable to load assigned orders.')
      }

      if (pincodeRes.ok) {
        const next = Array.isArray(pincodeData?.orders) ? pincodeData.orders : []
        setPincodeOrders(next)
        setDrafts(prev => {
          const updated = { ...prev }
          for (const o of next) {
            if (!updated[o.order_id]) {
              updated[o.order_id] = { current_location: o?.shipment?.current_location || 'Last mile route' }
            }
          }
          return updated
        })
      }

      if (assignedRes.ok || pincodeRes.ok) setMessage('')
      await loadEarnings()
    } catch {
      setMessage('Unable to load delivery orders.')
    } finally {
      setLoading(false)
    }
  }

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const initialize = async () => {
      const valid = await validateTokenOnLoad()
      if (!valid) { clearStoredUser(); navigate('/login', { replace: true }); return }
      await loadDeliveryProfile()
      loadOrders()
    }
    initialize()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate])

  useEffect(() => {
    if (isOnline) loadOrders()
    else setMessage('You are offline. New delivery tasks will not refresh.')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  useEffect(() => {
    if (!isOnline) return undefined
    const id = setInterval(loadOrders, 15000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  // ── Actions ───────────────────────────────────────────────────────────────
  const updateDraft = (orderId, key, value) => {
    setDrafts(cur => ({ ...cur, [orderId]: { ...(cur[orderId] || {}), [key]: value } }))
  }

  const toggleOnlineStatus = async () => {
    const nextOnline = !isOnline
    setIsOnline(nextOnline)
    try {
      const res = await requestWithAuth(`${API_BASE}/delivery/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_online: nextOnline }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || 'Failed to update online status.')
      if (data?.user) setStoredUser({ ...(getStoredUser() || {}), ...data.user })
      setMessage(nextOnline ? 'You are online and receiving tasks.' : 'You are offline.')
      if (nextOnline) await loadOrders()
    } catch {
      setIsOnline(!nextOnline)
      setMessage('Failed to update online status.')
    }
  }

  const selfAssignOrder = async (orderId) => {
    if (actionLoadingByOrder[orderId]) return
    setActionLoadingByOrder(cur => ({ ...cur, [orderId]: 'assigning' }))
    try {
      const res = await requestWithAuth(`${API_BASE}/delivery/orders/${encodeURIComponent(orderId)}/self-assign`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) { setMessage(data?.detail || 'Failed to assign order.'); return }
      setMessage(`Order ${orderId} assigned to you successfully.`)
      await loadOrders()
    } catch {
      setMessage('Failed to assign order.')
    } finally {
      setActionLoadingByOrder(cur => { const n = { ...cur }; delete n[orderId]; return n })
    }
  }

  const performDeliveryAction = async (orderId, action) => {
    if (actionLoadingByOrder[orderId]) return
    setActionLoadingByOrder(cur => ({ ...cur, [orderId]: action }))

    const draft = drafts[orderId] || {}
    const currentLocation = draft.current_location || 'Last mile route'
    const body = { current_location: currentLocation }

    let endpoint = `${API_BASE}/orders/${encodeURIComponent(orderId)}/start-delivery`
    if (action === 'DELIVERED') endpoint = `${API_BASE}/orders/${encodeURIComponent(orderId)}/delivered`

    try {
      let res = await requestWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // legacy fallback
      if (action !== 'DELIVERED' && res.status === 404) {
        res = await requestWithAuth(`${API_BASE}/orders/${encodeURIComponent(orderId)}/out-for-delivery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      const data = await res.json()
      if (!res.ok) { setMessage(data?.detail || 'Failed to update delivery task.'); return }
      setMessage(data?.message || 'Delivery task updated.')
      await loadOrders()
    } catch {
      setMessage('Failed to update delivery task.')
    } finally {
      setActionLoadingByOrder(cur => { const n = { ...cur }; delete n[orderId]; return n })
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const state = getDeliveryQueueState(o)
      if (activeTab === 'READY_FOR_PICKUP') return state === 'READY_FOR_PICKUP'
      return state === activeTab
    })
  }, [orders, activeTab])

  const stats = useMemo(() => {
    return orders.reduce(
      (acc, o) => {
        const s = getDeliveryQueueState(o)
        acc[s] = (acc[s] || 0) + 1
        return acc
      },
      { READY_FOR_PICKUP: 0, OUT_FOR_DELIVERY: 0, COMPLETED: 0, FAILED: 0 },
    )
  }, [orders])

  // ── Render ────────────────────────────────────────────────────────────────
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
            <p>Showing all orders in your pincode coverage area.</p>
          </div>
          <div className="admin-controls-row">
            <button
              type="button"
              className={`btn ${isOnline ? 'btn-primary' : 'btn-secondary'}`}
              onClick={toggleOnlineStatus}
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
            <h3 className="stat-value">{stats.READY_FOR_PICKUP}</h3>
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
          {DELIVERY_TABS.map((tab) => {
            const label =
              tab === 'READY_FOR_PICKUP' ? 'Ready for Pickup' :
              tab === 'OUT_FOR_DELIVERY' ? 'Out for Delivery' :
              tab === 'COMPLETED' ? 'Completed Orders' : 'Failed Orders'
            return (
              <button
                key={tab}
                type="button"
                className={`tab-button ${activeTab === tab ? 'tab-button-active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {label}
              </button>
            )
          })}
        </div>

        {message ? <p className="wishlist-message">{message}</p> : null}
        {loading ? <p>Loading delivery orders...</p> : null}
        {!loading && filteredOrders.length === 0 ? <p>No orders found in this section.</p> : null}

        <div className="admin-orders-stack">
          {filteredOrders.map((order) => {
            const shipment = order.shipment || {}
            const draft = drafts[order.order_id] || { current_location: shipment.current_location || 'Last mile route' }
            const phone = String(order.customer_phone || '').trim()
            const mapsLink = buildMapsLink(order)
            const status = String(order.status || '').toUpperCase()
            const queueState = getDeliveryQueueState(order)
            const isAssignedToMe = Boolean(order.assigned_to_me)
            const isActionLoading = Boolean(actionLoadingByOrder[order.order_id])

            const shipmentSt = String(order?.shipment?.status || '').toUpperCase()
            const canStart =
              isAssignedToMe &&
              (['ARRIVED_AT_CITY', 'IN_TRANSIT', 'DISPATCHED'].includes(shipmentSt) ||
               ['SHIPPED', 'DISPATCHED', 'PACKED', 'CONFIRMED', 'PLACED'].includes(status))
            const canComplete =
              isAssignedToMe &&
              (status === 'OUT_FOR_DELIVERY' || shipmentSt === 'OUT_FOR_DELIVERY')
            const isDelivered = status === 'DELIVERED'

            return (
              <article
                key={order.order_id}
                className={`section-card panel-stack delivery-order-card ${queueState === 'OUT_FOR_DELIVERY' ? 'delivery-order-card-active' : ''}`}
              >
                <div className="section-head">
                  <div>
                    <h3>{order.order_id}</h3>
                    <p>{getOrderTitle(order)}</p>
                    <p>{getReadyForPickupLabel(order)}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <StatusBadge status={order.status} />
                    {isAssignedToMe ? (
                      <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>✔ Assigned to you</span>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#9ca3af' }}>In your coverage area</span>
                    )}
                  </div>
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
                              stepState === 'active' ? '#dbeafe' :
                              stepState === 'done' ? '#dcfce7' : '#f3f4f6',
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
                      onChange={(e) => updateDraft(order.order_id, 'current_location', e.target.value)}
                      placeholder="Last mile route"
                    />
                  </label>
                  <div className="field-group">
                    <span className="field-label">Tracking</span>
                    <p>{shipment.tracking_id || 'Pending tracking ID'}</p>
                  </div>

                  {/* Not assigned to me yet — show Accept button */}
                  {!isAssignedToMe && !isDelivered ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => selfAssignOrder(order.order_id)}
                      disabled={isActionLoading}
                    >
                      {isActionLoading ? 'Accepting...' : 'Accept Order'}
                    </button>
                  ) : null}

                  {/* Assigned + ready for pickup */}
                  {isAssignedToMe && !isDelivered && queueState === 'READY_FOR_PICKUP' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => performDeliveryAction(order.order_id, 'START_DELIVERY')}
                      disabled={!canStart || isActionLoading}
                    >
                      {isActionLoading ? 'Starting...' : 'Start Delivery'}
                    </button>
                  ) : null}

                  {/* Out for delivery — mark delivered */}
                  {canComplete ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => performDeliveryAction(order.order_id, 'DELIVERED')}
                      disabled={isActionLoading}
                    >
                      {isActionLoading ? 'Updating...' : 'Mark Delivered'}
                    </button>
                  ) : null}

                  {isDelivered ? (
                    <button type="button" className="btn btn-secondary" disabled>
                      ✔ Delivered
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
