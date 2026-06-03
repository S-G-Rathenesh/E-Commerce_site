import { useEffect, useMemo, useState, useRef } from 'react'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders } from '../utils/auth'
import DiscoveryProductCard from '../components/DiscoveryProductCard'
import { fetchCatalogProducts, fetchRecommendationsForCustomer } from '../utils/catalog'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const TRACKING_STEPS = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']
const EMPTY_FILTER = '__ALL__'

const STATUS_LABELS = {
  PLACED: 'Placed',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

const TRACKER_STEPS = [
  { key: 'PLACED', label: 'Placed', icon: '🛒' },
  { key: 'CONFIRMED', label: 'Confirmed', icon: '📋' },
  { key: 'PACKED', label: 'Packed', icon: '📦' },
  { key: 'OUT_FOR_DELIVERY', label: 'Out for delivery', icon: '🚚' },
  { key: 'DELIVERED', label: 'Delivered', icon: '🏠' },
]

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase()
}

function formatDateTime(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return 'Pending'
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function getPrimaryItem(order) {
  return Array.isArray(order?.items) ? order.items[0] : null
}

function getShipmentStatus(order) {
  return normalizeStatus(order?.shipment?.status || order?.status)
}

function getTrackerActiveIndex(order) {
  const status = getShipmentStatus(order)
  if (status === 'DELIVERED') return 4
  if (status === 'OUT_FOR_DELIVERY') return 3
  if (status === 'SHIPPED' || status === 'PACKED' || status === 'DISPATCHED') return 2
  if (status === 'CONFIRMED') return 1
  if (status === 'PLACED') return 0
  return -1
}

function formatTrackerMessage(order) {
  const status = getShipmentStatus(order)
  const lastEvent = Array.isArray(order?.shipment_events) && order.shipment_events.length > 0 ? order.shipment_events[order.shipment_events.length - 1] : null
  const deliveredAt = order?.status_timestamps?.DELIVERED || order?.updated_at || lastEvent?.timestamp

  if (status === 'DELIVERED') return `Delivered on ${formatDateTime(deliveredAt)}`
  if (status === 'OUT_FOR_DELIVERY') return 'Out for delivery today'
  if (status === 'SHIPPED' || status === 'DISPATCHED') return lastEvent?.message || 'Shipment dispatched'
  if (status === 'PACKED') return lastEvent?.message || 'Shipment packed and ready'
  if (status === 'CONFIRMED') return lastEvent?.message || 'Order confirmed'
  if (status === 'PLACED') return 'Order placed successfully'
  if (status === 'CANCELLED') return 'Order cancelled'
  return lastEvent?.message || 'Shipment in progress'
}

export default function OrdersTracking() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState(EMPTY_FILTER)
  const [yearFilter, setYearFilter] = useState('all')
  const [activeTab, setActiveTab] = useState('orders')
  const [expandedSpecs, setExpandedSpecs] = useState({})
  const [modalOrder, setModalOrder] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [recsLoading, setRecsLoading] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const recsRef = useRef(null)

  const loadOrders = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/orders/my`, { headers: buildAuthHeaders(), cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load orders.')
        setOrders([])
        return
      }
      setOrders(Array.isArray(data?.orders) ? data.orders : [])
      setMessage('')
    } catch (err) {
      setMessage('Unable to load orders right now.')
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
    const intervalId = setInterval(loadOrders, 15000)
    return () => clearInterval(intervalId)
  }, [])

  useEffect(() => {
    // compute recommendations after orders load
    if (!orders || orders.length === 0) {
      setRecommendations([])
      return
    }

    let mounted = true
    const cacheKey = 'recs_v1'
    const local = window.localStorage.getItem(cacheKey)
    try {
      if (local) {
        const parsed = JSON.parse(local)
        // quick heuristic: if orders length unchanged and signature matches, reuse
        if (parsed && parsed.signature === String(orders.length) && Array.isArray(parsed.items)) {
          setRecommendations(parsed.items)
          return
        }
      }
    } catch {}

    setRecsLoading(true)
    ;(async () => {
      try {
        const all = await fetchCatalogProducts()

        // gather most-purchased attributes
        const catCount = {}
        const sectionCount = {}
        const typeCount = {}
        const purchasedIds = new Set()

        orders.forEach((o) => {
          (o.items || []).forEach((it) => {
            const p = it.product || it
            if (!p) return
            purchasedIds.add(String(p.id || p.product_id || p._id || p._uid || p.name))
            if (p.category) catCount[p.category] = (catCount[p.category] || 0) + 1
            if (p.section) sectionCount[p.section] = (sectionCount[p.section] || 0) + 1
            if (p.productType) typeCount[p.productType] = (typeCount[p.productType] || 0) + 1
            if (p.product_type) typeCount[p.product_type] = (typeCount[p.product_type] || 0) + 1
          })
        })

        const topCategories = Object.entries(catCount).sort((a, b) => b[1] - a[1]).map((r) => r[0])
        const topSection = Object.entries(sectionCount).sort((a, b) => b[1] - a[1])[0]?.[0]
        const topTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map((r) => r[0])

        const picks = []
        const pushIf = (product) => {
          const id = String(product.id || product.product_id || product._id || product.name)
          if (purchasedIds.has(id)) return
          if (picks.find((p) => String(p.id || p.product_id || p._id || p.name) === id)) return
          picks.push(product)
        }

        // 1. previously purchased category
        if (topCategories.length > 0) {
          all.forEach((p) => { if (topCategories.includes(p.category)) pushIf(p) })
        }

        // 2. same section/gender
        if (topSection) {
          all.forEach((p) => { if (String(p.section) === String(topSection)) pushIf(p) })
        }

        // 3. similar product type
        if (topTypes.length > 0) {
          topTypes.forEach((t) => all.forEach((p) => { if ((p.productType || p.product_type) === t) pushIf(p) }))
        }

        // 4. popular/bestseller fallback - approximate by price desc then id
        const fallback = all.slice().sort((a, b) => (Number(b.price || 0) - Number(a.price || 0)))
        fallback.forEach((p) => pushIf(p))

        const final = picks.slice(0, 12)
        if (mounted) {
          setRecommendations(final)
          try { window.localStorage.setItem(cacheKey, JSON.stringify({ signature: String(orders.length), items: final })) } catch {}
        }
      } catch (err) {
        // ignore recommendation failures
      } finally {
        if (mounted) setRecsLoading(false)
      }
    })()

    return () => { mounted = false }
  }, [orders])

  const years = useMemo(() => {
    const setYears = new Set()
    orders.forEach((o) => {
      try {
        const d = new Date(o.created_at)
        if (!Number.isNaN(d.getFullYear())) setYears.add(String(d.getFullYear()))
      } catch {}
    })
    return Array.from(setYears).sort((a, b) => Number(b) - Number(a))
  }, [orders])

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return orders.filter((order) => {
      if (statusFilter !== EMPTY_FILTER) {
        const s = normalizeStatus(order?.status)
        const shipmentS = getShipmentStatus(order)
        if (s !== statusFilter && shipmentS !== statusFilter) return false
      }
      if (yearFilter !== 'all') {
        const d = new Date(order.created_at)
        if (String(d.getFullYear()) !== yearFilter) return false
      }
      if (!q) return true
      const hay = [order.order_id, order.customer_name, order.customer_email, order?.shipment?.tracking_id, ...(Array.isArray(order.items) ? order.items.map((i) => i.name) : [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [orders, searchQuery, statusFilter, yearFilter])

  const buyAgainItems = useMemo(() => {
    const seen = new Set()
    const items = []
    orders.forEach((order) => {
      (order.items || []).forEach((it) => {
        const id = String(it.product_id || it.id || it.name)
        if (!seen.has(id)) {
          seen.add(id)
          items.push(it)
        }
      })
    })
    return items.slice(0, 12)
  }, [orders])

  const handleCancel = async (orderId) => {
    try {
      await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'PUT', headers: buildAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) })
      await loadOrders()
    } catch (err) {
      setMessage('Unable to cancel order right now.')
    }
  }

  const openDetailsModal = (order) => setModalOrder(order)
  const closeDetailsModal = () => setModalOrder(null)

  return (
    <PageWrapper eyebrow="Orders" title="My Orders" description="Your purchases and tracking summarized in a clean, Amazon-style layout.">
      <section className="panel panel-stack orders-panel">
        <div className="orders-topbar">
          <div className="orders-tabs">
            <button className={`tab ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>Orders</button>
            <button className={`tab ${activeTab === 'buyagain' ? 'active' : ''}`} onClick={() => setActiveTab('buyagain')}>Buy Again</button>
            <button className={`tab ${activeTab === 'notshipped' ? 'active' : ''}`} onClick={() => setActiveTab('notshipped')}>Not Yet Shipped</button>
          </div>

          <div className="orders-controls">
            <input className="field" placeholder="Search all orders" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <select className="field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value={EMPTY_FILTER}>All Orders</option>
              <option value="DELIVERED">Delivered</option>
              <option value="SHIPPED">Shipped</option>
              <option value="PACKED">Packed</option>
              <option value="OUT_FOR_DELIVERY">Out For Delivery</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select className="field" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="all">All years</option>
              {years.map((y) => (<option key={y} value={y}>{y}</option>))}
            </select>
            <button className="btn btn-secondary" onClick={loadOrders} disabled={loading}>{loading ? 'Refreshing...' : 'Search'}</button>
          </div>
        </div>

        {activeTab === 'buyagain' ? (
          <div className="buy-again-row">
            <h3>Buy Again</h3>
            <div className="horizontal-scroll">
              {buyAgainItems.map((it) => (
                <div key={`${it.product_id || it.id}-${it.name}`} style={{ width: 200, padding: 8 }}>
                  <DiscoveryProductCard product={{ id: it.product_id || it.id, title: it.name, image: it.image, price: it.price }} onAddToCart={() => { window.location.assign('/cart') }} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === 'orders' || activeTab === 'notshipped' ? (
          <div className="orders-list">
            {filteredOrders.length === 0 && !loading ? <p>No orders found.</p> : null}
            {filteredOrders.map((order) => {
              const primary = getPrimaryItem(order) || {}
              const status = getShipmentStatus(order)
              const placedDate = formatDateTime(order.created_at)
              const total = Number(order.total_amount || order.total || 0)
              const shipTo = order.shipping_details?.full_name || order.customer_name || ''

              const statusBadgeClass = status === 'DELIVERED' ? 'badge-delivered' : status === 'SHIPPED' ? 'badge-shipped' : status === 'PACKED' ? 'badge-packed' : status === 'OUT_FOR_DELIVERY' ? 'badge-out' : status === 'CANCELLED' ? 'badge-cancelled' : 'badge-default'

              return (
                <article key={order.order_id} className="order-card panel-stack">
                  <div className="order-topbar">
                    <div className="order-meta">
                      <div>
                        <p className="meta-label">ORDER PLACED</p>
                        <p className="meta-value">{placedDate}</p>
                      </div>
                      <div>
                        <p className="meta-label">TOTAL</p>
                        <p className="meta-value">₹{total.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="meta-label">SHIP TO</p>
                        <p className="meta-value">{shipTo}</p>
                      </div>
                      <div>
                        <p className="meta-label">ORDER #</p>
                        <p className="meta-value">{order.order_id}</p>
                      </div>
                    </div>
                  </div>

                  <div className="order-items-row">
                    <div className="item-thumb">
                      {primary.image ? <img src={primary.image} alt={primary.name} /> : <div className="placeholder-thumb" />}
                    </div>

                    <div className="item-main">
                      <h4 className="item-title">{primary.name}</h4>
                      <p className="delivery-message">{order.shipment?.status ? (order.shipment?.status === 'DELIVERED' ? `Delivered on ${formatDateTime(order.status_timestamps?.DELIVERED || order.updated_at)}` : order.shipment?.status.replaceAll('_', ' ')) : ''}</p>
                      <div className={`status-badge ${statusBadgeClass}`}>{STATUS_LABELS[status] || status.replaceAll('_', ' ')}</div>

                      <div className="item-attrs">
                        <span>Qty: {primary.quantity || 1}</span>

                      <div className="order-live-tracker">
                        <div className="order-live-tracker-row" aria-label="Order progress tracker">
                          {TRACKER_STEPS.map((step, index) => {
                            const activeIndex = getTrackerActiveIndex(order)
                            const isCompleted = activeIndex >= 0 && index < activeIndex
                            const isCurrent = activeIndex === index
                            const isPending = activeIndex < 0 || index > activeIndex

                            return (
                              <span key={step.key} className="tracker-segment-group">
                                <span
                                  className={`tracker-step tracker-step-card ${isCompleted ? 'is-completed' : ''} ${isCurrent ? 'is-current' : ''} ${isPending ? 'is-pending' : ''}`.trim()}
                                  aria-current={isCurrent ? 'step' : undefined}
                                  aria-label={`${step.label} ${isCompleted ? 'completed' : isCurrent ? 'current' : 'pending'}`}
                                >
                                  <span className="tracker-step-icon" aria-hidden="true">{step.icon}</span>
                                </span>
                                {index < TRACKER_STEPS.length - 1 ? (
                                  <span className={`tracker-connector ${activeIndex > index ? 'is-filled' : 'is-pending'}`} aria-hidden="true" />
                                ) : null}
                              </span>
                            )
                          })}
                        </div>
                        <div className="order-live-tracker-footer">
                          <span className="shipment-tracker-status">{formatTrackerMessage(order)}</span>
                        </div>
                      </div>
                        {primary.size ? <span>Size: {primary.size}</span> : null}
                        {primary.color ? <span>Color: {primary.color}</span> : null}
                        <strong className="item-price">₹{Number(primary.price || primary.unit_price || 0).toFixed(2)}</strong>
                      </div>
                    </div>

                    <div className="item-cta">
                      {/* Order-level actions moved into right column */}
                      <div className="order-actions-inline">
                        <button className="btn btn-secondary" onClick={() => openDetailsModal(order)}>View order details</button>
                        <button className="btn btn-secondary">Invoice</button>
                      </div>

                      {status === 'DELIVERED' ? (
                        <>
                          <button className="btn btn-primary" onClick={() => window.location.assign('/products')}>Buy Again</button>
                          <button className="btn btn-secondary">Write Review</button>
                          <button className="btn btn-secondary" onClick={() => window.location.assign(`/product/${primary.product_id || primary.id}`)}>View Product</button>
                        </>
                      ) : status === 'SHIPPED' ? (
                        <button className="btn btn-primary btn-small" onClick={() => openDetailsModal(order)}>Track Package</button>
                      ) : status === 'PACKED' ? (
                        <button className="btn btn-secondary">Ready for dispatch</button>
                      ) : status === 'OUT_FOR_DELIVERY' ? (
                        <button className="btn btn-primary" onClick={() => openDetailsModal(order)}>Track Live</button>
                      ) : status === 'CANCELLED' ? (
                        <button className="btn btn-primary" onClick={() => window.location.assign('/products')}>Reorder</button>
                      ) : (
                        <div className="row-gap">
                          <button className="btn btn-secondary" onClick={() => handleCancel(order.order_id)}>Cancel order</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* expandable product specs */}
                  <div className="order-specs">
                    <button className="btn btn-link" onClick={() => setExpandedSpecs((s) => ({ ...s, [order.order_id]: !s[order.order_id] }))}>
                      {expandedSpecs[order.order_id] ? 'Hide product details' : 'Product details & specifications'}
                    </button>
                    {expandedSpecs[order.order_id] && primary.product ? (
                      <div className="spec-table">
                        {['fabric','fit_type','pattern','sleeve_type','material','occasion','brand','wash_care','color','available_sizes'].map((k) => (
                          primary.product[k] ? (
                            <div key={k} className="spec-row"><strong>{k.replaceAll('_',' ')}:</strong> <span>{Array.isArray(primary.product[k]) ? primary.product[k].join(', ') : String(primary.product[k])}</span></div>
                          ) : null
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}

        {/* Recommendations carousel */}
        <div className="recommended-section">
          <h3>Recommended based on your shopping trends</h3>
          <div className="recommend-carousel-controls">
            <button className="btn btn-secondary" onClick={() => { if (recsRef.current) recsRef.current.scrollBy({ left: -recsRef.current.clientWidth * 0.8, behavior: 'smooth' }) }} aria-label="Previous">◀</button>
            <div className="recommend-carousel" ref={recsRef}>
              {recsLoading ? <p>Loading recommendations...</p> : null}
              {!recsLoading && recommendations.length === 0 ? <p className="muted">No recommendations yet — shop to get personalized picks.</p> : null}
              {recommendations.map((p) => (
                <div key={p.id} className="recommend-card">
                  <DiscoveryProductCard
                    product={{ id: p.id, title: p.title || p.name, image: p.image, price: p.price, mrp: p.mrp || 0, discount: p.discount_percent || 0, rating: p.rating || 0, badge: p.badge || '' }}
                    onAddToCart={() => {
                      setToastMessage('✅ Added to cart')
                      setTimeout(() => setToastMessage(''), 3000)
                    }}
                    onToggleWishlist={() => {
                      setToastMessage('❤️ Added to wishlist')
                      setTimeout(() => setToastMessage(''), 3000)
                    }}
                  />
                </div>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={() => { if (recsRef.current) recsRef.current.scrollBy({ left: recsRef.current.clientWidth * 0.8, behavior: 'smooth' }) }} aria-label="Next">▶</button>
          </div>
        </div>

        {modalOrder ? (
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal-panel">
              <header>
                <h3>Order {modalOrder.order_id} — Tracking</h3>
                <button className="btn btn-link" onClick={closeDetailsModal}>Close</button>
              </header>
              <div className="modal-body">
                <p><strong>Tracking ID:</strong> {modalOrder.shipment?.tracking_id || 'Pending'}</p>
                <p><strong>ETA:</strong> {modalOrder.shipment?.eta || '—'}</p>
                <p><strong>Current location:</strong> {modalOrder.shipment?.current_location || (modalOrder.shipment_events && modalOrder.shipment_events.length ? modalOrder.shipment_events[modalOrder.shipment_events.length - 1].location : 'Pending')}</p>
                <p><strong>Next destination:</strong> {(() => {
                  const route = modalOrder.shipment?.route || []
                  if (!route.length) return '—'
                  const current = modalOrder.shipment?.current_location || (modalOrder.shipment_events && modalOrder.shipment_events.length ? modalOrder.shipment_events[modalOrder.shipment_events.length - 1].location : '')
                  const idx = route.findIndex((r) => String(r).toLowerCase() === String(current).toLowerCase())
                  if (idx >= 0 && idx < route.length - 1) return route[idx + 1]
                  // fallback: next unprocessed stage
                  return route.find((r) => r !== current) || '—'
                })()}</p>

                <div className="shipment-tracker-card">
                  <div className="shipment-tracker-row" aria-label="Shipment progress tracker">
                    {TRACKER_STEPS.map((step, index) => {
                      const activeIndex = getTrackerActiveIndex(modalOrder)
                      const isCompleted = activeIndex >= 0 && index < activeIndex
                      const isCurrent = activeIndex === index
                      const isPending = activeIndex < 0 || index > activeIndex

                      return (
                        <span key={step.key} className="tracker-segment-group">
                          <span
                            className={`tracker-step ${isCompleted ? 'is-completed' : ''} ${isCurrent ? 'is-current' : ''} ${isPending ? 'is-pending' : ''}`.trim()}
                            aria-current={isCurrent ? 'step' : undefined}
                            aria-label={`${step.label} ${isCompleted ? 'completed' : isCurrent ? 'current' : 'pending'}`}
                          >
                            <span className="tracker-step-icon" aria-hidden="true">{step.icon}</span>
                          </span>
                          {index < TRACKER_STEPS.length - 1 ? (
                            <span className={`tracker-connector ${activeIndex > index ? 'is-filled' : 'is-pending'}`} aria-hidden="true" />
                          ) : null}
                        </span>
                      )
                    })}
                  </div>
                  <div className="shipment-tracker-status">{formatTrackerMessage(modalOrder)}</div>
                </div>

                  <div className="tracking-metadata-row">
                    <span className="tracker-hint">Use the tracker above to follow shipment progress.</span>
                  </div>
              </div>
            </div>
          </div>
        ) : null}
        {toastMessage ? (
          <div className="app-toast" role="status" aria-live="polite">{toastMessage}</div>
        ) : null}
      </section>
    </PageWrapper>
  )
}
