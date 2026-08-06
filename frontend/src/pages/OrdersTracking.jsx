import { useEffect, useMemo, useState, useRef } from 'react'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders, refreshAuthToken } from '../utils/auth'
import DiscoveryProductCard from '../components/DiscoveryProductCard'
import DeliveryRating from '../components/DeliveryRating'
import ProductReview from '../components/ProductReview'
import { fetchCatalogProducts } from '../utils/catalog'
import { addToCart } from '../utils/cart'
import { addToWishlist } from '../utils/wishlist'
import { resolveImageUrl } from '../utils/resolveImageUrl'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const EMPTY_FILTER = '__ALL__'

/* ── ETA cache: order_id → { eta_text, arrived_early, status_message, eta_date } ── */
const etaCache = {}

async function fetchOrderEta(orderId) {
  try {
    const { buildAuthHeaders } = await import('../utils/auth')
    const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/eta`, {
      headers: buildAuthHeaders(),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

const STATUS_LABELS = {
  PLACED: 'Order Placed',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  ACCEPTED: 'Accepted',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

/* Steps shown in the inline tracker — matches reference image exactly */
const TRACKER_STEPS = [
  { key: 'PLACED', label: 'Order\nPlaced', icon: '🛒' },
  { key: 'CONFIRMED', label: 'Order\nConfirmed', icon: '📋' },
  { key: 'PACKED', label: 'Packed', icon: '📦' },
  { key: 'SHIPPED', label: 'Shipped', icon: '🚚' },
  { key: 'DELIVERED', label: 'Delivered', icon: '🏠' },
]

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase()
}

function formatDateTime(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return 'Pending'
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatDateShort(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short' })
}

function formatStepDateTime(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return ''
  const shortDate = date.toLocaleString('en-IN', { day: '2-digit', month: 'short' })
  const timeStr = date.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${shortDate} • ${timeStr}`
}

function getPrimaryItem(order) {
  return Array.isArray(order?.items) ? order.items[0] : null
}

function getShipmentStatus(order) {
  const shipmentStatus = normalizeStatus(order?.shipment?.status || '')
  const orderStatus = normalizeStatus(order?.status || '')
  if (shipmentStatus && shipmentStatus !== 'CREATED') return shipmentStatus
  return orderStatus
}

function getTrackerActiveIndex(order) {
  const status = getShipmentStatus(order)
  const orderStatus = normalizeStatus(order?.status || '')
  if (status === 'DELIVERED' || orderStatus === 'DELIVERED') return 4
  if (status === 'OUT_FOR_DELIVERY' || status === 'DISPATCHED'
    || status === 'IN_TRANSIT' || status === 'ARRIVED_AT_CITY'
    || orderStatus === 'OUT_FOR_DELIVERY' || orderStatus === 'SHIPPED'
    || status === 'SHIPPED') return 3
  if (status === 'PACKED' || orderStatus === 'PACKED' || orderStatus === 'ACCEPTED') return 2
  if (status === 'CONFIRMED' || orderStatus === 'CONFIRMED') return 1
  if (status === 'PLACED' || orderStatus === 'PLACED') return 0
  return -1
}

function formatTrackerMessage(order) {
  const status = getShipmentStatus(order)
  const orderStatus = normalizeStatus(order?.status || '')
  const lastEvent = Array.isArray(order?.shipment_events) && order.shipment_events.length > 0
    ? order.shipment_events[order.shipment_events.length - 1]
    : null
  const deliveredAt = order?.status_timestamps?.DELIVERED || order?.updated_at || lastEvent?.timestamp

  if (status === 'DELIVERED' || orderStatus === 'DELIVERED')
    return `Delivered on ${formatDateTime(deliveredAt)}`
  if (status === 'OUT_FOR_DELIVERY' || orderStatus === 'OUT_FOR_DELIVERY')
    return lastEvent?.message || 'Out for delivery today'
  if (status === 'ARRIVED_AT_CITY') return lastEvent?.message || 'Arrived at destination city hub'
  if (status === 'IN_TRANSIT') return lastEvent?.message || order?.shipment?.current_location || 'Shipment in transit'
  if (status === 'DISPATCHED' || status === 'SHIPPED' || orderStatus === 'SHIPPED')
    return lastEvent?.message || order?.shipment?.current_location || 'Shipment dispatched'
  if (status === 'PACKED' || orderStatus === 'PACKED') return lastEvent?.message || 'Shipment packed and ready'
  if (orderStatus === 'ACCEPTED') return lastEvent?.message || 'Order accepted by delivery partner'
  if (status === 'CONFIRMED' || orderStatus === 'CONFIRMED') return lastEvent?.message || 'Order confirmed'
  if (status === 'PLACED' || orderStatus === 'PLACED') return 'Order placed successfully'
  if (status === 'CANCELLED') return 'Order cancelled'
  return lastEvent?.message || order?.shipment?.current_location || 'Shipment in progress'
}

/* Returns the date string for each tracker step, or '' */
function getStepDate(order, stepKey) {
  const ts = order?.status_timestamps || {}
  const mapping = {
    PLACED: ts.PLACED || order?.created_at,
    CONFIRMED: ts.CONFIRMED || '',
    PACKED: ts.PACKED || '',
    SHIPPED: ts.SHIPPED || order?.shipment?.dispatched_at || '',
    DELIVERED: ts.DELIVERED || order?.updated_at || '',
  }
  const raw = mapping[stepKey] || ''
  return raw ? formatStepDateTime(raw) : ''
}

/* ——— Order Card ——— */
function OrderCard({ order, eta, onOpenDetails, onOpenReview, onCancel, reviewProductId, reviewOrderId, onCloseReview, onToast, onViewInvoice, onBuyAgain }) {
  const [specsOpen, setSpecsOpen] = useState(false)
  const [deliveryRatingOpen, setDeliveryRatingOpen] = useState(false)
  const primary = getPrimaryItem(order) || {}
  const status = getShipmentStatus(order)
  const placedDate = formatDateTime(order.created_at)
  const total = Number(order.total_amount || order.total || 0)
  const shipTo = order.shipping_details?.full_name || order.customer_name || '—'
  const activeIndex = getTrackerActiveIndex(order)
  const isDelivered = status === 'DELIVERED' || normalizeStatus(order?.status) === 'DELIVERED'
  const isCancelled = status === 'CANCELLED'

  const statusBadgeClass =
    isDelivered ? 'ot-badge ot-badge--delivered' :
      status === 'SHIPPED' ? 'ot-badge ot-badge--shipped' :
        status === 'PACKED' ? 'ot-badge ot-badge--packed' :
          status === 'OUT_FOR_DELIVERY' ? 'ot-badge ot-badge--out' :
            isCancelled ? 'ot-badge ot-badge--cancelled' :
              'ot-badge ot-badge--default'

  return (
    <article className="ot-card">
      {/* ── Header row ──────────────────────────────────────── */}
      <div className="ot-card__header">
        <div className="ot-card__meta-group">
          <div className="ot-card__meta-item">
            <span className="ot-meta-label">ORDER PLACED</span>
            <span className="ot-meta-value">{placedDate}</span>
          </div>
          <div className="ot-card__meta-item">
            <span className="ot-meta-label">TOTAL</span>
            <span className="ot-meta-value">₹{total.toFixed(2)}</span>
          </div>
          <div className="ot-card__meta-item">
            <span className="ot-meta-label">SHIP TO</span>
            <span className="ot-meta-value">{shipTo}</span>
          </div>
        </div>
        <button className="ot-card__arrow-btn" onClick={() => onOpenDetails(order)} aria-label="View order details">›</button>
      </div>

      {/* ── Product row ─────────────────────────────────────── */}
      <div className="ot-card__body">
        {/* Thumbnail */}
        <div className="ot-thumb">
          {primary.image
            ? <img src={resolveImageUrl(primary.image)} alt={primary.name} />
            : <div className="ot-thumb__placeholder" />}
        </div>

        {/* Info column */}
        <div className="ot-info">
          <h4 className="ot-info__name">{primary.name || 'Product'}</h4>
          <p className="ot-info__delivery-msg">
            {eta?.status_message || formatTrackerMessage(order)}
          </p>

          {/* Early arrival banner */}
          {eta?.arrived_early && !isDelivered && (
            <div className="ot-early-banner" role="status" aria-live="polite">
              <span className="ot-early-banner__icon">🚀</span>
              <div>
                <strong>Arriving earlier than expected!</strong>
                <span>{eta.eta_text}</span>
                {eta.original_delivery_text && (
                  <span className="ot-early-banner__original">{eta.original_delivery_text}</span>
                )}
              </div>
            </div>
          )}

          {/* Dynamic ETA line for active orders */}
          {!isDelivered && !isCancelled && eta?.eta_text && !eta.arrived_early && (
            <p className="ot-info__eta">📅 {eta.eta_text}</p>
          )}

          {/* Status badge */}
          <span className={statusBadgeClass}>{STATUS_LABELS[status] || status.replaceAll('_', ' ')}</span>

          {/* Qty / size / price */}
          <div className="ot-info__attrs">
            <span>Qty: {primary.quantity || 1}</span>
            {primary.size ? <span>Size: {primary.size}</span> : null}
            {primary.color ? <span>Color: {primary.color}</span> : null}
            <strong className="ot-info__price">₹{Number(primary.price || primary.unit_price || 0).toFixed(2)}</strong>
          </div>

          {/* Step tracker */}
          {!isCancelled && (
            <div className="ot-tracker">
              {TRACKER_STEPS.map((step, index) => {
                const isCompleted = activeIndex >= 0 && index < activeIndex
                const isCurrent = activeIndex === index
                const isPending = activeIndex < 0 || index > activeIndex
                const stepDate = getStepDate(order, step.key)

                return (
                  <span key={step.key} className="ot-tracker__segment">
                    <span className="ot-tracker__node-wrap">
                      <span
                        className={[
                          'ot-tracker__node',
                          isCompleted ? 'is-completed' : '',
                          isCurrent ? 'is-current' : '',
                          isPending ? 'is-pending' : '',
                        ].join(' ').trim()}
                        aria-current={isCurrent ? 'step' : undefined}
                        aria-label={`${step.label.replace('\n', ' ')} ${isCompleted ? 'completed' : isCurrent ? 'current' : 'pending'}`}
                      >
                        <span className="ot-tracker__icon" aria-hidden="true">{step.icon}</span>
                      </span>
                      <span className="ot-tracker__label">
                        {step.label.split('\n').map((line, i) => (
                          <span key={i}>{line}</span>
                        ))}
                      </span>
                      {stepDate && <span className="ot-tracker__date">{stepDate}</span>}
                    </span>
                    {index < TRACKER_STEPS.length - 1 && (
                      <span
                        className={`ot-tracker__connector ${activeIndex > index ? 'is-filled' : 'is-pending'}`}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                )
              })}
            </div>
          )}

          {/* Specs toggle */}
          <button className="ot-link-btn" onClick={() => setSpecsOpen(v => !v)}>
            {specsOpen ? 'Hide product details' : 'Product details & specifications'}
          </button>
          {specsOpen && primary.product && (
            <div className="ot-spec-table">
              {['fabric', 'fit_type', 'pattern', 'sleeve_type', 'material', 'occasion', 'brand', 'wash_care', 'color', 'available_sizes'].map(k =>
                primary.product[k] ? (
                  <div key={k} className="ot-spec-row">
                    <strong>{k.replaceAll('_', ' ')}:</strong>
                    <span>{Array.isArray(primary.product[k]) ? primary.product[k].join(', ') : String(primary.product[k])}</span>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* Review form */}
          {isDelivered && reviewProductId === (primary.product_id || primary.id) && reviewOrderId === order.order_id && (
            <ProductReview
              productId={primary.product_id || primary.id}
              orderId={order.order_id}
              onSubmitSuccess={() => {
                onCloseReview()
                onToast('✅ Review submitted successfully!')
              }}
            />
          )}

          {/* Delivery rating */}
          {isDelivered && deliveryRatingOpen && <DeliveryRating orderId={order.order_id} />}
        </div>

        {/* CTA column */}
        <div className="ot-cta">
          {isDelivered ? (
            <>
              <button className="ot-cta__btn ot-cta__btn--primary" onClick={() => setDeliveryRatingOpen(v => !v)}>
                {deliveryRatingOpen ? 'Hide Delivery Rating' : 'Rate Delivery'}
              </button>
              <button className="ot-cta__btn ot-cta__btn--outline" onClick={() => onBuyAgain(primary)}>Buy Again</button>
              <button className="ot-cta__btn ot-cta__btn--outline" onClick={() => onViewInvoice(order)}>View Invoice</button>
              <button className="ot-cta__btn ot-cta__btn--ghost" onClick={() => onOpenReview(primary.product_id || primary.id, order.order_id)}>
                ⭐ Write Review
              </button>
            </>
          ) : status === 'SHIPPED' || status === 'OUT_FOR_DELIVERY' ? (
            <>
              <button className="ot-cta__btn ot-cta__btn--primary" onClick={() => onOpenDetails(order)}>Track Package</button>
              <button className="ot-cta__btn ot-cta__btn--outline" onClick={() => onViewInvoice(order)}>View Invoice</button>
            </>
          ) : isCancelled ? (
            <>
              <button className="ot-cta__btn ot-cta__btn--primary" onClick={() => onBuyAgain(primary)}>Reorder</button>
              <button className="ot-cta__btn ot-cta__btn--outline" onClick={() => onViewInvoice(order)}>View Invoice</button>
            </>
          ) : (
            <>
              <button className="ot-cta__btn ot-cta__btn--outline" onClick={() => onOpenDetails(order)}>View Details</button>
              <button className="ot-cta__btn ot-cta__btn--outline" onClick={() => onViewInvoice(order)}>View Invoice</button>
              <button className="ot-cta__btn ot-cta__btn--ghost ot-cta__btn--cancel" onClick={() => onCancel(order.order_id)}>Cancel order</button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

/* ——— Main Page ——— */
export default function OrdersTracking() {
  const [orders, setOrders] = useState([])
  const [etaMap, setEtaMap] = useState({}) // order_id → eta data
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState(EMPTY_FILTER)
  const [yearFilter, setYearFilter] = useState('all')
  const [activeTab, setActiveTab] = useState('orders')
  const [modalOrder, setModalOrder] = useState(null)
  const [reviewProductId, setReviewProductId] = useState(null)
  const [reviewOrderId, setReviewOrderId] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [recsLoading, setRecsLoading] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const recsRef = useRef(null)

  const loadOrders = async () => {
    setLoading(true)
    try {
      let response = await fetch(`${API_BASE}/orders/my`, { headers: buildAuthHeaders(), cache: 'no-store' })

      // If token expired, try to refresh and retry once
      if (response.status === 401) {
        const refreshed = await refreshAuthToken(API_BASE)
        if (refreshed) {
          response = await fetch(`${API_BASE}/orders/my`, { headers: buildAuthHeaders(), cache: 'no-store' })
        }
      }

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load orders.')
        setOrders([])
        return
      }
      const freshOrders = Array.isArray(data) ? data : (Array.isArray(data?.orders) ? data.orders : [])
      setOrders(freshOrders)
      setMessage('')

      // Fetch ETA for every non-delivered, non-cancelled order in the background
      const activeOrders = freshOrders.filter(o => {
        const s = normalizeStatus(o?.status)
        return !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(s)
      })
      // Also refresh delivered orders that haven't been cached yet
      const uncachedDelivered = freshOrders.filter(o =>
        normalizeStatus(o?.status) === 'DELIVERED' && !etaCache[o.order_id]
      )
      const toFetch = [...activeOrders, ...uncachedDelivered]
      if (toFetch.length > 0) {
        Promise.allSettled(
          toFetch.map(o => fetchOrderEta(o.order_id).then(eta => ({ id: o.order_id, eta })))
        ).then(results => {
          const updates = {}
          results.forEach(r => { if (r.status === 'fulfilled' && r.value?.eta) { updates[r.value.id] = r.value.eta; etaCache[r.value.id] = r.value.eta } })
          if (Object.keys(updates).length > 0) setEtaMap(prev => ({ ...prev, ...updates }))
        })
      }
    } catch {
      setMessage('Unable to load orders right now.')
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
    const handleNotificationChange = () => {
      loadOrders()
    }
    window.addEventListener('notifications-changed', handleNotificationChange)
    const id = setInterval(loadOrders, 15000)
    return () => {
      clearInterval(id)
      window.removeEventListener('notifications-changed', handleNotificationChange)
    }
  }, [])

  useEffect(() => {
    if (!orders || orders.length === 0) { setRecommendations([]); return }
    let mounted = true
    const cacheKey = 'recs_v1'
    try {
      const local = window.localStorage.getItem(cacheKey)
      if (local) {
        const parsed = JSON.parse(local)
        if (parsed && parsed.signature === String(orders.length) && Array.isArray(parsed.items)) {
          setRecommendations(parsed.items); return
        }
      }
    } catch { }
    setRecsLoading(true)
      ; (async () => {
        try {
          const all = await fetchCatalogProducts()
          const catCount = {}, purchasedIds = new Set()
          orders.forEach(o => {
            (o.items || []).forEach(it => {
              const p = it.product || it; if (!p) return
              purchasedIds.add(String(p.id || p.product_id || p._id || p.name))
              if (p.category) catCount[p.category] = (catCount[p.category] || 0) + 1
            })
          })
          const topCategories = Object.entries(catCount).sort((a, b) => b[1] - a[1]).map(r => r[0])
          const picks = []
          const pushIf = product => {
            const id = String(product.id || product.product_id || product._id || product.name)
            if (purchasedIds.has(id)) return
            if (picks.find(p => String(p.id || p.product_id || p._id || p.name) === id)) return
            picks.push(product)
          }
          if (topCategories.length > 0) all.forEach(p => { if (topCategories.includes(p.category)) pushIf(p) })
          all.slice().sort((a, b) => Number(b.price || 0) - Number(a.price || 0)).forEach(p => pushIf(p))
          const final = picks.slice(0, 12)
          if (mounted) {
            setRecommendations(final)
            try { window.localStorage.setItem(cacheKey, JSON.stringify({ signature: String(orders.length), items: final })) } catch { }
          }
        } catch { } finally { if (mounted) setRecsLoading(false) }
      })()
    return () => { mounted = false }
  }, [orders])

  const years = useMemo(() => {
    const s = new Set()
    orders.forEach(o => { try { const d = new Date(o.created_at); if (!Number.isNaN(d.getFullYear())) s.add(String(d.getFullYear())) } catch { } })
    return Array.from(s).sort((a, b) => Number(b) - Number(a))
  }, [orders])

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return orders.filter(order => {
      if (statusFilter !== EMPTY_FILTER) {
        const s = normalizeStatus(order?.status)
        const ss = getShipmentStatus(order)
        if (s !== statusFilter && ss !== statusFilter) return false
      }
      if (yearFilter !== 'all') {
        const d = new Date(order.created_at)
        if (String(d.getFullYear()) !== yearFilter) return false
      }
      if (!q) return true
      const hay = [order.order_id, order.customer_name, order.customer_email, order?.shipment?.tracking_id,
      ...(Array.isArray(order.items) ? order.items.map(i => i.name) : [])]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [orders, searchQuery, statusFilter, yearFilter])

  const buyAgainItems = useMemo(() => {
    const seen = new Set(); const items = []
    orders.forEach(o => {
      (o.items || []).forEach(it => {
        const id = String(it.product_id || it.id || it.name)
        if (!seen.has(id)) { seen.add(id); items.push(it) }
      })
    })
    return items.slice(0, 12)
  }, [orders])

  const notShipped = useMemo(() =>
    filteredOrders.filter(o => {
      const s = getShipmentStatus(o)
      return !['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(s)
    }), [filteredOrders])

  const displayOrders = activeTab === 'notshipped' ? notShipped : filteredOrders

  const handleCancel = async (orderId) => {
    try {
      await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'PUT', headers: buildAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({})
      })
      await loadOrders()
    } catch {
      setMessage('Unable to cancel order right now.')
    }
  }

  const handleViewInvoice = (order) => {
    const invoiceHtml = `
      <html>
        <head>
          <title>Invoice - ${order.order_id}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; max-width: 800px; margin: 0 auto; line-height: 1.5; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: 800; color: #2563eb; letter-spacing: -0.025em; }
            .invoice-title { font-size: 28px; font-weight: 800; text-align: right; }
            .details { display: flex; justify-content: space-between; margin-bottom: 40px; }
            .details h3 { font-size: 12px; text-transform: uppercase; color: #64748b; margin-bottom: 8px; margin-top: 0; }
            .details p { margin: 2px 0; font-size: 14px; font-weight: 500; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
            th { background: #f8fafc; text-align: left; padding: 12px 16px; font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: 700; border-bottom: 1px solid #e2e8f0; }
            td { padding: 16px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
            .num { text-align: right; }
            .totals { margin-left: auto; width: 300px; border-top: 2px solid #e2e8f0; padding-top: 20px; }
            .totals-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
            .totals-row.grand { font-size: 18px; font-weight: 800; color: #1e293b; margin-top: 10px; border-top: 1px solid #f1f5f9; padding-top: 10px; }
            .footer { text-align: center; margin-top: 60px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }
            .print-btn { display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; font-weight: 600; text-decoration: none; font-size: 14px; border: none; cursor: pointer; margin-bottom: 20px; }
            @media print { .print-btn { display: none; } }
          </style>
        </head>
        <body>
          <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
          <div class="header">
            <div>
              <div class="logo">Movi Fashion</div>
              <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">Premium E-Commerce Platform</p>
            </div>
            <div>
              <div class="invoice-title">INVOICE</div>
              <p style="margin: 4px 0 0; font-size: 14px; text-align: right;"><strong>Invoice No:</strong> INV-${order.order_id.replace('ORD-', '')}</p>
              <p style="margin: 2px 0 0; font-size: 14px; text-align: right;"><strong>Date:</strong> ${new Date(order.created_at).toLocaleDateString('en-IN')}</p>
            </div>
          </div>
          
          <div class="details">
            <div>
              <h3>Billed To</h3>
              <p><strong>${order.shipping_details?.full_name || order.customer_name || 'Customer'}</strong></p>
              <p>${order.shipping_details?.address || 'Shipping Address'}</p>
              <p>${order.shipping_details?.city || ''}, ${order.shipping_details?.state || ''} - ${order.shipping_details?.pincode || ''}</p>
              <p>Phone: ${order.shipping_details?.phone || '—'}</p>
            </div>
            <div>
              <h3>Payment Status</h3>
              <p><strong>Method:</strong> ${order.payment_method || 'COD'}</p>
              <p><strong>Status:</strong> ${order.payment_status || 'Paid'}</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Item Description</th>
                <th class="num">Unit Price</th>
                <th class="num">Qty</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${(order.items || []).map(item => `
                <tr>
                  <td>
                    <strong>${item.name || 'Product'}</strong>
                    ${item.size ? `<br><span style="font-size: 12px; color: #64748b;">Size: ${item.size}</span>` : ''}
                    ${item.color ? `<span style="font-size: 12px; color: #64748b; margin-left: 10px;">Color: ${item.color}</span>` : ''}
                  </td>
                  <td class="num">₹${Number(item.price || item.unit_price || 0).toFixed(2)}</td>
                  <td class="num">${item.quantity || 1}</td>
                  <td class="num">₹${Number((item.price || item.unit_price || 0) * (item.quantity || 1)).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="totals">
            <div class="totals-row">
              <span>Subtotal</span>
              <span>₹${Number(order.total_amount || order.total || 0).toFixed(2)}</span>
            </div>
            <div class="totals-row">
              <span>Shipping</span>
              <span>₹0.00</span>
            </div>
            <div class="totals-row grand">
              <span>Grand Total</span>
              <span>₹${Number(order.total_amount || order.total || 0).toFixed(2)}</span>
            </div>
          </div>

          <div class="footer">
            <p>Thank you for shopping with Veloura!</p>
            <p>If you have any questions about this invoice, please contact support.</p>
          </div>
        </body>
      </html>
    `
    const win = window.open('', '_blank')
    win.document.write(invoiceHtml)
    win.document.close()
  }

  const handleBuyAgain = (item) => {
    const cartProduct = {
      id: item.product_id || item.id,
      name: item.name || item.title || 'Product',
      price: item.price || 0,
      image: item.image || '',
      inStock: true
    }
    addToCart(cartProduct, { quantity: 1, size: item.size || 'M' })
    showToast(`✅ Added ${cartProduct.name} to cart!`)
  }

  const showToast = (msg) => { setToastMessage(msg); setTimeout(() => setToastMessage(''), 3000) }

  return (
    <PageWrapper eyebrow="Orders" title="My Orders" description="Your purchases and tracking.">
      <section className="ot-shell">

        {/* ── Top bar ── */}
        <div className="ot-topbar">
          <div className="ot-tabs">
            <button id="tab-orders" className={`ot-tab ${activeTab === 'orders' ? 'is-active' : ''}`} onClick={() => setActiveTab('orders')}>Orders</button>
            <button id="tab-buyagain" className={`ot-tab ${activeTab === 'buyagain' ? 'is-active' : ''}`} onClick={() => setActiveTab('buyagain')}>Buy Again</button>
            <button id="tab-notshipped" className={`ot-tab ${activeTab === 'notshipped' ? 'is-active' : ''}`} onClick={() => setActiveTab('notshipped')}>Not Yet Shipped</button>
          </div>

          <div className="ot-search-bar">
            <span className="ot-search-bar__icon">🔍</span>
            <input
              id="orders-search"
              className="ot-search-bar__input"
              placeholder="Search all orders"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="ot-filters">
            <select className="ot-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value={EMPTY_FILTER}>All Orders</option>
              <option value="DELIVERED">Delivered</option>
              <option value="SHIPPED">Shipped</option>
              <option value="PACKED">Packed</option>
              <option value="OUT_FOR_DELIVERY">Out For Delivery</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select className="ot-select" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="ot-refresh-btn" onClick={loadOrders} disabled={loading}>
              {loading ? '⟳' : '⟳'}
            </button>
          </div>
        </div>

        {/* ── Buy Again tab ── */}
        {activeTab === 'buyagain' && (
          <div className="ot-buy-again">
            <h3 className="ot-section-title">Buy Again</h3>
            <div className="ot-carousel">
              {buyAgainItems.map(it => (
                <div key={`${it.product_id || it.id}-${it.name}`} className="ot-carousel__item">
                  <DiscoveryProductCard
                    product={{ id: it.product_id || it.id, title: it.name, image: it.image, price: it.price, delivery_badge: 'Free Delivery' }}
                    onAddToCart={(p) => {
                      const cartProduct = {
                        id: p.id,
                        name: p.title || p.name || 'Product',
                        price: p.price || 0,
                        image: p.image || '',
                        inStock: true
                      }
                      addToCart(cartProduct, { quantity: 1, size: it.size || 'M' })
                      showToast(`✅ Added ${cartProduct.name} to cart!`)
                    }}
                  />
                </div>
              ))}
              {buyAgainItems.length === 0 && <p className="ot-empty-msg">No items yet.</p>}
            </div>
          </div>
        )}

        {/* ── Orders list ── */}
        {(activeTab === 'orders' || activeTab === 'notshipped') && (
          <div className="ot-list">
            {loading && <p className="ot-empty-msg">Loading orders…</p>}
            {!loading && message && <p className="ot-empty-msg ot-empty-msg--error">{message}</p>}
            {!loading && !message && displayOrders.length === 0 && (
              <p className="ot-empty-msg">No orders found.</p>
            )}
            {displayOrders.map(order => (
              <OrderCard
                key={order.order_id}
                order={order}
                eta={etaMap[order.order_id] || null}
                order={order}
                onOpenDetails={o => setModalOrder(o)}
                onOpenReview={(pid, oid) => {
                  if (reviewProductId === pid && reviewOrderId === oid) {
                    setReviewProductId(null);
                    setReviewOrderId(null);
                  } else {
                    setReviewProductId(pid);
                    setReviewOrderId(oid);
                  }
                }}
                onCancel={handleCancel}
                reviewProductId={reviewProductId}
                reviewOrderId={reviewOrderId}
                onCloseReview={() => { setReviewProductId(null); setReviewOrderId(null) }}
                onToast={showToast}
                onViewInvoice={handleViewInvoice}
                onBuyAgain={handleBuyAgain}
              />
            ))}
          </div>
        )}

        {/* ── Recommendations ── */}
        <section className="ot-recs" role="region" aria-label="Recommended products">
          <h3 className="ot-section-title">Recommended based on your shopping trends</h3>
          <div className="ot-carousel" ref={recsRef}>
            {recsLoading && <p className="ot-empty-msg">Loading recommendations…</p>}
            {!recsLoading && recommendations.length === 0 && (
              <p className="ot-empty-msg">No recommendations yet — shop to get personalized picks.</p>
            )}
            {recommendations.map(p => (
              <div key={p.id} className="ot-carousel__item">
                <DiscoveryProductCard
                  product={{ id: p.id, title: p.title || p.name, image: p.image, price: p.price, mrp: p.mrp || 0, discount: p.discount_percent || 0, rating: p.rating || 0, badge: p.badge || '' }}
                  onAddToCart={(prod) => {
                    const cartProduct = {
                      id: prod.id,
                      name: prod.title || prod.name || 'Product',
                      price: prod.price || 0,
                      image: prod.image || '',
                      inStock: true
                    }
                    addToCart(cartProduct, { quantity: 1, size: 'M' })
                    showToast(`✅ Added ${cartProduct.name} to cart!`)
                  }}
                  onToggleWishlist={(prod) => {
                    const cartProduct = {
                      id: prod.id,
                      name: prod.title || prod.name || 'Product',
                      price: prod.price || 0,
                      image: prod.image || '',
                      inStock: true
                    }
                    const res = addToWishlist(cartProduct)
                    if (res?.added) {
                      showToast(`❤️ Added ${cartProduct.name} to wishlist!`)
                    } else {
                      showToast(`❤️ ${cartProduct.name} is already in wishlist!`)
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        {/* ── Order detail modal ── */}
        {modalOrder && (() => {
          const modalEta = etaMap[modalOrder.order_id] || null;
          const isModalDelivered = normalizeStatus(modalOrder.status) === 'DELIVERED' || normalizeStatus(modalOrder.shipment?.status) === 'DELIVERED';
          const friendlyLocation = isModalDelivered ? 'Delivered' : (modalOrder.shipment?.current_location || (modalOrder.shipment_events?.length ? modalOrder.shipment_events[modalOrder.shipment_events.length - 1].location : 'Pending'));
          return (
            <div className="ot-modal-overlay" role="dialog" aria-modal="true">
              <div className="ot-modal">
                <header className="ot-modal__header">
                  <h3>Order {modalOrder.order_id} — Tracking</h3>
                  <button className="ot-link-btn" onClick={() => setModalOrder(null)}>✕ Close</button>
                </header>
                <div className="ot-modal__body">
                  <p><strong>Tracking ID:</strong> {modalOrder.shipment?.tracking_id || 'Pending'}</p>
                  <p>
                    <strong>Status:</strong>{' '}
                    <span className={[
                      'ot-badge',
                      modalEta?.arrival_status === 'Delivered' ? 'ot-badge--delivered' :
                      modalEta?.arrival_status === 'Cancelled' ? 'ot-badge--cancelled' :
                      modalEta?.arrival_status === 'Arriving Today' ? 'ot-badge--out' :
                      modalEta?.arrival_status === 'Arriving Tomorrow' ? 'ot-badge--packed' :
                      modalEta?.arrival_status === 'Delayed' ? 'ot-badge--cancelled' :
                      'ot-badge--shipped'
                    ].join(' ')} style={{ display: 'inline-block' }}>
                      {modalEta?.arrival_status || STATUS_LABELS[normalizeStatus(modalOrder.status)] || modalOrder.status}
                    </span>
                  </p>
                  <p>
                    <strong>ETA:</strong> {modalEta?.eta_text || modalOrder.shipment?.eta || '—'}
                    {modalEta?.arrived_early && (
                      <span className="ot-badge ot-badge--delivered" style={{ marginLeft: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        🚀 Arriving Early
                      </span>
                    )}
                  </p>
                  <p><strong>Current location:</strong> {friendlyLocation}</p>
                  {modalOrder.shipment?.next_location && (
                    <p><strong>Next Destination:</strong> {modalOrder.shipment.next_location}</p>
                  )}

                  {/* Progress Bar */}
                  {modalEta?.current_progress !== undefined && (
                    <div style={{ margin: '20px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                        <span>Shipment Progress</span>
                        <strong>{modalEta.current_progress}%</strong>
                      </div>
                      <div style={{ background: '#e2e8f0', borderRadius: '9999px', height: '8px', overflow: 'hidden' }}>
                        <div style={{ width: `${modalEta.current_progress}%`, background: '#2563eb', height: '100%', borderRadius: '9999px', transition: 'width 0.3s ease' }} />
                      </div>
                    </div>
                  )}

                  {/* Tracker inside modal */}
                  <div className="ot-tracker ot-tracker--modal">
                    {TRACKER_STEPS.map((step, index) => {
                      const activeIndex = getTrackerActiveIndex(modalOrder)
                      const isCompleted = activeIndex >= 0 && index < activeIndex
                      const isCurrent = activeIndex === index
                      const isPending = activeIndex < 0 || index > activeIndex
                      const stepDate = getStepDate(modalOrder, step.key)
                      return (
                        <span key={step.key} className="ot-tracker__segment">
                          <span className="ot-tracker__node-wrap">
                            <span
                              className={['ot-tracker__node', isCompleted ? 'is-completed' : '', isCurrent ? 'is-current' : '', isPending ? 'is-pending' : ''].join(' ').trim()}
                              aria-current={isCurrent ? 'step' : undefined}
                            >
                              <span className="ot-tracker__icon" aria-hidden="true">{step.icon}</span>
                            </span>
                            <span className="ot-tracker__label">
                              {step.label.split('\n').map((line, i) => <span key={i}>{line}</span>)}
                            </span>
                            {stepDate && <span className="ot-tracker__date">{stepDate}</span>}
                          </span>
                          {index < TRACKER_STEPS.length - 1 && (
                            <span className={`ot-tracker__connector ${activeIndex > index ? 'is-filled' : 'is-pending'}`} aria-hidden="true" />
                          )}
                        </span>
                      )
                    })}
                  </div>
                  <p className="ot-modal__status">{formatTrackerMessage(modalOrder)}</p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Toast ── */}
        {toastMessage && (
          <div className="ot-toast" role="status" aria-live="polite">{toastMessage}</div>
        )}
      </section>
    </PageWrapper>
  )
}
