import { getStoredUser } from './auth'

const CART_GUEST_KEY = 'veloura_cart_guest_v1'
const CART_USER_DB_KEY = 'veloura_cart_user_db_v1'

function normalizeUserId(user) {
  const explicit = String(user?.id || '').trim().toLowerCase()
  if (explicit) {
    return explicit
  }

  return String(user?.email || '').trim().toLowerCase()
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function readUserDb() {
  return readJson(CART_USER_DB_KEY, {})
}

function resolveUser(explicitUser) {
  return explicitUser ?? getStoredUser()
}

function getScopedCartKey(user) {
  const userId = normalizeUserId(user)
  return userId ? `user:${userId}` : 'guest'
}

function sanitizeProduct(product) {
  const explicitInStock = product?.inStock
  const inStock =
    typeof explicitInStock === 'boolean' ? explicitInStock : Number(product?.stock ?? 1) > 0

  return {
    id: Number(product?.id),
    name: String(product?.name || 'Product'),
    category: String(product?.category || ''),
    productType: String(product?.productType || ''),
    subType: String(product?.subType || ''),
    image: String(product?.image || ''),
    price: Number(product?.price) || 0,
    inStock,
  }
}

function saveCartItems(items, explicitUser) {
  const user = resolveUser(explicitUser)
  const scopedKey = getScopedCartKey(user)

  if (scopedKey === 'guest') {
    writeJson(CART_GUEST_KEY, items)
  } else {
    const db = readUserDb()
    db[scopedKey] = items
    writeJson(CART_USER_DB_KEY, db)
  }

  window.dispatchEvent(new Event('cart-changed'))
}

export function getCartItems(explicitUser) {
  const user = resolveUser(explicitUser)
  const scopedKey = getScopedCartKey(user)

  if (scopedKey === 'guest') {
    const items = readJson(CART_GUEST_KEY, [])
    return Array.isArray(items) ? items : []
  }

  const db = readUserDb()
  const items = db[scopedKey]
  return Array.isArray(items) ? items : []
}

export function addToCart(product, options = {}) {
  const quantity = Math.max(1, Number(options.quantity) || 1)
  const size = String(options.size || 'M')
  const user = resolveUser(options.user)
  const productItem = sanitizeProduct(product)

  const items = getCartItems(user)
  const index = items.findIndex((item) => item.id === productItem.id && item.size === size)

  if (index >= 0) {
    const next = [...items]
    next[index] = {
      ...next[index],
      quantity: Math.min(20, Number(next[index].quantity || 1) + quantity),
      price: productItem.price,
      inStock: productItem.inStock,
    }
    saveCartItems(next, user)
    return next[index]
  }

  const nextItem = {
    ...productItem,
    size,
    quantity,
    addedAt: new Date().toISOString(),
  }

  saveCartItems([...items, nextItem], user)
  return nextItem
}

export function updateCartQuantity(productId, quantity, options = {}) {
  const user = resolveUser(options.user)
  const size = options.size ? String(options.size) : ''
  const nextQuantity = Math.max(1, Number(quantity) || 1)
  const items = getCartItems(user)

  const next = items.map((item) => {
    const idMatch = Number(item.id) === Number(productId)
    const sizeMatch = !size || item.size === size

    if (!idMatch || !sizeMatch) {
      return item
    }

    return {
      ...item,
      quantity: nextQuantity,
    }
  })

  saveCartItems(next, user)
}

export function removeFromCart(productId, options = {}) {
  const user = resolveUser(options.user)
  const size = options.size ? String(options.size) : ''
  const items = getCartItems(user)

  const next = items.filter((item) => {
    const idMatch = Number(item.id) === Number(productId)
    const sizeMatch = !size || item.size === size
    return !(idMatch && sizeMatch)
  })

  saveCartItems(next, user)
}

export function clearCart(options = {}) {
  const user = resolveUser(options.user)
  saveCartItems([], user)
}

export function getCartCount(explicitUser) {
  return getCartItems(explicitUser).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0)
}
