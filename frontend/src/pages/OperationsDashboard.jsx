import { useEffect, useState } from 'react'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export default function OperationsDashboard() {
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  const loadOrders = async () => {
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(`${API_BASE}/operations/orders`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setOrders([])
        setMessage(data?.detail || 'Unable to load operations queue.')
        return
      }
      setOrders(Array.isArray(data?.orders) ? data.orders : [])
    } catch {
      setOrders([])
      setMessage('Unable to load operations queue.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [])

  const markPacked = async (orderId) => {
    try {
      const response = await fetch(`${API_BASE}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          status: 'PACKED',
          current_location: 'Warehouse packing unit',
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to mark order as packed.')
        return
      }
      setMessage('Order marked as PACKED and moved to shipment queue.')
      loadOrders()
    } catch {
      setMessage('Unable to mark order as packed.')
    }
  }

  return (
    <PageWrapper
      eyebrow="Operations"
      title="Operations dashboard"
      description="Monitor operational workflows and support teams from a centralized staff view."
    >
      <section className="panel panel-stack">
        <div className="section-head">
          <h2>New orders queue</h2>
          <button type="button" className="btn btn-secondary" onClick={loadOrders}>
            Refresh
          </button>
        </div>

        {message ? <p className="wishlist-message">{message}</p> : null}
        {loading ? <p>Loading order queue...</p> : null}
        {!loading && orders.length === 0 ? <p>No new orders pending packing.</p> : null}

        <div className="admin-orders-stack">
          {orders.map((order) => (
            <article key={order.order_id} className="section-card panel-stack">
              <div className="section-head">
                <div>
                  <h3>{order.order_id}</h3>
                  <p>{order.customer_email}</p>
                </div>
                <p>{order.status}</p>
              </div>

              <div className="admin-orders-grid">
                <div className="field-group">
                  <span className="field-label">Warehouse</span>
                  <p>{order.warehouse_id || 'Auto-assigned warehouse'}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Order total</span>
                  <p>Rs. {Number(order.total_amount || 0).toFixed(2)}</p>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => markPacked(order.order_id)}>
                  Mark Packed
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </PageWrapper>
  )
}
