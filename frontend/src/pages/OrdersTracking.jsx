import { useEffect, useMemo, useState } from 'react'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const TRACKING_STEPS = [
  'PLACED',
  'CONFIRMED',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]

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

export default function OrdersTracking() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

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
      setMessage('')
    } catch {
      setMessage('Unable to load orders right now.')
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

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
      loadOrders()
    } catch {
      setMessage('Unable to cancel order right now.')
    }
  }

  const requestReturn = async (orderId) => {
    try {
      const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/return-request`, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({}),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to request return.')
        return
      }
      setMessage(data?.message || 'Return request submitted successfully.')
      loadOrders()
    } catch {
      setMessage('Unable to request return right now.')
    }
  }

  useEffect(() => {
    loadOrders()
  }, [])

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
      eyebrow="Orders"
      title="Track your shipments"
      description="See every stage from order confirmation to final delivery."
    >
      <section className="panel panel-stack">
        <div className="section-head">
          <h2>My orders</h2>
          <button type="button" className="btn btn-secondary" onClick={loadOrders}>
            Refresh
          </button>
        </div>

        {message ? <p className="wishlist-message">{message}</p> : null}
        {loading ? <p>Loading your orders...</p> : null}
        {!loading && trackedOrders.length === 0 ? <p>No tracked orders yet.</p> : null}

        <div className="admin-orders-stack">
          {trackedOrders.map((order) => (
            <article key={order.order_id} className="section-card panel-stack">
              <div className="section-head">
                <div>
                  <h3>{order.order_id}</h3>
                  <p>{order.customer_email}</p>
                </div>
                <p>{order.current_status}</p>
              </div>

              {order.tracking_id ? (
                <p>
                  Tracking ID: <strong>{order.tracking_id}</strong>
                </p>
              ) : null}

              <div className="tracking-timeline" role="list" aria-label={`Tracking timeline ${order.order_id}`}>
                {order.timeline.map((entry) => (
                  <div key={`${order.order_id}-${entry.step}`} className={`tracking-step tracking-step-${entry.state}`} role="listitem">
                    <span className="tracking-dot" />
                    <p>{entry.step.replaceAll('_', ' ')}</p>
                  </div>
                ))}
              </div>

              {(order.tracking_logs || []).length > 0 ? (
                <div className="summary-row">
                  {(order.tracking_logs || []).map((entry) => (
                    <p key={`${order.order_id}-${entry.id || entry.timestamp}`}>
                      {String(entry.status || '').replaceAll('_', ' ')} · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Updated'}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="row-gap">
                {order.can_cancel ? (
                  <button type="button" className="btn btn-secondary" onClick={() => cancelOrder(order.order_id)}>
                    Cancel Order
                  </button>
                ) : null}
                {order.can_return ? (
                  <button type="button" className="btn btn-secondary" onClick={() => requestReturn(order.order_id)}>
                    Request Return
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </PageWrapper>
  )
}
