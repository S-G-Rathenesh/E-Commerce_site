import { useEffect, useMemo, useRef, useState } from 'react'
import { buildAuthHeaders, getStoredUser } from '../utils/auth'
import StatusBadge from './StatusBadge'
import { formatStatusLabel, getSlaState, normalizeOrderStatus } from '../utils/adminUi'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const WS_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace('http', 'ws')
const COURIERS = ['BlueDart', 'Delhivery', 'DTDC', 'Ecom Express']
const VEHICLE_TYPES = ['TRUCK', 'VAN', 'BIKE']
const ADMIN_STATUSES = ['PACKED', 'ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']
const ORDER_TABS = ['ALL', 'PLACED', 'CONFIRMED', 'PACKED', 'ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REJECTED', 'CANCELLED']
const TIMELINE_STEPS = ['PLACED', 'CONFIRMED', 'PACKED', 'ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']

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
  const ordersRef = useRef([])
  ordersRef.current = orders
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [filters, setFilters] = useState({ status: 'ALL', date: '', customer: '' })
  const [activeOrderId, setActiveOrderId] = useState('')
  const [statusModalOrderId, setStatusModalOrderId] = useState('')
  const [statusTab, setStatusTab] = useState('ALL')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedOrders, setSelectedOrders] = useState([])
  const [shipmentDraft, setShipmentDraft] = useState({
    courier_name: COURIERS[0],
    tracking_id: '',
  })
  const [trackingLogsByOrder, setTrackingLogsByOrder] = useState({})
  const [trackingStatusByOrder, setTrackingStatusByOrder] = useState({})
  const [lastSyncedAt, setLastSyncedAt] = useState('')

  // --- Ops-parity shipment state ---
  const [packedOrders, setPackedOrders] = useState([])
  const [selectedPackedOrders, setSelectedPackedOrders] = useState([])
  const [shipments, setShipments] = useState([])
  const [shipmentForm, setShipmentForm] = useState({
    destination_state: '',
    destination_city: '',
    vehicle_type: 'VAN',
    shipment_notes: '',
    courier_name: COURIERS[0],
    tracking_id: '',
  })
  const [dispatchingShipmentId, setDispatchingShipmentId] = useState('')
  const [transitioningOrders, setTransitioningOrders] = useState({})

  const wsRef = useRef(null)
  const reconnectRef = useRef(null)
  const lastFetchTimeRef = useRef(0)

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

  const loadOrders = async (showLoading = false) => {
    const fetchTime = Date.now()
    lastFetchTimeRef.current = fetchTime
    if (showLoading || ordersRef.current.length === 0) {
      setLoading(true)
    }
    setMessage('')

    try {
      const response = await fetch(`${API_BASE}/admin/orders`, {
        headers: buildAuthHeaders(),
        cache: 'no-store',
      })
      const data = await response.json()
      if (fetchTime < lastFetchTimeRef.current) {
        return
      }
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load orders.')
        setOrders([])
        return
      }

      const rawList = Array.isArray(data) ? data : (Array.isArray(data?.orders) ? data.orders : [])
      const nextOrders = rawList.map((order) => {
        const oid = String(order.order_id || order.id || order._id || '').trim()
        return {
          ...order,
          order_id: oid,
          id: oid,
        }
      })
      setOrders(nextOrders)
      setDrafts(
        nextOrders.reduce((accumulator, order) => {
          if (order.order_id) {
            accumulator[order.order_id] = defaultDraft(order)
          }
          return accumulator
        }, {}),
      )
      setLastSyncedAt(new Date().toISOString())
    } catch {
      if (fetchTime >= lastFetchTimeRef.current) {
        setMessage('Unable to load orders right now.')
        setOrders([])
      }
    } finally {
      if (fetchTime >= lastFetchTimeRef.current) {
        setLoading(false)
      }
    }
  }

  const loadPackedOrdersAndShipments = async () => {
    try {
      const [packedResponse, shipmentsResponse] = await Promise.all([
        fetch(`${API_BASE}/operations/packed-orders`, { headers: buildAuthHeaders(), cache: 'no-store' }),
        fetch(`${API_BASE}/operations/shipments`, { headers: buildAuthHeaders(), cache: 'no-store' }),
      ])
      const [packedData, shipmentsData] = await Promise.all([
        packedResponse.json(),
        shipmentsResponse.json(),
      ])
      if (packedResponse.ok) {
        const nextPacked = Array.isArray(packedData) ? packedData : (Array.isArray(packedData?.orders) ? packedData.orders : [])
        setPackedOrders(nextPacked)
        setSelectedPackedOrders((current) => current.filter((id) => nextPacked.some((o) => o.order_id === id)))
      }
      if (shipmentsResponse.ok) {
        setShipments(Array.isArray(shipmentsData) ? shipmentsData : (Array.isArray(shipmentsData?.shipments) ? shipmentsData.shipments : []))
      }
    } catch {
      // non-fatal — shipment list is supplemental
    }
  }

  // Shipment auto-creation is now handled automatically when orders are packed
  // These functions are kept for backward compatibility but show informational messages
  const createOpsShipment = async () => {
    setMessage('Shipments are now created automatically when orders are packed. No manual action needed.')
  }

  const autoCreateOpsShipment = async () => {
    setMessage('Shipments are automatically created and dispatched when you mark orders as packed.')
  }

  const dispatchOpsShipment = async (shipmentId) => {
    if (dispatchingShipmentId === shipmentId) return
    setDispatchingShipmentId(shipmentId)
    try {
      const response = await fetch(`${API_BASE}/shipments/${encodeURIComponent(shipmentId)}/dispatch`, {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        cache: 'no-store',
        body: JSON.stringify({ current_location: 'Admin dispatch bay' }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Failed to dispatch shipment.')
        return
      }
      setMessage(data?.message || 'Shipment dispatched.')
      await Promise.all([loadOrders(), loadPackedOrdersAndShipments()])
    } catch {
      setMessage('Failed to dispatch shipment.')
    } finally {
      setDispatchingShipmentId('')
    }
  }

  const toggleAllPacked = () => {
    if (selectedPackedOrders.length === packedOrders.length && packedOrders.length > 0) {
      setSelectedPackedOrders([])
    } else {
      setSelectedPackedOrders(packedOrders.map((o) => o.order_id))
    }
  }

  useEffect(() => {
    loadOrders(true)
    loadPackedOrdersAndShipments()
  }, [])

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadOrders()
      loadPackedOrdersAndShipments()
    }, 10000)

    const syncOnFocus = () => {
      if (Date.now() - lastFetchTimeRef.current > 5000) {
        loadOrders()
        loadPackedOrdersAndShipments()
      }
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

    let isDisposed = false

    const connect = () => {
      if (isDisposed) return
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
          if (!isDisposed) {
            if (reconnectRef.current) {
              clearTimeout(reconnectRef.current)
            }
            reconnectRef.current = setTimeout(connect, 3000)
          }
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
        if (!isDisposed) {
          reconnectRef.current = setTimeout(connect, 3000)
        }
      }
    }

    connect()

    return () => {
      isDisposed = true
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
    console.log('Opening tracking modal for order:', orderId)
    setActiveOrderId(orderId)
    setStatusModalOrderId(orderId)
    loadTrackingStatus(orderId)
    loadTrackingLogs(orderId)
  }

  const closeTrackingModal = () => {
    setStatusModalOrderId('')
  }

  const transitionOrder = async (orderId, action, payload = {}, successMessage = '') => {
    setTransitioningOrders((current) => ({ ...current, [orderId]: true }))

    const actionStatusMap = {
      confirm: 'CONFIRMED',
      reject: 'REJECTED',
      pack: 'PACKED',
      cancel: 'CANCELLED',
      'start-delivery': 'SHIPPED',
      'out-for-delivery': 'OUT_FOR_DELIVERY',
      delivered: 'DELIVERED',
    }
    const nextStatus = actionStatusMap[String(action || '').toLowerCase().trim()]

    // Optimistic instant UI update on single click
    if (nextStatus) {
      setOrders((currentOrders) =>
        currentOrders.map((order) => {
          const isTarget = order.order_id === orderId || order.id === orderId || order._id === orderId
          return isTarget ? { ...order, status: nextStatus } : order
        })
      )
    }

    try {
      const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/${action}`, {
        method: 'PATCH',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        cache: 'no-store',
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to update order status.')
        await loadOrders()
        return
      }
      setMessage(successMessage || data?.message || 'Order updated.')

      // Update with server returned order object if provided
      if (data?.order) {
        setOrders((currentOrders) =>
          currentOrders.map((order) => {
            const isTarget = order.order_id === orderId || order.id === orderId || order._id === orderId
            return isTarget ? { ...order, ...data.order } : order
          })
        )
      }

      // Delayed background sync to prevent stale DB state overwrite
      setTimeout(() => {
        loadOrders()
        loadPackedOrdersAndShipments()
      }, 600)
    } catch {
      setMessage('Unable to update order status.')
      await loadOrders()
    } finally {
      setTransitioningOrders((current) => ({ ...current, [orderId]: false }))
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

  const createShipment = createOpsShipment

  const autoCreateShipment = autoCreateOpsShipment

  const loadTrackingLogs = async (orderId) => {
    try {
      console.log('Loading tracking logs for order:', orderId)
      const response = await fetch(`${API_BASE}/admin/tracking-logs?order_id=${encodeURIComponent(orderId)}`, {
        headers: buildAuthHeaders(),
        cache: 'no-store',
      })
      const data = await response.json()
      console.log('Tracking logs response:', { ok: response.ok, status: response.status, data })
      if (!response.ok) {
        console.error('Failed to load tracking logs:', data?.detail)
        setMessage(data?.detail || 'Unable to load tracking logs.')
        return
      }
      const logs = Array.isArray(data?.logs) ? data.logs : []
      console.log('Setting tracking logs:', logs)
      setTrackingLogsByOrder((current) => ({
        ...current,
        [orderId]: logs,
      }))
    } catch (error) {
      console.error('Error loading tracking logs:', error)
      setMessage('Unable to load tracking logs.')
    }
  }

  const loadTrackingStatus = async (orderId) => {
    try {
      console.log('Loading tracking status for order:', orderId)
      const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/tracking`, {
        headers: buildAuthHeaders(),
        cache: 'no-store',
      })
      const data = await response.json()
      console.log('Tracking status response:', { ok: response.ok, status: response.status, data })
      if (!response.ok) {
        console.error('Failed to load tracking status:', data?.detail)
        setMessage(data?.detail || 'Unable to load order status timeline.')
        return
      }

      const statusHistory = Array.isArray(data?.order?.status_history) ? data.order.status_history : []
      console.log('Extracted status_history:', statusHistory)
      setTrackingStatusByOrder((current) => ({
        ...current,
        [orderId]: {
          ...(data || {}),
          status_history: statusHistory,
        },
      }))
    } catch (error) {
      console.error('Error loading tracking status:', error)
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
        cache: 'no-store',
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
      await loadOrders()
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
        cache: 'no-store',
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
      await loadOrders()
    } catch {
      setMessage('Failed to dispatch shipment.')
    }
  }

  const renderSkeletonRows = () => {
    return Array.from({ length: 5 }).map((_, idx) => (
      <tr key={`skeleton-row-${idx}`}>
        <td><div className="skeleton-line skeleton-shimmer" style={{ width: '20px' }}></div></td>
        <td><div className="skeleton-line skeleton-shimmer" style={{ height: '14px', width: '80px' }}></div></td>
        <td>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div className="skeleton-line skeleton-shimmer" style={{ height: '12px', width: '120px' }}></div>
            <div className="skeleton-line skeleton-shimmer" style={{ height: '10px', width: '80px' }}></div>
          </div>
        </td>
        <td>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div className="skeleton-line skeleton-shimmer" style={{ width: '32px', height: '32px', borderRadius: '4px' }}></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
              <div className="skeleton-line skeleton-shimmer" style={{ height: '10px', width: '100px' }}></div>
              <div className="skeleton-line skeleton-shimmer" style={{ height: '8px', width: '60px' }}></div>
            </div>
          </div>
        </td>
        <td><div className="skeleton-line skeleton-shimmer" style={{ width: '100px' }}></div></td>
        <td><div className="skeleton-line skeleton-shimmer" style={{ height: '16px', borderRadius: '4px', width: '60px' }}></div></td>
        <td style={{ textAlign: 'right' }}><div className="skeleton-line skeleton-shimmer" style={{ marginLeft: 'auto', width: '70px' }}></div></td>
        <td><div className="skeleton-line skeleton-shimmer" style={{ width: '50px' }}></div></td>
        <td><div className="skeleton-line skeleton-shimmer" style={{ width: '80px', height: '28px', borderRadius: '4px' }}></div></td>
      </tr>
    ))
  }

  return (
    <section className="panel panel-stack card">
      <div className="section-head">
        <div>
          <p className="eyebrow">ORDERS</p>
          <h2>Orders control center</h2>
          <p>Manage order flow: Confirm → Pack → Auto-shipment creation & dispatch. Assign delivery partners and track orders.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadOrders}>
          Refresh
        </button>
      </div>

      {message ? <p className="wishlist-message">{message}</p> : null}

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
                <th>Products</th>
                <th>Order Date & Time</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>SLA</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && displayedOrders.length === 0 ? (
                renderSkeletonRows()
              ) : (
                displayedOrders.map((order) => {
                  const eligibleForShipment = ['PACKED'].includes(String(order.status || '').toUpperCase())
                  const shipping = order.shipping_details || {}
                  const customerName = String(shipping.full_name || order.customer_name || '').trim()
                  const customerPhone = String(shipping.phone || order.phone || '').trim()
                  const customerCity = String(shipping.city || '').trim()
                  const customerAddress = String(shipping.address || '').trim()
                  const customerPincode = String(shipping.pincode || order.destination_pincode || '').trim()
                  const orderItems = Array.isArray(order.items) ? order.items : []

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
                      <td>
                        <span className="admin-order-id">{order.order_id}</span>
                      </td>

                      {/* ── Customer: name + phone + address ── */}
                      <td>
                        <div className="admin-customer-cell">
                          {customerName ? (
                            <span className="admin-customer-name">{customerName}</span>
                          ) : (
                            <span className="admin-customer-email">{order.customer_email}</span>
                          )}
                          {customerPhone ? (
                            <span className="admin-customer-phone">📞 {customerPhone}</span>
                          ) : null}
                          {customerCity || customerAddress ? (
                            <span className="admin-customer-address">
                              📍 {[customerAddress, customerCity, customerPincode].filter(Boolean).join(', ')}
                            </span>
                          ) : null}
                        </div>
                      </td>

                      {/* ── Products: thumbnail + name + qty ── */}
                      <td>
                        <div className="admin-products-cell">
                          {orderItems.length > 0 ? orderItems.map((item, idx) => (
                            <div key={`${order.order_id}-item-${idx}`} className="admin-product-chip">
                              {item.image ? (
                                <img
                                  src={item.image}
                                  alt={item.name || 'Product'}
                                  className="admin-product-thumb"
                                />
                              ) : (
                                <div className="admin-product-thumb admin-product-thumb-placeholder">📦</div>
                              )}
                              <div className="admin-product-chip-info">
                                <span className="admin-product-chip-name">{item.name || `Product ${item.product_id}`}</span>
                                <span className="admin-product-chip-qty">Qty: {item.quantity}</span>
                              </div>
                            </div>
                          )) : (
                            <span className="admin-no-items">—</span>
                          )}
                        </div>
                      </td>

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
                              onClick={() => transitionOrder(order.order_id || order.id, 'confirm', { current_location: 'Merchant confirmation desk' }, 'Order confirmed.')}
                              disabled={transitioningOrders[order.order_id || order.id]}
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => transitionOrder(order.order_id || order.id, 'reject', { current_location: 'Merchant review desk', reason: 'Rejected by merchant' }, 'Order rejected.')}
                              disabled={transitioningOrders[order.order_id || order.id]}
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                        {normalizeOrderStatus(order.status) === 'CONFIRMED' ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => transitionOrder(order.order_id || order.id, 'pack', { current_location: 'Warehouse packing unit' }, 'Order packed.')}
                            disabled={transitioningOrders[order.order_id || order.id]}
                          >
                            Pack
                          </button>
                        ) : null}
                        {normalizeOrderStatus(order.status) === 'PACKED' ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled
                          >
                            Packed
                          </button>
                        ) : null}
                        {normalizeOrderStatus(order.status) === 'ACCEPTED' ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => transitionOrder(order.order_id || order.id, 'start-delivery', { current_location: 'Warehouse dispatch bay' }, 'Order shipped.')}
                            disabled={transitioningOrders[order.order_id || order.id]}
                          >
                            Shipped
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => openTrackingModal(order.order_id || order.id)}
                          disabled={transitioningOrders[order.order_id || order.id]}
                        >
                          View Status
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Shipment List - Read-only view of auto-created shipments */}
      <section className="section-card panel-stack section card">
        <div className="section-head">
          <div>
            <p className="eyebrow">SHIPMENTS</p>
            <h3>Shipment list</h3>
            <p>View auto-created shipments. Shipments are automatically created and dispatched when orders are packed.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={loadPackedOrdersAndShipments}>
            Refresh shipments
          </button>
        </div>

        <div className="admin-orders-stack">
          {shipments.length === 0 ? (
            <p className="empty-state">No shipments created yet.</p>
          ) : (
            shipments.map((shipment) => (
              <article key={shipment.shipment_id} className="section-card panel-stack">
                <div className="section-head">
                  <div>
                    <h3 style={{ fontFamily: 'monospace', fontSize: '14px' }}>{shipment.shipment_id}</h3>
                    <p>
                      {[shipment.destination_city, shipment.destination_state].filter(Boolean).join(', ') ||
                        shipment.destination || 'Destination pending'}
                    </p>
                    <p>Vehicle: {shipment.vehicle_type || 'VAN'} · Courier: {shipment.courier_name || '—'} · Orders: {shipment.order_count ?? 0}</p>
                    {shipment.shipment_notes ? <p>{shipment.shipment_notes}</p> : null}
                  </div>
                  <StatusBadge status={shipment.status} />
                </div>

                <div className="admin-orders-grid">
                  <div className="field-group">
                    <span className="field-label">Created at</span>
                    <p>{formatDateTime(shipment.created_at)}</p>
                  </div>
                  <div className="field-group">
                    <span className="field-label">Tracking ID</span>
                    <p>{shipment.tracking_id || 'Auto-assigned'}</p>
                  </div>
                  <div className="field-group">
                    <span className="field-label">Current location</span>
                    <p>{shipment.current_location || '—'}</p>
                  </div>
                  {String(shipment.status || '').toUpperCase() === 'CREATED' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => dispatchOpsShipment(shipment.shipment_id)}
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
            ))
          )}
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
                  {(() => {
                    const s = order.shipping_details || {}
                    const name = String(s.full_name || order.customer_name || '').trim()
                    const phone = String(s.phone || '').trim()
                    const city = String(s.city || '').trim()
                    const addr = String(s.address || '').trim()
                    const pin = String(s.pincode || order.destination_pincode || '').trim()
                    return (
                      <div className="admin-customer-cell admin-customer-cell-inline">
                        {name ? <span className="admin-customer-name">{name}</span> : <span className="admin-customer-email">{order.customer_email}</span>}
                        {phone ? <span className="admin-customer-phone">📞 {phone}</span> : null}
                        {city || addr ? (
                          <span className="admin-customer-address">
                            📍 {[addr, city, pin].filter(Boolean).join(', ')}
                          </span>
                        ) : null}
                      </div>
                    )
                  })()}
                </div>
                <StatusBadge status={order.status} />
              </div>

              {/* Action grid for assignment and dispatch */}
              <div className="admin-orders-grid" style={{ marginTop: '16px' }}>
                <div className="field-group">
                  <span className="field-label">Assign Last Mile Delivery Partner</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      className="field"
                      value={draft.delivery_partner_email}
                      onChange={(e) => updateDraft(order.order_id, 'delivery_partner_email', e.target.value)}
                    >
                      <option value="delivery@veloura.com">delivery@veloura.com</option>
                      <option value="delivery.demo@veloura.com">delivery.demo@veloura.com</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => assignDeliveryPartner(order.order_id)}
                      disabled={transitioningOrders[order.order_id]}
                    >
                      Assign
                    </button>
                  </div>
                </div>

                <div className="field-group">
                  <span className="field-label">Update Courier Location</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="field"
                      value={draft.current_location}
                      placeholder="e.g. Warehouse"
                      onChange={(e) => updateDraft(order.order_id, 'current_location', e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => saveShipment(order.order_id)}
                      disabled={transitioningOrders[order.order_id]}
                    >
                      Update
                    </button>
                  </div>
                </div>
              </div>

              {/* Show shipment details if available */}
              {order.shipment_id ? (
                <div className="section-card panel-stack tracking-subcard" style={{ marginTop: '16px', padding: '12px' }}>
                  <p className="field-label" style={{ fontWeight: '600' }}>Active Shipment: {order.shipment_id}</p>
                  <p>Courier: {shipment.courier_name || 'BlueDart'} · Tracking ID: {shipment.tracking_id || 'Pending'}</p>
                  <p>Current Location: {shipment.current_location || 'Warehouse'} · Status: {shipment.status || 'CREATED'}</p>
                </div>
              ) : null}
            </article>
          )
        })}
        </div>
      </section>

      {/* Render status modal if open */}
      {statusModalOrderId ? (() => {
        const modalOrder = orders.find((order) => order.order_id === statusModalOrderId)
        const modalStatus = String(trackingStatusByOrder[statusModalOrderId]?.order?.status || modalOrder?.status || '').toUpperCase()
        const modalHistory = Array.isArray(trackingStatusByOrder[statusModalOrderId]?.order?.status_history)
          ? trackingStatusByOrder[statusModalOrderId].order.status_history
          : []
        const latestByStatus = modalHistory.reduce((accumulator, entry) => {
          const key = String(entry?.status || '').trim().toUpperCase()
          if (key) {
            accumulator[key] = entry
          }
          return accumulator
        }, {})
        const progressRatio = Math.max(0, TIMELINE_STEPS.indexOf(modalStatus)) / (TIMELINE_STEPS.length - 1 || 1)
        const shipment = trackingStatusByOrder[statusModalOrderId]?.order?.shipment || modalOrder?.shipment || {}
        const logs = trackingLogsByOrder[statusModalOrderId] || []

        const getLocalStepState = (statusVal, stepVal) => {
          const status = String(statusVal || '').trim().toUpperCase()
          const currentIndex = TIMELINE_STEPS.indexOf(status)
          const stepIndex = TIMELINE_STEPS.indexOf(stepVal)
          if (stepIndex < currentIndex) return 'completed'
          if (stepIndex === currentIndex) return 'active'
          return 'pending'
        }

        return (
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
              aria-label={`Tracking details for ${statusModalOrderId}`}
              onClick={(event) => event.stopPropagation()}
              className="section-card panel-stack"
              style={{ maxWidth: '920px', width: '100%', maxHeight: '85vh', overflow: 'auto', background: 'white', padding: '24px', borderRadius: '8px' }}
            >
              <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p className="eyebrow">TRACKING STATUS</p>
                  <h3>{statusModalOrderId}</h3>
                  <p>{modalOrder?.customer_email}</p>
                  {shipment?.tracking_id ? <p>Tracking ID: {shipment.tracking_id}</p> : null}
                  {shipment?.status ? <p>Shipment status: {shipment.status}</p> : null}
                </div>
                <button type="button" className="btn btn-secondary" onClick={closeTrackingModal}>
                  Close
                </button>
              </div>

              <section className="tracking-progress-shell" style={{ marginTop: '24px' }}>
                <div className="tracking-progress-line" aria-hidden="true" style={{ height: '4px', background: '#e2e8f0', position: 'relative' }}>
                  <span className="tracking-progress-fill" style={{ position: 'absolute', top: 0, left: 0, height: '100%', background: '#3b82f6', width: `${Number.isFinite(progressRatio) ? progressRatio * 100 : 0}%` }} />
                </div>
                <div className="tracking-progress-steps" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
                  {TIMELINE_STEPS.map((step) => {
                    const state = getLocalStepState(modalStatus, step)
                    return (
                      <div
                        key={`${statusModalOrderId}-${step}`}
                        className={`tracking-progress-step ${state === 'completed' ? 'tracking-progress-step-completed' : ''} ${state === 'active' ? 'tracking-progress-step-active' : ''}`}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}
                      >
                        <span className="tracking-progress-dot" aria-hidden="true" style={{ fontWeight: 'bold', color: state === 'completed' ? '#3b82f6' : state === 'active' ? '#10b981' : '#94a3b8' }}>
                          {state === 'completed' ? '✓' : state === 'active' ? '●' : '○'}
                        </span>
                        <span className="tracking-progress-label-wrap" style={{ textAlign: 'center', fontSize: '12px', marginTop: '4px' }}>
                          <span style={{ display: 'block', fontWeight: state === 'active' ? '600' : 'normal' }}>{step.replaceAll('_', ' ')}</span>
                          <span className="tracking-progress-time" style={{ fontSize: '10px', color: '#64748b' }}>{latestByStatus[step]?.timestamp ? new Date(latestByStatus[step].timestamp).toLocaleTimeString() : ''}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="section-card panel-stack tracking-subcard" style={{ marginTop: '24px', padding: '16px', background: '#f8fafc', borderRadius: '6px' }}>
                <p className="field-label" style={{ fontWeight: '600', marginBottom: '8px' }}>Timeline</p>
                <div className="tracking-vertical-timeline" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {TIMELINE_STEPS.map((step) => {
                    const state = getLocalStepState(modalStatus, step)
                    const entry = latestByStatus[step]
                    return (
                      <div key={`${statusModalOrderId}-timeline-${step}`} className={`tracking-vertical-item ${state === 'completed' ? 'tracking-vertical-item-completed' : ''} ${state === 'active' ? 'tracking-vertical-item-active' : ''}`} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <span className="tracking-vertical-marker" style={{ color: state === 'completed' ? '#3b82f6' : state === 'active' ? '#10b981' : '#94a3b8' }}>{state === 'completed' ? '✓' : state === 'active' ? '●' : '○'}</span>
                        <div>
                          <p className="tracking-vertical-title" style={{ fontWeight: state === 'active' ? '600' : 'normal', margin: 0 }}>{step.replaceAll('_', ' ')}</p>
                          <p className="tracking-vertical-time" style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>{entry?.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Pending'}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="section-card panel-stack tracking-subcard" style={{ marginTop: '24px', padding: '16px', background: '#f8fafc', borderRadius: '6px' }}>
                <p className="field-label" style={{ fontWeight: '600', marginBottom: '8px' }}>Tracking Logs & Events</p>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {logs.length ? (
                    logs.map((entry) => (
                      <p key={`${statusModalOrderId}-modal-log-${entry.id || entry.timestamp}`} style={{ margin: '4px 0', fontSize: '13px' }}>
                        <strong style={{ color: '#334155' }}>{String(entry.status || '').replaceAll('_', ' ')}</strong> · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Updated'}
                        {entry.location ? ` (at ${entry.location})` : ''}
                        {entry.message ? ` - ${entry.message}` : ''}
                      </p>
                    ))
                  ) : (
                    <p style={{ margin: 0, color: '#64748b' }}>No tracking events available yet.</p>
                  )}
                </div>
              </section>
            </div>
          </div>
        )
      })() : null}
    </section>
  )
}