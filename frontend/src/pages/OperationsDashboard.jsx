import { useEffect, useMemo, useState } from 'react'
import PageWrapper from '../components/PageWrapper'
import StatusBadge from '../components/StatusBadge'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const VEHICLE_TYPES = ['TRUCK', 'VAN', 'BIKE']

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
  const [packedOrders, setPackedOrders] = useState([])
  const [shipments, setShipments] = useState([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedPackedOrders, setSelectedPackedOrders] = useState([])
  const [shipmentForm, setShipmentForm] = useState({
    destination_state: '',
    destination_city: '',
    vehicle_type: 'VAN',
    shipment_notes: '',
  })
  const [dispatchingShipmentId, setDispatchingShipmentId] = useState('')

  const loadData = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [ordersResponse, packedResponse, shipmentsResponse] = await Promise.all([
        fetch(`${API_BASE}/operations/orders`, { headers: buildAuthHeaders() }),
        fetch(`${API_BASE}/operations/packed-orders`, { headers: buildAuthHeaders() }),
        fetch(`${API_BASE}/operations/shipments`, { headers: buildAuthHeaders() }),
      ])

      const [ordersData, packedData, shipmentsData] = await Promise.all([
        ordersResponse.json(),
        packedResponse.json(),
        shipmentsResponse.json(),
      ])

      if (!ordersResponse.ok) {
        setOrders([])
        setMessage(ordersData?.detail || 'Unable to load orders waiting for packing.')
      } else {
        setOrders(Array.isArray(ordersData?.orders) ? ordersData.orders : [])
      }

      if (!packedResponse.ok) {
        setPackedOrders([])
        if (!message) {
          setMessage(packedData?.detail || 'Unable to load packed orders.')
        }
      } else {
        const nextPackedOrders = Array.isArray(packedData?.orders) ? packedData.orders : []
        setPackedOrders(nextPackedOrders)
        setSelectedPackedOrders((current) => current.filter((orderId) => nextPackedOrders.some((order) => order.order_id === orderId)))
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
      setPackedOrders([])
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
      setMessage(data?.message || 'Order marked as PACKED.')
      loadData()
    } catch {
      setMessage('Unable to mark order as packed.')
    }
  }

  const togglePackedSelection = (orderId) => {
    setSelectedPackedOrders((current) =>
      current.includes(orderId) ? current.filter((item) => item !== orderId) : [...current, orderId],
    )
  }

  const toggleAllPacked = () => {
    if (selectedPackedOrders.length === packedOrders.length) {
      setSelectedPackedOrders([])
      return
    }
    setSelectedPackedOrders(packedOrders.map((order) => order.order_id))
  }

  const createShipment = async () => {
    if (!selectedPackedOrders.length) {
      setMessage('Select one or more packed orders to create a shipment.')
      return
    }

    if (!shipmentForm.destination_state.trim() || !shipmentForm.destination_city.trim()) {
      setMessage('Destination state and city are required.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/shipments`, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          order_ids: selectedPackedOrders,
          destination_state: shipmentForm.destination_state,
          destination_city: shipmentForm.destination_city,
          vehicle_type: shipmentForm.vehicle_type,
          shipment_notes: shipmentForm.shipment_notes,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Failed to create shipment.')
        return
      }

      setMessage(data?.message || 'Shipment created successfully.')
      setSelectedPackedOrders([])
      setShipmentForm({
        destination_state: '',
        destination_city: '',
        vehicle_type: 'VAN',
        shipment_notes: '',
      })
      loadData()
    } catch {
      setMessage('Failed to create shipment.')
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

  const packedOrderCount = useMemo(() => packedOrders.length, [packedOrders.length])

  return (
    <PageWrapper
      className="page-operations"
      eyebrow="Operations"
      title="Operations dashboard"
      description="Monitor packing, create shipments from packed orders, and dispatch them into the delivery network."
    >
      <section className="panel panel-stack">
        <div className="section-head">
          <div>
            <h2>Packing queue</h2>
            <p>Confirm orders, then move them into the shipment builder.</p>
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
            <h2>Create shipment</h2>
            <p>Select packed orders and group them into a shipment.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={toggleAllPacked} disabled={packedOrderCount === 0}>
            {selectedPackedOrders.length === packedOrderCount && packedOrderCount > 0 ? 'Clear selection' : 'Select all packed'}
          </button>
        </div>

        <div className="admin-orders-grid">
          <label className="field-group">
            <span className="field-label">Destination state</span>
            <input
              className="field"
              value={shipmentForm.destination_state}
              onChange={(event) => setShipmentForm((current) => ({ ...current, destination_state: event.target.value }))}
              placeholder="Karnataka"
            />
          </label>
          <label className="field-group">
            <span className="field-label">Destination city</span>
            <input
              className="field"
              value={shipmentForm.destination_city}
              onChange={(event) => setShipmentForm((current) => ({ ...current, destination_city: event.target.value }))}
              placeholder="Bengaluru"
            />
          </label>
          <label className="field-group">
            <span className="field-label">Vehicle type</span>
            <select
              className="field"
              value={shipmentForm.vehicle_type}
              onChange={(event) => setShipmentForm((current) => ({ ...current, vehicle_type: event.target.value }))}
            >
              {VEHICLE_TYPES.map((vehicleType) => (
                <option key={vehicleType} value={vehicleType}>
                  {vehicleType}
                </option>
              ))}
            </select>
          </label>
          <label className="field-group">
            <span className="field-label">Shipment notes</span>
            <textarea
              className="field"
              rows={3}
              value={shipmentForm.shipment_notes}
              onChange={(event) => setShipmentForm((current) => ({ ...current, shipment_notes: event.target.value }))}
              placeholder="Optional notes for dispatch and handling"
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={createShipment} disabled={packedOrderCount === 0}>
            Create Shipment
          </button>
        </div>

        <div className="admin-orders-stack">
          {packedOrders.length === 0 ? <p>No packed orders available for shipment creation.</p> : null}
          {packedOrders.map((order) => (
            <article key={order.order_id} className="section-card panel-stack">
              <div className="section-head">
                <div>
                  <label className="field-group" style={{ margin: 0 }}>
                    <span className="field-label">Select</span>
                    <input
                      type="checkbox"
                      checked={selectedPackedOrders.includes(order.order_id)}
                      onChange={() => togglePackedSelection(order.order_id)}
                    />
                  </label>
                  <h3>{order.order_id}</h3>
                  <p>{order.customer_email}</p>
                  <p>Placed: {formatDateTime(order.created_at)}</p>
                </div>
                <StatusBadge status={order.status} />
              </div>

              <div className="admin-orders-grid">
                <div className="field-group">
                  <span className="field-label">Amount</span>
                  <p>Rs. {Number(order.total_amount || order.order_value || 0).toLocaleString('en-IN')}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Shipment</span>
                  <p>{order.shipment_id || 'Not assigned'}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Destination</span>
                  <p>{order.destination_pincode || 'Pending destination'}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="section-head">
          <div>
            <h2>Shipment list</h2>
            <p>Dispatch CREATED shipments to move linked orders to SHIPPED.</p>
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
                  <span className="field-label">Notes</span>
                  <p>{shipment.shipment_notes || 'No notes'}</p>
                </div>
                {String(shipment.status || '').toUpperCase() === 'CREATED' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => dispatchShipment(shipment.shipment_id)}
                    disabled={dispatchingShipmentId === shipment.shipment_id}
                  >
                    {dispatchingShipmentId === shipment.shipment_id ? 'Dispatching...' : 'Dispatch Shipment'}
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary" disabled>
                    ✓ Dispatched
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </PageWrapper>
  )
}
