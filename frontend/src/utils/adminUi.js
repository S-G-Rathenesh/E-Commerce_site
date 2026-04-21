export function normalizeOrderStatus(status) {
  const value = String(status || '').trim().toUpperCase()
  if (!value) return 'PENDING'
  if (value === 'PLACED' || value === 'CONFIRMED') return 'PENDING'
  return value
}

export function formatStatusLabel(status) {
  return String(status || '')
    .trim()
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Pending'
}

export function getStatusBadgeClass(status) {
  const normalized = normalizeOrderStatus(status)
  if (normalized === 'DELIVERED') return 'badge badge-success'
  if (normalized === 'SHIPPED' || normalized === 'OUT_FOR_DELIVERY') return 'badge badge-info'
  if (normalized === 'PACKED') return 'badge badge-warning'
  return 'badge badge-danger'
}

export function generateStock(productId) {
  return ((Number(productId || 0) * 7) % 45) + 3
}

export function getSlaState(order) {
  const createdAt = order?.created_at ? new Date(order.created_at).getTime() : Date.now()
  const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60)
  const normalized = normalizeOrderStatus(order?.status)

  if (normalized === 'DELIVERED') {
    return { label: 'On Time', className: 'badge badge-success' }
  }

  if (normalized === 'PENDING' && ageHours > 48) {
    return { label: 'Delayed', className: 'badge badge-danger' }
  }

  if ((normalized === 'PACKED' || normalized === 'SHIPPED' || normalized === 'OUT_FOR_DELIVERY') && ageHours > 96) {
    return { label: 'Delayed', className: 'badge badge-danger' }
  }

  return { label: 'On Time', className: 'badge badge-success' }
}

export function getRelativeTime(value) {
  if (!value) return 'just now'
  const timeMs = new Date(value).getTime()
  if (Number.isNaN(timeMs)) return 'just now'

  const diffMs = Math.max(0, Date.now() - timeMs)
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}
