import { getStoredUser } from './auth'
import { addToCart } from './cart'

const WISHLIST_GUEST_KEY = 'veloura_wishlist_guest_v1'
const WISHLIST_USER_DB_KEY = 'veloura_wishlist_user_db_v1'

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

function createDefaultState() {
  return {
    activeListId: 'favorites',
    lists: [
      {
        id: 'favorites',
        name: 'Favorites',
        createdAt: new Date().toISOString(),
        items: [],
      },
    ],
  }
}

function readUserDb() {
  return readJson(WISHLIST_USER_DB_KEY, {})
}

function resolveUser(explicitUser) {
  return explicitUser ?? getStoredUser()
}

function getScopedWishlistKey(user) {
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

function ensureShape(state) {
  if (!state || !Array.isArray(state.lists) || state.lists.length === 0) {
    return createDefaultState()
  }

  const lists = state.lists
    .filter((list) => list && list.id)
    .map((list) => ({
      id: String(list.id),
      name: String(list.name || 'Wishlist'),
      createdAt: list.createdAt || new Date().toISOString(),
      items: Array.isArray(list.items) ? list.items : [],
    }))

  if (lists.length === 0) {
    return createDefaultState()
  }

  const activeListId = lists.some((list) => list.id === state.activeListId)
    ? state.activeListId
    : lists[0].id

  return {
    activeListId,
    lists,
  }
}

function saveWishlistState(state, explicitUser) {
  const normalizedState = ensureShape(state)
  const user = resolveUser(explicitUser)
  const scopedKey = getScopedWishlistKey(user)

  if (scopedKey === 'guest') {
    writeJson(WISHLIST_GUEST_KEY, normalizedState)
  } else {
    const db = readUserDb()
    db[scopedKey] = normalizedState
    writeJson(WISHLIST_USER_DB_KEY, db)
  }

  window.dispatchEvent(new Event('wishlist-changed'))
}

export function getWishlistState(explicitUser) {
  const user = resolveUser(explicitUser)
  const scopedKey = getScopedWishlistKey(user)

  if (scopedKey === 'guest') {
    return ensureShape(readJson(WISHLIST_GUEST_KEY, createDefaultState()))
  }

  const db = readUserDb()
  return ensureShape(db[scopedKey] || createDefaultState())
}

export function getWishlistItems(options = {}) {
  const listId = options.listId || ''
  const state = getWishlistState(options.user)
  const resolvedListId = listId || state.activeListId
  const list = state.lists.find((entry) => entry.id === resolvedListId) || state.lists[0]
  return Array.isArray(list.items) ? list.items : []
}

export function createWishlist(name, options = {}) {
  const state = getWishlistState(options.user)
  const cleanName = String(name || '').trim() || `List ${state.lists.length + 1}`
  const id = `list-${Date.now()}`

  const nextState = {
    ...state,
    activeListId: id,
    lists: [
      ...state.lists,
      {
        id,
        name: cleanName,
        createdAt: new Date().toISOString(),
        items: [],
      },
    ],
  }

  saveWishlistState(nextState, options.user)
  return id
}

export function setActiveWishlist(listId, options = {}) {
  const state = getWishlistState(options.user)
  if (!state.lists.some((list) => list.id === listId)) {
    return
  }

  saveWishlistState({ ...state, activeListId: listId }, options.user)
}

export function addToWishlist(product, options = {}) {
  const state = getWishlistState(options.user)
  const listId = options.listId || state.activeListId
  const item = sanitizeProduct(product)
  const targetList = state.lists.find((list) => list.id === listId) || state.lists[0]

  const alreadyExists = targetList.items.some((entry) => Number(entry.id) === Number(item.id))
  if (alreadyExists) {
    return { added: false, reason: 'exists' }
  }

  const nextList = {
    ...targetList,
    items: [
      ...targetList.items,
      {
        ...item,
        addedAt: new Date().toISOString(),
        addedPrice: item.price,
        addedInStock: item.inStock,
      },
    ],
  }

  const nextState = {
    ...state,
    activeListId: targetList.id,
    lists: state.lists.map((list) => (list.id === nextList.id ? nextList : list)),
  }

  saveWishlistState(nextState, options.user)
  return { added: true, listId: nextList.id }
}

export function removeFromWishlist(productId, options = {}) {
  const state = getWishlistState(options.user)
  const listId = options.listId || state.activeListId

  const nextState = {
    ...state,
    lists: state.lists.map((list) => {
      if (list.id !== listId) {
        return list
      }

      return {
        ...list,
        items: list.items.filter((item) => Number(item.id) !== Number(productId)),
      }
    }),
  }

  saveWishlistState(nextState, options.user)
}

export function clearWishlist(options = {}) {
  const state = getWishlistState(options.user)
  const listId = options.listId || state.activeListId

  const nextState = {
    ...state,
    lists: state.lists.map((list) => (list.id === listId ? { ...list, items: [] } : list)),
  }

  saveWishlistState(nextState, options.user)
}

export function moveWishlistItemToCart(productId, options = {}) {
  const state = getWishlistState(options.user)
  const listId = options.listId || state.activeListId
  const list = state.lists.find((entry) => entry.id === listId) || state.lists[0]
  const item = list.items.find((entry) => Number(entry.id) === Number(productId))

  if (!item) {
    return false
  }

  addToCart(item, { quantity: 1, size: 'M', user: options.user })
  removeFromWishlist(productId, { listId, user: options.user })
  return true
}

export function getWishlistCount(options = {}) {
  const state = getWishlistState(options.user)
  return state.lists.reduce((sum, list) => sum + list.items.length, 0)
}

function mergeLists(baseLists, guestLists) {
  const nextLists = [...baseLists]

  guestLists.forEach((guestList) => {
    const existingByName = nextLists.find(
      (entry) => entry.name.trim().toLowerCase() === guestList.name.trim().toLowerCase(),
    )

    if (!existingByName) {
      nextLists.push({
        ...guestList,
        id: `list-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      })
      return
    }

    const existingIds = new Set(existingByName.items.map((item) => Number(item.id)))
    const mergedItems = [...existingByName.items]

    guestList.items.forEach((item) => {
      if (!existingIds.has(Number(item.id))) {
        mergedItems.push(item)
      }
    })

    existingByName.items = mergedItems
  })

  return nextLists
}

export function syncGuestWishlistToUser(explicitUser) {
  const user = resolveUser(explicitUser)
  const scopedKey = getScopedWishlistKey(user)

  if (!user || scopedKey === 'guest') {
    return
  }

  const guestState = ensureShape(readJson(WISHLIST_GUEST_KEY, createDefaultState()))
  const hasGuestItems = guestState.lists.some((list) => list.items.length > 0)

  if (!hasGuestItems) {
    return
  }

  const userState = getWishlistState(user)
  const nextState = {
    ...userState,
    lists: mergeLists(userState.lists, guestState.lists),
  }

  saveWishlistState(nextState, user)
  writeJson(WISHLIST_GUEST_KEY, createDefaultState())
}

export function buildWishlistSharePayload(options = {}) {
  const state = getWishlistState(options.user)
  const listId = options.listId || state.activeListId
  const list = state.lists.find((entry) => entry.id === listId) || state.lists[0]

  const payload = {
    listName: list.name,
    items: list.items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      image: item.image,
      category: item.category,
      inStock: item.inStock,
    })),
    generatedAt: new Date().toISOString(),
  }

  return payload
}

export function createWishlistShareLink(options = {}) {
  const payload = buildWishlistSharePayload(options)
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
  const baseUrl = window.location.origin
  return `${baseUrl}/wishlist?share=${encoded}`
}

export function getWishlistNotifications(item) {
  const currentPrice = Number(item?.price) || 0
  const previousPrice = Number(item?.addedPrice) || currentPrice

  return {
    priceDropped: currentPrice < previousPrice,
    backInStock: Boolean(item?.inStock) && item?.addedInStock === false,
  }
}

export function isWishlisted(productId, options = {}) {
  const items = getWishlistItems({ listId: options.listId, user: options.user })
  return items.some((item) => Number(item.id) === Number(productId))
}
