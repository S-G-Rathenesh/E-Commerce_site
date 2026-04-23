import { useEffect, useMemo, useRef, useState } from 'react'
import { buildAuthHeaders, getStoredUser } from '../utils/auth'
import StatusBadge from './StatusBadge'
import { formatStatusLabel, getSlaState, normalizeOrderStatus } from '../utils/adminUi'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const WS_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace('http', 'ws')
const COURIERS = ['BlueDart', 'Delhivery', 'DTDC', 'Ecom Express']
const ADMIN_STATUSES = ['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']
const ORDER_TABS = ['ALL', 'PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REJECTED', 'CANCELLED']
const TIMELINE_STEPS = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']

function defaultDraft(order) {
  return {
    delivery_partner_email: order.assigned_delivery_partner || 'delivery@veloura.com',
    courier_name: order?.shipment?.courier_name || COURIERS[0],
    tracking_id: order?.shipment?.tracking_id || '',
    current_location: order?.shipment?.current_location || 'Warehouse',
    status: 'CREATED',
  }
}

export default function AdminOrdersManager({ compact = false }) {
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [filters, setFilters] = useState({ status: 'ALL', date: '', customer: '' })
  const [activeOrderId, setActiveOrderId] = useState('')
  const [statusModalOrderId, setStatusModalOrderId] = useState('')
  const [statusTab, setStatusTab] = useState('PLACED')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedOrders, setSelectedOrders] = useState([])
  const [shipmentDraft, setShipmentDraft] = useState({
    courier_name: COURIERS[0],
    tracking_id: '',
  })
  const [trackingLogsByOrder, setTrackingLogsByOrder] = useState({})
  const [trackingStatusByOrder, setTrackingStatusByOrder] = useState({})
  const [lastSyncedAt, setLastSyncedAt] = useState('')
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)

  const formatDateTime = (value) => {
    if (!value) {
      return '-'
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return '-'
    }
    return date.toLocaleString()
  }

  const filteredOrders = useMemo(() => {
    const statusFilter = String(filters.status || 'ALL').trim().toUpperCase()
    const dateFilter = String(filters.date || '').trim()
    const customerFilter = String(filters.customer || '').trim().toLowerCase()
    const search = String(searchTerm || '').trim().toLowerCase()

    return orders.filter((order) => {
      const statusValue = normalizeOrderStatus(order.status)
      const createdValue = String(order.created_at || '').trim()
      const customerValue = String(order.customer_email || '').trim().toLowerCase()
      const orderIdValue = String(order.order_id || '').trim().toLowerCase()

      const statusMatch = statusFilter === 'ALL' || statusValue === statusFilter
      const dateMatch = !dateFilter || createdValue.slice(0, 10) === dateFilter
      const customerMatch = !customerFilter || customerValue.includes(customerFilter)
      const tabMatch = statusTab === 'ALL' || statusValue === statusTab
      const searchMatch = !search || orderIdValue.includes(search) || customerValue.includes(search)

      return statusMatch && dateMatch && customerMatch && tabMatch && searchMatch
    })
  }, [filters, orders, searchTerm, statusTab])

  const displayedOrders = useMemo(() => {
    if (compact) {
      return filteredOrders.slice(0, 5)
    }
    return filteredOrders
  }, [compact, filteredOrders])

  const focusedOrders = useMemo(
    () => displayedOrders.filter((order) => order.order_id === activeOrderId),
    [activeOrderId, displayedOrders],
  )

  const loadOrders = async () => {
    setLoading(true)
    setMessage('')

    try {
      const response = await fetch(`${API_BASE}/admin/orders`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load orders.')
        setOrders([])
        return
      }

      const nextOrders = Array.isArray(data?.orders) ? data.orders : []
      setOrders(nextOrders)
      setDrafts(
        nextOrders.reduce((accumulator, order) => {
          accumulator[order.order_id] = defaultDraft(order)
          return accumulator
        }, {}),
      )
      setLastSyncedAt(new Date().toISOString())
    } catch {
      setMessage('Unable to load orders right now.')
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [])

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadOrders()
    }, 10000)

    const syncOnFocus = () => {
      loadOrders()
    }

    window.addEventListener('focus', syncOnFocus)
    document.addEventListener('visibilitychange', syncOnFocus)

    return () => {
      clearInterval(intervalId)
      window.removeEventListener('focus', syncOnFocus)
      document.removeEventListener('visibilitychange', syncOnFocus)
    }
  }, [])

  useEffect(() => {
    const user = getStoredUser()
    const userId = String(user?.id || user?.email || '').trim()
    if (!userId) {
      return undefined
    }

    const connect = () => {
      try {
        const ws = new WebSocket(`${WS_BASE}/ws/orders/${encodeURIComponent(userId)}`)
        wsRef.current = ws

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (payload?.type === 'order_status_updated' || payload?.type === 'order_created') {
              loadOrders()
            }
          } catch {
            // Ignore malformed payloads from transient socket writes.
          }
        }

        ws.onclose = () => {
          if (reconnectRef.current) {
            clearTimeout(reconnectRef.current)
          }
          reconnectRef.current = setTimeout(connect, 3000)
        }
      } catch {
        reconnectRef.current = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    if (!displayedOrders.length) {
      setActiveOrderId('')
      return
    }

    if (activeOrderId && !displayedOrders.some((order) => order.order_id === activeOrderId)) {
      setActiveOrderId('')
    }
  }, [activeOrderId, displayedOrders])

  const updateDraft = (orderId, field, value) => {
    setDrafts((current) => ({
      ...current,
      [orderId]: {
        ...(current[orderId] || {}),
        [field]: value,
      },
    }))
  }

  const openTrackingModal = (orderId) => {
    setActiveOrderId(orderId)
    setStatusModalOrderId(orderId)
    loadTrackingStatus(orderId)
    loadTrackingLogs(orderId)
  }

  const closeTrackingModal = () => {
    setStatusModalOrderId('')
  }

  const transitionOrder = async (orderId, action, payload = {}, successMessage = '') => {
    try {
      const response = await fetch(`${API_BASE}/orders/${orderId}/${action}`, {
        method: 'PATCH',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to update order status.')
        return
      }
      setMessage(successMessage || data?.message || 'Order updated.')
      loadOrders()
    } catch {
      setMessage('Unable to update order status.')
    }
  }

  const toggleOrderSelection = (orderId) => {
    setSelectedOrders((current) => {
      if (current.includes(orderId)) {
        return current.filter((item) => item !== orderId)
      }
      return [...current, orderId]
    })
  }

  const createShipment = async () => {
    if (!selectedOrders.length) {
      setMessage('Select one or more packed orders to create a shipment.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/shipments`, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          order_ids: selectedOrders,
          courier_name: shipmentDraft.courier_name,
          tracking_id: shipmentDraft.tracking_id,
          status: 'CREATED',
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Failed to create shipment.')
        return
      }
      const shipmentCount = Number(data?.shipments_created || 1)
      setMessage(`Shipment records created for ${selectedOrders.length} packed order(s). Use Ship to dispatch and move to SHIPPED.`)
      setSelectedOrders([])
      setShipmentDraft((current) => ({ ...current, tracking_id: '' }))
      loadOrders()
    } catch {
      setMessage('Failed to create shipment.')
    }
  }

  const autoCreateShipment = async () => {
    try {
      const response = await fetch(`${API_BASE}/shipments/auto`, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({}),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Failed to auto-create shipments.')
        return
      }
      const shipmentCount = Number(data?.shipments_created || 0)
      if (shipmentCount <= 0) {
        setMessage(data?.message || 'No packed orders available for auto shipment creation.')
      } else {
        setMessage(`Auto shipment complete. Created ${shipmentCount} shipment(s).`)
      }
      setSelectedOrders([])
      setShipmentDraft((current) => ({ ...current, tracking_id: '' }))
      loadOrders()
    } catch {
      setMessage('Failed to auto-create shipments.')
    }
  }

  const loadTrackingLogs = async (orderId) => {
    try {
      const response = await fetch(`${API_BASE}/admin/tracking-logs?order_id=${encodeURIComponent(orderId)}`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load tracking logs.')
        return
      }
      setTrackingLogsByOrder((current) => ({
        ...current,
        [orderId]: Array.isArray(data?.logs) ? data.logs : [],
      }))
    } catch {
      setMessage('Unable to load tracking logs.')
    }
  }

  const loadTrackingStatus = async (orderId) => {
    try {
      const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/tracking`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load order status timeline.')
        return
      }

      setTrackingStatusByOrder((current) => ({
        ...current,
        [orderId]: {
          ...(data || {}),
          status_history: Array.isArray(data?.order?.status_history) ? data.order.status_history : [],
        },
      }))
    } catch {
      setMessage('Unable to load order status timeline.')
    }
  }

  const assignDeliveryPartner = async (orderId) => {
    const draft = drafts[orderId] || {}
    try {
      const response = await fetch(`${API_BASE}/admin/orders/${orderId}/assign`, {
        method: 'PUT',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          delivery_partner_email: draft.delivery_partner_email,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Failed to assign delivery partner.')
        return
      }
      setMessage('Delivery partner assigned successfully.')
      loadOrders()
    } catch {
      setMessage('Failed to assign delivery partner.')
    }
  }

  const saveShipment = async (orderId) => {
    const draft = drafts[orderId] || {}
    const order = orders.find((entry) => entry.order_id === orderId)
    const shipmentId = String(order?.shipment_id || '').trim()
    if (!shipmentId) {
      setMessage('Create shipment first before dispatching this order.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/shipments/${encodeURIComponent(shipmentId)}/dispatch`, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          current_location: draft.current_location,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Failed to dispatch shipment.')
        return
      }
      setMessage(data?.message || 'Shipment dispatched successfully.')
      loadOrders()
    } catch {
      setMessage('Failed to dispatch shipment.')
    }
  }

  return (
    <section className="panel panel-stack card">
      <div className="section-head">
        <div>
          <p className="eyebrow">ORDERS</p>
          <h2>Orders control center</h2>
          <p>Manage order flow, shipment creation, partner assignment, and tracking updates.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadOrders}>
          Refresh
        </button>
      </div>

      {message ? <p className="wishlist-message">{message}</p> : null}

      {loading ? <p>Loading orders...</p> : null}

      {!loading && displayedOrders.length === 0 ? <p>No orders found.</p> : null}

      <section className="section-card panel-stack section card">
        <div className="section-head">
          <div>
            <p className="eyebrow">FILTERS</p>
            <h3>Filter orders</h3>
            <p>Narrow by status, order date, or customer email.</p>
          </div>
        </div>

        <div className="tab-strip">
          {ORDER_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab-button ${statusTab === tab ? 'tab-button-active' : ''}`}
              onClick={() => setStatusTab(tab)}
            >
              {formatStatusLabel(tab)}
            </button>
          ))}
        </div>

        <div className="admin-orders-grid">
          <label className="field-group">
            <span className="field-label">Status</span>
            <select
              className="field"
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="ALL">All statuses</option>
              <option value="PLACED">PLACED</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="PACKED">PACKED</option>
              <option value="SHIPPED">SHIPPED</option>
              <option value="OUT_FOR_DELIVERY">OUT_FOR_DELIVERY</option>
              <option value="DELIVERED">DELIVERED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </label>

          <label className="field-group">
            <span className="field-label">Date</span>
            <input
              type="date"
              className="field"
              value={filters.date}
              onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))}
            />
          </label>

          <label className="field-group">
            <span className="field-label">Customer</span>
            <input
              className="field"
              value={filters.customer}
              onChange={(event) => setFilters((current) => ({ ...current, customer: event.target.value }))}
              placeholder="Search customer email"
            />
          </label>

          <label className="field-group">
            <span className="field-label">Search</span>
            <input
              className="field"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Order ID or customer email"
            />
          </label>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFilters({ status: 'ALL', date: '', customer: '' })
              setStatusTab('ALL')
              setSearchTerm('')
            }}
          >
            Clear Filters
          </button>
        </div>
      </section>

      <section className="section-card panel-stack section card">
        <div className="section-head">
          <div>
            <p className="eyebrow">ORDERS</p>
            <h3>Orders table</h3>
            <p>Primary order list with real-time status visibility.</p>
          </div>
        </div>

        {lastSyncedAt ? <p style={{ fontSize: '13px', color: '#6b7280' }}>Last synced: {new Date(lastSyncedAt).toLocaleTimeString()}</p> : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Order Date & Time</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>SLA</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayedOrders.map((order) => {
                const eligibleForShipment = ['PACKED'].includes(String(order.status || '').toUpperCase())
                return (
                  <tr key={`table-${order.order_id}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedOrders.includes(order.order_id)}
                        onChange={() => toggleOrderSelection(order.order_id)}
                        disabled={!eligibleForShipment}
                      />
                    </td>
                    <td>{order.order_id}</td>
                    <td>{order.customer_email}</td>
                    <td>{formatDateTime(order.created_at)}</td>
                    <td><StatusBadge status={order.status} /></td>
                    <td style={{ textAlign: 'right' }}>Rs. {Number(order.total_amount || 0).toLocaleString('en-IN')}</td>
                    <td>
                      <span className={getSlaState(order).className}>{getSlaState(order).label}</span>
                    </td>
                    <td className="row-gap">
                      {normalizeOrderStatus(order.status) === 'PLACED' ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => transitionOrder(order.order_id, 'confirm', { current_location: 'Merchant confirmation desk' }, 'Order confirmed.')}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => transitionOrder(order.order_id, 'reject', { current_location: 'Merchant review desk', reason: 'Rejected by merchant' }, 'Order rejected.')}
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {normalizeOrderStatus(order.status) === 'CONFIRMED' ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => transitionOrder(order.order_id, 'pack', { current_location: 'Warehouse packing unit' }, 'Order packed.')}
                        >
                          Pack
                        </button>
                      ) : null}
                      {normalizeOrderStatus(order.status) === 'PACKED' ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => saveShipment(order.order_id)}
                        >
                          Dispatch
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => openTrackingModal(order.order_id)}
                      >
                        View Status
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-card panel-stack section card">
        <div className="section-head">
          <div>
            <p className="eyebrow">SHIPMENTS</p>
            <h3>Create shipment</h3>
            <p>Select packed orders and generate shipments in bulk.</p>
          </div>
        </div>
        <div className="admin-orders-grid">
          <label className="field-group">
            <span className="field-label">Courier</span>
            <select
              className="field"
              value={shipmentDraft.courier_name}
              onChange={(event) =>
                setShipmentDraft((current) => ({ ...current, courier_name: event.target.value }))
              }
            >
              {COURIERS.map((courier) => (
                <option key={courier} value={courier}>
                  {courier}
                </option>
              ))}
            </select>
          </label>

          <label className="field-group">
            <span className="field-label">Tracking ID (optional)</span>
            <input
              className="field"
              value={shipmentDraft.tracking_id}
              onChange={(event) =>
                setShipmentDraft((current) => ({ ...current, tracking_id: event.target.value }))
              }
              placeholder="Leave blank to auto-generate"
            />
          </label>

          <button type="button" className="btn btn-primary" onClick={createShipment}>
            Create Shipment for Selected Orders
          </button>

          <button type="button" className="btn btn-secondary" onClick={autoCreateShipment}>
            Auto Create Shipment
          </button>
        </div>
      </section>

      <section className="section-card panel-stack section card">
        <div className="section-head">
          <div>
            <p className="eyebrow">FULFILLMENT</p>
            <h3>Shipment and partner actions</h3>
            <p>Open an order to view the status timeline, shipment progress, and history.</p>
          </div>
        </div>

        {!activeOrderId ? <p className="empty-state">Select an order from the table to expand shipment actions.</p> : null}

        <div className="admin-orders-stack">
        {focusedOrders.map((order) => {
          const draft = drafts[order.order_id] || defaultDraft(order)
          const shipment = order.shipment || {}
          const trackingLogs = trackingLogsByOrder[order.order_id] || []
          const trackingStatus = trackingStatusByOrder[order.order_id]
          const eligibleForShipment = ['PACKED'].includes(String(order.status || '').toUpperCase())
          const currentStepIndex = TIMELINE_STEPS.indexOf(normalizeOrderStatus(draft.status || order.status))
          const sla = getSlaState(order)

          return (
            <article key={order.order_id} className="section-card panel-stack">
              <div className="section-head">
                <div>
                  <label className="field-group">
                    <span className="field-label">Select for shipment</span>
                    <input
                      type="checkbox"
                      checked={selectedOrders.includes(order.order_id)}
                      onChange={() => toggleOrderSelection(order.order_id)}
                      disabled={!eligibleForShipment}
                    />
                  </label>
                  <h3>{order.order_id}</h3>
                  <p>{order.customer_email}</p>
                  <p>Placed on: {formatDateTime(order.created_at)}</p>
                </div>
                <div className="row-gap">
                  <StatusBadge status={order.status} />
                  <span className={sla.className}>{sla.label}</span>
                </div>
              </div>

              <div className="tracking-timeline">
                {TIMELINE_STEPS.map((step, index) => {
                  const isCompleted = currentStepIndex > index
                  const isActive = currentStepIndex === index
                  return (
                    <div
                      key={`${order.order_id}-${step}`}
                      className={`tracking-step ${isCompleted ? 'tracking-step-completed' : ''} ${isActive ? 'tracking-step-active' : ''}`}
                    >
                      <span className="tracking-dot" />
                      <span>{formatStatusLabel(step)}</span>
                    </div>
                  )
                })}
              </div>

              <div className="admin-orders-grid">
                <label className="field-group">
                  <span className="field-label">Delivery Partner Email</span>
                  <input
                    className="field"
                    value={draft.delivery_partner_email}
                    onChange={(event) => updateDraft(order.order_id, 'delivery_partner_email', event.target.value)}
                  />
                </label>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => assignDeliveryPartner(order.order_id)}
                >
                  Assign Partner
                </button>

                <label className="field-group">
                  <span className="field-label">Courier</span>
                  <select
                    className="field"
                    value={draft.courier_name}
                    onChange={(event) => updateDraft(order.order_id, 'courier_name', event.target.value)}
                  >
                    {COURIERS.map((courier) => (
                      <option key={courier} value={courier}>
                        {courier}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-group">
                  <span className="field-label">Tracking ID</span>
                  <input
                    className="field"
                    value={draft.tracking_id}
                    onChange={(event) => updateDraft(order.order_id, 'tracking_id', event.target.value)}
                    placeholder={shipment.tracking_id || 'Tracking ID'}
                  />
                </label>

                <label className="field-group">
                  <span className="field-label">Current Location</span>
                  <input
                    className="field"
                    value={draft.current_location}
                    onChange={(event) => updateDraft(order.order_id, 'current_location', event.target.value)}
                  />
                </label>

                <label className="field-group">
                  <span className="field-label">Shipment Status</span>
                  <select
                    className="field"
                    value={draft.status}
                    onChange={(event) => updateDraft(order.order_id, 'status', event.target.value)}
                  >
                    {ADMIN_STATUSES.map((statusValue) => (
                      <option key={statusValue} value={statusValue}>
                        {statusValue}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => saveShipment(order.order_id)}
                >
                  Dispatch Shipment
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => loadTrackingLogs(order.order_id)}
                >
                  View Tracking Logs
                </button>
              </div>

              {trackingLogs.length ? (
                <div className="summary-row">
                  {trackingLogs.map((entry) => (
                    <p key={`${order.order_id}-${entry.id || entry.timestamp}`}>
                      {String(entry.status || '').replaceAll('_', ' ')} · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Updated'}
                    </p>
                  ))}
                </div>
              ) : null}

              {Array.isArray(trackingStatus?.status_history) && trackingStatus.status_history.length ? (
                <section className="section-card panel-stack tracking-subcard">
                  <p className="field-label">Status history</p>
                  {trackingStatus.status_history.map((entry, index) => (
                    <p key={`${order.order_id}-history-${index}`}>
                      {formatStatusLabel(entry.status)} · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Updated'}
                    </p>
                  ))}
                </section>
              ) : null}
            </article>
          )
        })}
        </div>
      </section>

      {statusModalOrderId ? (() => {
        const modalOrder = orders.find((order) => order.order_id === statusModalOrderId)
        const modalStatus = trackingStatusByOrder[statusModalOrderId]
        const modalLogs = trackingLogsByOrder[statusModalOrderId] || []
        const modalStepIndex = modalOrder ? TIMELINE_STEPS.indexOf(normalizeOrderStatus(modalOrder.status)) : -1
        const statusHistory = Array.isArray(modalStatus?.status_history) ? modalStatus.status_history : []
        const latestHistoryByStatus = statusHistory.reduce((accumulator, entry) => {
          const key = normalizeOrderStatus(entry?.status)
          if (key) {
            accumulator[key] = entry
          }
          return accumulator
        }, {})
        const progressRatio = modalStepIndex <= 0 ? 0 : Math.min(1, modalStepIndex / (TIMELINE_STEPS.length - 1))

        return modalOrder ? (
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
              aria-label={`Status history for ${modalOrder.order_id}`}
              onClick={(event) => event.stopPropagation()}
              className="section-card panel-stack"
              style={{ maxWidth: '920px', width: '100%', maxHeight: '85vh', overflow: 'auto' }}
            >
              <div className="section-head">
                <div>
                  <p className="eyebrow">STATUS DETAILS</p>
                  <h3>{modalOrder.order_id}</h3>
                  <p>{modalOrder.customer_email}</p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={closeTrackingModal}>
                  Close
                </button>
              </div>

              <section className="tracking-progress-shell">
                <div className="tracking-progress-line" aria-hidden="true">
                  <span className="tracking-progress-fill" style={{ width: `${progressRatio * 100}%` }} />
                </div>
                <div className="tracking-progress-steps">
                  {TIMELINE_STEPS.map((step, index) => {
                    const isCompleted = modalStepIndex > index
                    const isActive = modalStepIndex === index
                    return (
                      <div
                        key={`${modalOrder.order_id}-modal-${step}`}
                        className={`tracking-progress-step ${isCompleted ? 'tracking-progress-step-completed' : ''} ${isActive ? 'tracking-progress-step-active' : ''}`}
                      >
                        <span className="tracking-progress-dot">{isCompleted ? '✓' : ''}</span>
                        <span>{formatStatusLabel(step)}</span>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="section-card panel-stack tracking-subcard">
                <p className="field-label">Timeline</p>
                <div className="tracking-vertical-timeline">
                  {TIMELINE_STEPS.map((step, index) => {
                    const isCompleted = modalStepIndex > index
                    const isActive = modalStepIndex === index
                    const entry = latestHistoryByStatus[step]
                    const statusText = isCompleted
                      ? (entry?.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Completed')
                      : isActive
                        ? 'In progress'
                        : 'Pending'

                    return (
                      <div key={`${modalOrder.order_id}-timeline-${step}`} className={`tracking-vertical-item ${isCompleted ? 'tracking-vertical-item-completed' : ''} ${isActive ? 'tracking-vertical-item-active' : ''}`}>
                        <span className="tracking-vertical-marker">{isCompleted ? '✓' : isActive ? '●' : '○'}</span>
                        <div>
                          <p className="tracking-vertical-title">{formatStatusLabel(step)}</p>
                          <p className="tracking-vertical-time">{statusText}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="section-card panel-stack tracking-subcard">
                <p className="field-label">Status history</p>
                {Array.isArray(modalStatus?.status_history) && modalStatus.status_history.length ? (
                  modalStatus.status_history.map((entry, index) => (
                    <p key={`${modalOrder.order_id}-modal-history-${index}`}>
                      {formatStatusLabel(entry.status)} · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Updated'}
                      {entry.updated_by_role ? ` · ${entry.updated_by_role}` : ''}
                    </p>
                  ))
                ) : (
                  <p>No history available yet.</p>
                )}
              </section>

              {modalLogs.length ? (
                <section className="section-card panel-stack tracking-subcard">
                  <p className="field-label">Tracking logs</p>
                  {modalLogs.map((entry) => (
                    <p key={`${modalOrder.order_id}-modal-log-${entry.id || entry.timestamp}`}>
                      {String(entry.status || '').replaceAll('_', ' ')} · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Updated'}
                    </p>
                  ))}
                </section>
              ) : null}
            </div>
          </div>
        ) : null
      })() : null}
    </section>
  )
}
