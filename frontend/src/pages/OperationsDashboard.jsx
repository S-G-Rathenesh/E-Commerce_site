import { useEffect, useState } from 'react'
import PageWrapper from '../components/PageWrapper'
import StatusBadge from '../components/StatusBadge'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

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

export default function OperationsDashboard() {
  const [orders, setOrders] = useState([])
  const [shipments, setShipments] = useState([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [dispatchingShipmentId, setDispatchingShipmentId] = useState('')

  const loadData = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [ordersResponse, shipmentsResponse] = await Promise.all([
        fetch(`${API_BASE}/operations/orders`, { headers: buildAuthHeaders() }),
        fetch(`${API_BASE}/operations/shipments`, { headers: buildAuthHeaders() }),
      ])

      const [ordersData, shipmentsData] = await Promise.all([
        ordersResponse.json(),
        shipmentsResponse.json(),
      ])

      if (!ordersResponse.ok) {
        setOrders([])
        setMessage(ordersData?.detail || 'Unable to load orders waiting for packing.')
      } else {
        setOrders(Array.isArray(ordersData?.orders) ? ordersData.orders : [])
      }

      if (!shipmentsResponse.ok) {
        setShipments([])
        if (!message) {
          setMessage(shipmentsData?.detail || 'Unable to load shipments.')
        }
      } else {
        setShipments(Array.isArray(shipmentsData?.shipments) ? shipmentsData.shipments : [])
      }
    } catch {
      setOrders([])
      setShipments([])
      setMessage('Unable to load operations data right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const markPacked = async (orderId) => {
    try {
      const response = await fetch(`${API_BASE}/orders/${orderId}/pack`, {
        method: 'PATCH',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          current_location: 'Warehouse packing unit',
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to mark order as packed.')
        return
      }
      setMessage(data?.message || 'Order packed successfully. Shipment created and dispatched automatically.')
      loadData()
    } catch {
      setMessage('Unable to mark order as packed.')
    }
  }

  const dispatchShipment = async (shipmentId) => {
    if (dispatchingShipmentId === shipmentId) {
      return
    }
    setDispatchingShipmentId(shipmentId)
    try {
      const response = await fetch(`${API_BASE}/shipments/${encodeURIComponent(shipmentId)}/dispatch`, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          current_location: 'Operations dispatch bay',
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Failed to dispatch shipment.')
        return
      }

      setMessage(data?.message || 'Shipment dispatched.')
      loadData()
    } catch {
      setMessage('Failed to dispatch shipment.')
    } finally {
      setDispatchingShipmentId('')
    }
  }

  return (
    <PageWrapper
      className="page-operations"
      eyebrow="Operations"
      title="Operations dashboard"
      description="Monitor and pack orders. Shipments are automatically created and dispatched when orders are packed."
    >
      <section className="panel panel-stack">
        <div className="section-head">
          <div>
            <h2>Packing queue</h2>
            <p>Mark orders as packed - shipments will be created and dispatched automatically.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={loadData}>
            Refresh
          </button>
        </div>

        {message ? <p className="wishlist-message">{message}</p> : null}
        {loading ? <p>Loading operations data...</p> : null}
        {!loading && orders.length === 0 ? <p>No orders waiting for packing.</p> : null}

        <div className="admin-orders-stack">
          {orders.map((order) => (
            <article key={order.order_id} className="section-card panel-stack">
              <div className="section-head">
                <div>
                  <h3>{order.order_id}</h3>
                  <p>{order.customer_email}</p>
                  <p>Placed: {formatDateTime(order.created_at)}</p>
                </div>
                <StatusBadge status={order.status} />
              </div>

              <div className="admin-orders-grid">
                <div className="field-group">
                  <span className="field-label">Warehouse</span>
                  <p>{order.warehouse_id || 'Auto-assigned warehouse'}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Order total</span>
                  <p>Rs. {Number(order.total_amount || order.order_value || 0).toLocaleString('en-IN')}</p>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => markPacked(order.order_id)}>
                  Mark Packed
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="section-head">
          <div>
            <h2>Shipment list</h2>
            <p>View auto-created and auto-dispatched shipments. Shipments are created and dispatched automatically when orders are packed.</p>
          </div>
        </div>

        <div className="admin-orders-stack">
          {shipments.length === 0 ? <p>No shipments created yet.</p> : null}
          {shipments.map((shipment) => (
            <article key={shipment.shipment_id} className="section-card panel-stack">
              <div className="section-head">
                <div>
                  <h3>{shipment.shipment_id}</h3>
                  <p>{shipment.destination || [shipment.destination_city, shipment.destination_state].filter(Boolean).join(', ') || 'Destination pending'}</p>
                  <p>{shipment.vehicle_type || 'VAN'}</p>
                </div>
                <StatusBadge status={shipment.status} />
              </div>

              <div className="admin-orders-grid">
                <div className="field-group">
                  <span className="field-label">Created at</span>
                  <p>{formatDateTime(shipment.created_at)}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Orders</span>
                  <p>{shipment.order_count || 0}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Courier</span>
                  <p>{shipment.courier_name || 'Not assigned'}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Tracking ID</span>
                  <p>{shipment.tracking_id || 'Pending'}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Status</span>
                  <p style={{ color: '#10b981', fontWeight: '500' }}>
                    {String(shipment.status || '').toUpperCase() === 'DISPATCHED' 
                      ? '✓ Auto-dispatched' 
                      : String(shipment.status || 'CREATED').replace('_', ' ')}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </PageWrapper>
  )
}
