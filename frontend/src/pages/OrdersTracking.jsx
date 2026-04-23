import { useEffect, useMemo, useState, useRef } from 'react'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders } from '../utils/auth'
import { getSlaState } from '../utils/adminUi'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const WS_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace('http', 'ws')

const TRACKING_STEPS = [
  'PLACED',
  'CONFIRMED',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]

const TRACKING_OVERVIEW_STEPS = ['CONFIRMED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']

const TRACKING_CARD_STEPS = [
  { key: 'PLACED', label: 'Order Placed' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'PACKED', label: 'Packed' },
  { key: 'SHIPPED', label: 'Shipped' },
  { key: 'DELIVERY', label: 'Delivery' },
]

const STATUS_MESSAGES = {
  'PLACED': '📝 Order Placed',
  'CONFIRMED': '✅ Order Confirmed',
  'PACKED': '📦 Order Packed',
  'SHIPPED': '🚚 Order Shipped',
  'OUT_FOR_DELIVERY': '🚚 Out for Delivery',
  'DELIVERED': '✅ Order Delivered',
  'CANCELLED': '❌ Order Cancelled',
  'DELIVERY_FAILED': '⚠️ Delivery Failed',
}

const STATUS_PERFORMER_ROLE_MAP = {
  CONFIRMED: ['ADMIN'],
  PACKED: ['OPERATIONS_STAFF'],
  SHIPPED: ['ADMIN'],
  OUT_FOR_DELIVERY: ['DELIVERY_ASSOCIATE'],
  DELIVERED: ['DELIVERY_ASSOCIATE'],
}

function formatOrderDate(value, fallback = 'Date unavailable') {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) {
    return fallback
  }
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatFriendlyDate(value, fallback = 'Today') {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) {
    return fallback
  }
  return date.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
  })
}

function getProgressState(stepKey, status) {
  const current = String(status || '').trim().toUpperCase()

  if (stepKey === 'CONFIRMED') {
    if (['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(current)) {
      return ['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(current) ? 'completed' : 'active'
    }
    return 'pending'
  }

  if (stepKey === 'PACKED') {
    if (['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(current)) {
      return ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(current) ? 'completed' : 'active'
    }
    return 'pending'
  }

  if (stepKey === 'SHIPPED') {
    if (['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(current)) {
      return ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(current) ? 'completed' : 'active'
    }
    return 'pending'
  }

  if (stepKey === 'DELIVERY') {
    if (current === 'DELIVERED') {
      return 'completed'
    }
    if (current === 'OUT_FOR_DELIVERY') {
      return 'active'
    }
    return 'pending'
  }

  return 'pending'
}

function getTrackingSummary(order, slaLabel) {
  const current = String(order.status || '').trim().toUpperCase()
  const currentLocation = String(order?.shipment?.current_location || '').trim()
  const shippedTime = order?.status_timestamps?.SHIPPED || order?.shipment?.updated_at || order?.updated_at

  if (current === 'SHIPPED') {
    return {
      title: 'Shipped',
      detail: `Today, ${formatFriendlyDate(shippedTime)}: Product has left the ${currentLocation || 'origin'} facility.`,
      badge: slaLabel,
    }
  }

  if (current === 'OUT_FOR_DELIVERY') {
    return {
      title: 'Out For Delivery',
      detail: `Today, ${formatFriendlyDate(order?.updated_at)}: Your package is out for delivery.`,
      badge: slaLabel,
    }
  }

  if (current === 'DELIVERED') {
    return {
      title: 'Delivered',
      detail: `Delivered on ${formatFriendlyDate(order?.status_timestamps?.DELIVERED || order?.updated_at)}.`,
      badge: 'Delivered',
    }
  }

  return {
    title: String(current || 'PLACED').replaceAll('_', ' '),
    detail: `Order placed on ${formatOrderDate(order?.created_at, 'today')}.`,
    badge: slaLabel,
  }
}

function resolveStepState(step, currentStatus, completedSet) {
  if (completedSet.has(step)) {
    return step === currentStatus ? 'active' : 'completed'
  }

  const currentIndex = TRACKING_STEPS.indexOf(currentStatus)
  const stepIndex = TRACKING_STEPS.indexOf(step)

  if (stepIndex < currentIndex) {
    return 'completed'
  }

  if (stepIndex === currentIndex) {
    return 'active'
  }

  return 'pending'
}

function getHistoryByStatus(order) {
  const history = Array.isArray(order?.status_history) ? order.status_history : []
  return history.reduce((accumulator, entry) => {
    const key = String(entry?.status || '').trim().toUpperCase()
    if (key) {
      accumulator[key] = entry
    }
    return accumulator
  }, {})
}

function getStepTimestamp(order, step) {
  const timestamps = order?.status_timestamps || {}
  const fromMap = timestamps?.[step]
  if (fromMap) {
    return fromMap
  }
  const historyByStatus = getHistoryByStatus(order)
  return historyByStatus?.[step]?.timestamp || ''
}

function mapStatusToCardStepIndex(status) {
  const current = String(status || '').trim().toUpperCase()

  if (current === 'PLACED') {
    return 0
  }
  if (current === 'CONFIRMED') {
    return 1
  }
  if (current === 'PACKED') {
    return 2
  }
  if (current === 'SHIPPED') {
    return 3
  }
  if (current === 'OUT_FOR_DELIVERY' || current === 'DELIVERED') {
    return 4
  }
  return 0
}

function formatStepTimestamp(value, options = {}) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) {
    return options.fallback || 'Pending'
  }

  if (options.todayLabel) {
    const now = new Date()
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    if (isToday) {
      return 'Today'
    }
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getDeliveryEta(order) {
  const shippedAt = getStepTimestamp(order, 'SHIPPED') || getStepTimestamp(order, 'PACKED') || order?.updated_at
  const baseDate = new Date(shippedAt || '')
  if (Number.isNaN(baseDate.getTime())) {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return `Expected ${tomorrow.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
  }

  baseDate.setDate(baseDate.getDate() + 1)
  return `Expected ${baseDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
}

function shouldApplyStatusUpdate(previousStatus, nextStatus, performerRole) {
  const current = String(previousStatus || '').trim().toUpperCase()
  const target = String(nextStatus || '').trim().toUpperCase()
  const role = String(performerRole || '').trim().toUpperCase()
  const allowedRoles = STATUS_PERFORMER_ROLE_MAP[target]

  if (!target || current === target) {
    return false
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return false
  }

  const currentIndex = TRACKING_STEPS.indexOf(current)
  const targetIndex = TRACKING_STEPS.indexOf(target)

  if (currentIndex === -1 || targetIndex === -1) {
    return true
  }

  return targetIndex === currentIndex + 1
}

export default function OrdersTracking() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [message, setMessage] = useState('')
  const [activeReturnFormOrderId, setActiveReturnFormOrderId] = useState('')
  const [returnDrafts, setReturnDrafts] = useState({})
  const [notifications, setNotifications] = useState([])
  const [recentStatusUpdates, setRecentStatusUpdates] = useState({})
  const wsRef = useRef(null)
  const userIdRef = useRef(null)
  const notificationTimeoutRef = useRef({})

  const getReturnDraft = (orderId) => {
    return (
      returnDrafts[orderId] || {
        reason: '',
        issue_details: '',
        proof_images: [],
      }
    )
  }

  const loadOrders = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/orders/my`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()

      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load orders.')
        setOrders([])
        return
      }

      setOrders(Array.isArray(data?.orders) ? data.orders : [])
      setLastUpdatedAt(new Date().toISOString())
      setMessage('')
    } catch {
      setMessage('Unable to load orders right now.')
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  const addNotification = (title, message, duration = 5000) => {
    const id = `notif-${Date.now()}-${Math.random()}`
    setNotifications((prev) => [
      ...prev,
      {
        id,
        title,
        message,
        timestamp: new Date(),
      },
    ])

    if (notificationTimeoutRef.current[id]) {
      clearTimeout(notificationTimeoutRef.current[id])
    }

    notificationTimeoutRef.current[id] = setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
      delete notificationTimeoutRef.current[id]
    }, duration)
  }

  const handleOrderStatusUpdate = (event) => {
    const { order_id, new_status, previous_status, message: statusMessage } = event.data

    if (!shouldApplyStatusUpdate(previous_status, new_status, event.data?.performer_role)) {
      return
    }
    
    // Update the order status in local state
    setOrders((prevOrders) =>
      prevOrders.map((order) =>
        order.order_id === order_id
          ? { ...order, status: new_status }
          : order
      )
    )

    // Add animation for status transition
    setRecentStatusUpdates((prev) => ({
      ...prev,
      [order_id]: new_status,
    }))

    // Clear animation after 1 second
    setTimeout(() => {
      setRecentStatusUpdates((prev) => {
        const updated = { ...prev }
        delete updated[order_id]
        return updated
      })
    }, 1000)

    // Show notification
    const title = STATUS_MESSAGES[new_status] || `Status: ${new_status}`
    addNotification(
      title,
      statusMessage || `Order ${order_id} has been updated to ${new_status.replace(/_/g, ' ')}`,
      6000
    )
  }

  const connectWebSocket = (userId) => {
    if (!userId) return

    try {
      const wsUrl = `${WS_BASE}/ws/orders/${encodeURIComponent(userId)}`
      wsRef.current = new WebSocket(wsUrl)

      wsRef.current.onopen = () => {
        console.log('WebSocket connected for real-time order updates')
      }

      wsRef.current.onmessage = (event) => {
        try {
          const eventData = JSON.parse(event.data)
          if (eventData.type === 'order_status_updated') {
            handleOrderStatusUpdate(eventData)
          } else if (eventData.type === 'notification') {
            const notif = eventData.data
            addNotification(
              notif.title || STATUS_MESSAGES[notif.event_type] || 'Order Update',
              notif.message,
              6000
            )
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e)
        }
      }

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error)
      }

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected')
        // Reconnect after 3 seconds
        setTimeout(() => {
          if (userIdRef.current) {
            connectWebSocket(userIdRef.current)
          }
        }, 3000)
      }
    } catch (error) {
      console.error('Failed to connect WebSocket:', error)
    }
  }

  const extractUserIdFromToken = () => {
    try {
      const token = localStorage.getItem('access_token')
      if (!token) return null
      
      const parts = token.split('.')
      if (parts.length !== 3) return null
      
      const decoded = JSON.parse(atob(parts[1]))
      return decoded.sub || decoded.user_id || decoded.id || decoded.email
    } catch {
      return null
    }
  }

  useEffect(() => {
    loadOrders()
    
    // Initialize WebSocket connection for real-time updates
    const userId = extractUserIdFromToken()
    if (userId) {
      userIdRef.current = userId
      connectWebSocket(userId)
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
      Object.values(notificationTimeoutRef.current).forEach((timeout) =>
        clearTimeout(timeout)
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancelOrder = async (orderId) => {
    try {
      const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'PUT',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({}),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to cancel order.')
        return
      }
      setMessage(data?.message || 'Order cancelled successfully.')
      addNotification('Order Cancelled', `Order ${orderId} has been cancelled`)
      loadOrders()
    } catch {
      setMessage('Unable to cancel order right now.')
    }
  }

  const handleReturnProofUpload = (orderId, fileList) => {
    const files = Array.from(fileList || []).slice(0, 3)
    if (!files.length) {
      return
    }

    const readers = files.map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = (event) => {
            resolve(String(event.target?.result || '').trim())
          }
          reader.onerror = () => resolve('')
          reader.readAsDataURL(file)
        }),
    )

    Promise.all(readers).then((images) => {
      const normalized = images.filter(Boolean).slice(0, 3)
      setReturnDrafts((current) => ({
        ...current,
        [orderId]: {
          ...getReturnDraft(orderId),
          proof_images: normalized,
        },
      }))
    })
  }

  const requestReturn = async (orderId) => {
    const draft = getReturnDraft(orderId)
    try {
      const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/return-request`, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          reason: draft.reason,
          issue_details: draft.issue_details,
          proof_images: draft.proof_images,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to request return.')
        return
      }
      setMessage(data?.message || 'Return request submitted successfully.')
      addNotification('Return Requested', 'Your return request has been submitted')
      setActiveReturnFormOrderId('')
      loadOrders()
    } catch {
      setMessage('Unable to request return right now.')
    }
  }

  const trackedOrders = useMemo(() => {
    return orders.map((order) => ({
      ...order,
      current_status: order.status,
      tracking_id: order?.shipment?.tracking_id || '',
      can_cancel: ['PLACED', 'CONFIRMED', 'PACKED'].includes(String(order.status || '').toUpperCase()),
      can_return:
        String(order.status || '').toUpperCase() === 'DELIVERED' &&
        !(order.return_request && String(order.return_request.status || '').trim()),
      timeline: TRACKING_STEPS.map((step) => ({
        step,
        state: resolveStepState(
          step,
          order.status,
          new Set((order.tracking_logs || []).map((entry) => String(entry.status || '').toUpperCase())),
        ),
      })),
    }))
  }, [orders])

  return (
    <PageWrapper
      className="page-customer page-tracking"
      eyebrow="Orders"
      title="Track your shipments"
      description="See every stage from order confirmation to final delivery."
    >
      {/* Notification Toast Container */}
      <div className="tracking-toast-stack">
        {notifications.map((notif) => (
          <div key={notif.id} className="tracking-toast tracking-toast-success">
            <p>
              {notif.title}
            </p>
            <p>
              {notif.message}
            </p>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        .tracking-step {
          transition: all 0.3s ease;
        }
        
        .tracking-step.updating {
          animation: pulse 0.6s ease;
        }
        
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
      `}</style>

      <section className="panel panel-stack">
        <div className="section-head">
          <h2>My orders</h2>
          <button type="button" className="btn btn-secondary" onClick={loadOrders}>
            Refresh
          </button>
        </div>

        {lastUpdatedAt ? <p style={{ fontSize: '13px', color: '#6b7280' }}>Last synced: {new Date(lastUpdatedAt).toLocaleTimeString()}</p> : null}

        {message ? <p className="wishlist-message">{message}</p> : null}
        {loading ? <p>Loading your orders...</p> : null}
        {!loading && trackedOrders.length === 0 ? <p>No tracked orders yet.</p> : null}

        <div className="admin-orders-stack">
          {trackedOrders.map((order) => (
            <article key={order.order_id} className={`section-card panel-stack tracking-order-card tracking-order-card-compact ${recentStatusUpdates[order.order_id] ? 'tracking-order-card-updating' : ''}`}>
              {(() => {
                const currentStatus = String(order.current_status || '').trim().toUpperCase()
                const overviewIndex = TRACKING_OVERVIEW_STEPS.indexOf(currentStatus)
                const timelineEvents = [
                  ...(Array.isArray(order.status_history) ? order.status_history : []),
                  ...(Array.isArray(order.tracking_logs) ? order.tracking_logs : []),
                ]
                  .map((entry) => ({
                    status: String(entry?.status || '').trim().toUpperCase(),
                    timestamp: entry?.timestamp || '',
                    location: entry?.location || '',
                    updatedByRole: entry?.updated_by_role || entry?.performer_role || '',
                  }))
                  .filter((entry) => entry.status)
                  .sort((first, second) => String(first.timestamp).localeCompare(String(second.timestamp)))

                const header = getTrackingSummary(order, getSlaState(order).label)
                const etaText = getDeliveryEta(order).replace(/^Expected\s+/i, 'Expected delivery: ')

                return (
                  <>
                    <div className="tracking-card-head tracking-card-head-compact">
                      <div>
                        <h3>{header.title}</h3>
                        <p className="tracking-order-message">{header.detail}</p>
                        <p className="tracking-order-meta">{etaText}</p>
                        <p className="tracking-order-meta">Order ID: {order.order_id}</p>
                      </div>
                      <span className={`tracking-status-chip ${currentStatus === 'DELIVERED' ? 'tracking-status-chip-delivered' : ''}`}>
                        {currentStatus ? currentStatus.replaceAll('_', ' ') : 'PLACED'}
                      </span>
                    </div>

                    <section className="tracking-progress-shell" aria-label={`Tracking timeline ${order.order_id}`}>
                      <div className="tracking-progress-line" aria-hidden="true">
                        <span className="tracking-progress-fill" style={{ width: `${Math.max(0, (Math.max(0, overviewIndex) / (TRACKING_OVERVIEW_STEPS.length - 1)) * 100)}%` }} />
                      </div>
                      <div className="tracking-progress-steps" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                        {TRACKING_OVERVIEW_STEPS.map((step, index) => {
                          const isCompleted = overviewIndex > index
                          const isCurrent = overviewIndex === index
                          return (
                            <div
                              key={`${order.order_id}-step-${step}`}
                              className={`tracking-progress-step ${isCompleted ? 'tracking-progress-step-completed' : ''} ${isCurrent ? 'tracking-progress-step-active' : ''}`}
                            >
                              <span className="tracking-progress-dot" aria-hidden="true">
                                {isCompleted ? '✓' : isCurrent ? '●' : '○'}
                              </span>
                              <span className="tracking-progress-label-wrap">
                                <span>{step.replaceAll('_', ' ')}</span>
                                <span className="tracking-progress-time">
                                  {formatStepTimestamp(getStepTimestamp(order, step), { fallback: index === 0 ? formatStepTimestamp(order.created_at, { fallback: 'Pending' }) : 'Pending', todayLabel: step === 'SHIPPED' || step === 'OUT_FOR_DELIVERY' })}
                                </span>
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </section>

                    <div className="tracking-delivery-info">
                      {currentStatus === 'SHIPPED' ? (
                        <p>Product has left the facility.</p>
                      ) : currentStatus === 'OUT_FOR_DELIVERY' ? (
                        <p>Product is on the way to the customer.</p>
                      ) : currentStatus === 'DELIVERED' ? (
                        <p>Product has been delivered successfully.</p>
                      ) : (
                        <p>Tracking will update after the shipment is dispatched.</p>
                      )}
                    </div>

                    <details className="tracking-details-accordion">
                      <summary>Tracking Details</summary>
                      <div className="tracking-details-list">
                        {timelineEvents.length > 0 ? (
                          timelineEvents.map((entry, index) => (
                            <div key={`${order.order_id}-timeline-event-${index}`} className="tracking-details-row">
                              <span className="tracking-details-time">{formatStepTimestamp(entry.timestamp, { fallback: 'Updated' })}</span>
                              <span className="tracking-details-status">{String(entry.status).replaceAll('_', ' ')}</span>
                              <span className="tracking-details-meta">
                                {entry.location ? ` · ${entry.location}` : ''}
                                {entry.updatedByRole ? ` · ${entry.updatedByRole}` : ''}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="tracking-details-empty">No tracking events available yet.</p>
                        )}
                      </div>
                    </details>

                    <section className="tracking-payment-line">
                      <p>Payment method: {String(order?.payment?.method || order.payment_method || 'COD').replaceAll('_', ' ')}</p>
                      <p>Status: {String(order?.payment?.status || 'PENDING').replaceAll('_', ' ')}</p>
                      {String(order?.payment?.method || order.payment_method || 'COD').toUpperCase() === 'COD' ? (
                        <p>Payment will be collected on delivery.</p>
                      ) : order?.payment?.payment_id ? (
                        <p>Payment ID: {order.payment.payment_id}</p>
                      ) : null}
                    </section>

                    {order.tracking_id ? (
                      <p className="tracking-order-meta">Tracking ID: <strong>{order.tracking_id}</strong></p>
                    ) : null}
                  </>
                )
              })()}

              <div className="row-gap">
                {order.can_cancel ? (
                  <button type="button" className="btn btn-secondary" onClick={() => cancelOrder(order.order_id)}>
                    Cancel Order
                  </button>
                ) : null}
                {order.can_return ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        setActiveReturnFormOrderId((current) => (current === order.order_id ? '' : order.order_id))
                      }
                    >
                      {activeReturnFormOrderId === order.order_id ? 'Hide Return Form' : 'Request Return'}
                    </button>

                    {activeReturnFormOrderId === order.order_id ? (
                      <section className="section-card panel-stack tracking-subcard">
                        <label className="field-group">
                          <span className="field-label">Return reason</span>
                          <input
                            className="field"
                            value={getReturnDraft(order.order_id).reason}
                            onChange={(event) =>
                              setReturnDrafts((current) => ({
                                ...current,
                                [order.order_id]: {
                                  ...getReturnDraft(order.order_id),
                                  reason: event.target.value,
                                },
                              }))
                            }
                            placeholder="Example: Damaged item"
                          />
                        </label>

                        <label className="field-group">
                          <span className="field-label">Issue details</span>
                          <textarea
                            className="field"
                            rows={3}
                            value={getReturnDraft(order.order_id).issue_details}
                            onChange={(event) =>
                              setReturnDrafts((current) => ({
                                ...current,
                                [order.order_id]: {
                                  ...getReturnDraft(order.order_id),
                                  issue_details: event.target.value,
                                },
                              }))
                            }
                            placeholder="Describe what issue you found"
                          />
                        </label>

                        <label className="field-group">
                          <span className="field-label">Upload proof images (up to 3)</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="field"
                            onChange={(event) => handleReturnProofUpload(order.order_id, event.target.files)}
                          />
                        </label>

                        {(getReturnDraft(order.order_id).proof_images || []).length > 0 ? (
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {(getReturnDraft(order.order_id).proof_images || []).map((image, index) => (
                              <img
                                key={`${order.order_id}-draft-proof-${index + 1}`}
                                src={image}
                                alt={`Return proof preview ${index + 1}`}
                                style={{
                                  width: '72px',
                                  height: '72px',
                                  objectFit: 'cover',
                                  borderRadius: '8px',
                                  border: '1px solid #d1d5db',
                                }}
                              />
                            ))}
                          </div>
                        ) : null}

                        <button type="button" className="btn btn-primary" onClick={() => requestReturn(order.order_id)}>
                          Submit Return Request
                        </button>
                      </section>
                    ) : null}
                  </>
                ) : null}
              </div>

              {order.return_request ? (
                <section className="section-card panel-stack tracking-subcard">
                  <p className="field-label">Return request</p>
                  <p>Status: {String(order.return_request.status || '').replaceAll('_', ' ')}</p>
                  {order.return_request.reason ? <p>Reason: {order.return_request.reason}</p> : null}
                  {order.return_request.issue_details ? <p>Details: {order.return_request.issue_details}</p> : null}
                </section>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </PageWrapper>
  )
}
