import { useEffect, useState } from 'react'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const DELIVERY_STATUSES = ['OUT_FOR_DELIVERY', 'DELIVERED']

export default function DeliveryDashboard() {
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)

  const loadOrders = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/delivery/orders`, {
        headers: buildAuthHeaders(),
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
            status: order.status === 'DELIVERED' ? 'DELIVERED' : 'OUT_FOR_DELIVERY',
            current_location: order?.shipment?.current_location || 'Last mile route',
          }
          return accumulator
        }, {}),
      )
      setMessage('')
    } catch {
      setMessage('Unable to load delivery orders.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [])

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
      const response = await fetch(`${API_BASE}/delivery/update-status`, {
        method: 'PUT',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
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
      loadOrders()
    } catch {
      setMessage('Failed to update delivery status.')
    }
  }

  return (
    <PageWrapper
      eyebrow="Delivery"
      title="Delivery dashboard"
      description="View assigned orders and update final mile delivery statuses."
    >
      <section className="panel panel-stack">
        <div className="section-head">
          <h2>Assigned orders</h2>
          <button type="button" className="btn btn-secondary" onClick={loadOrders}>
            Refresh
          </button>
        </div>

        {message ? <p className="wishlist-message">{message}</p> : null}
        {loading ? <p>Loading delivery orders...</p> : null}

        {!loading && orders.length === 0 ? <p>No assigned orders found.</p> : null}

        <div className="admin-orders-stack">
          {orders.map((order) => {
            const shipment = order.shipment || {}
            const draft = drafts[order.order_id] || {
              status: 'OUT_FOR_DELIVERY',
              current_location: shipment.current_location || 'Last mile route',
            }

            return (
              <article key={order.order_id} className="section-card panel-stack">
                <div className="section-head">
                  <div>
                    <h3>{order.order_id}</h3>
                    <p>{order.customer_email}</p>
                  </div>
                  <p>{order.status}</p>
                </div>

                <div className="admin-orders-grid">
                  <label className="field-group">
                    <span className="field-label">Status</span>
                    <select
                      className="field"
                      value={draft.status}
                      onChange={(event) => updateDraft(order.order_id, 'status', event.target.value)}
                    >
                      {DELIVERY_STATUSES.map((statusValue) => (
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
                    onClick={() => saveStatus(order.order_id, 'OUT_FOR_DELIVERY')}
                  >
                    Mark Out for Delivery
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => saveStatus(order.order_id, 'DELIVERED')}
                  >
                    Mark Delivered
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
