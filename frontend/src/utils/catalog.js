import { buildAuthHeaders } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const API_FALLBACK_BASE = API_BASE.includes('127.0.0.1') ? API_BASE.replace('127.0.0.1', 'localhost') : ''

const API_CANDIDATES = Array.from(
  new Set([
    API_BASE,
    API_FALLBACK_BASE,
    'http://127.0.0.1:8000',
    'http://localhost:8000',
  ].filter(Boolean)),
)

export async function fetchCatalogProducts() {
  for (const baseUrl of API_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}/products`)
      if (!response.ok) {
        if (response.status < 500) {
          return []
        }
        continue
      }

      const data = await response.json()
      return Array.isArray(data) ? data : []
    } catch {
      // Try next candidate base URL.
    }
  }

  return []
}

export async function fetchCatalogProductById(productId) {
  for (const baseUrl of API_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}/product/${productId}`)
      if (!response.ok) {
        if (response.status === 404 || response.status < 500) {
          return null
        }
        continue
      }

      const data = await response.json()
      if (!data || data.error) {
        return null
      }

      return data
    } catch {
      // Try next candidate base URL.
    }
  }

  return null
}

export async function fetchCatalogRelatedProducts(productId) {
  for (const baseUrl of API_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}/products/${productId}/related`)
      if (!response.ok) {
        if (response.status < 500) {
          return []
        }
        continue
      }

      const data = await response.json()
      return Array.isArray(data) ? data : []
    } catch {
      // Try next candidate base URL.
    }
  }

  return []
}

function serializeQueryParams(params = {}) {
  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return
    }

    if (Array.isArray(value)) {
      const joined = value.filter(Boolean).join(',')
      if (joined) {
        searchParams.set(key, joined)
      }
      return
    }

    searchParams.set(key, String(value))
  })

  return searchParams.toString()
}

async function fetchDiscoveryList(path, params = {}) {
  const queryString = serializeQueryParams(params)
  const requestPath = queryString ? `${path}?${queryString}` : path

  for (const baseUrl of API_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}${requestPath}`)
      if (!response.ok) {
        if (response.status < 500) {
          return []
        }
        continue
      }

      const data = await response.json()
      return Array.isArray(data) ? data : data
    } catch {
      // Try next candidate base URL.
    }
  }

  return []
}

export async function fetchCatalogRecommendedProducts(productId, params = {}) {
  return fetchDiscoveryList(`/products/${productId}/recommended`, params)
}

export async function fetchRecommendationsForCustomer(customerId, params = {}) {
  if (!customerId) return []
  return fetchDiscoveryList(`/recommendations/${encodeURIComponent(String(customerId))}`, params)
}

export async function fetchCatalogFrequentlyBought(productId) {
  return fetchDiscoveryList('/products/frequently-bought', { product_id: productId })
}

export async function fetchCatalogRecentlyViewed(productIds = []) {
  return fetchDiscoveryList('/products/recently-viewed', { ids: productIds })
}

const LOCAL_PRODUCTS_KEY = 'veloura_merchant_products'

function getLocalMerchantProducts() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PRODUCTS_KEY) || '[]')
  } catch {
    return []
  }
}

function setLocalMerchantProducts(products) {
  localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(products))
}

async function requestJson(path, options = {}) {
  for (const baseUrl of API_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        }),
      })

      if (!response.ok) {
        if (response.status < 500) {
          const error = await response.json().catch(() => ({}))
          throw new Error(error.detail || error.message || 'Request failed.')
        }
        continue
      }

      return response.json()
    } catch (error) {
      if (error instanceof Error && error.message !== 'Request failed.' && !error.message.includes('fetch')) {
        throw error
      }
    }
  }

  // Local storage fallback for offline / mock mode
  if (path === '/merchant/products' && (!options.method || options.method === 'GET')) {
    return getLocalMerchantProducts()
  }

  if (path === '/merchant/products' && options.method === 'POST') {
    const payload = JSON.parse(options.body || '{}')
    const newProduct = {
      id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      ...payload,
      review_status: 'APPROVED',
      created_at: new Date().toISOString(),
    }
    const current = getLocalMerchantProducts()
    current.unshift(newProduct)
    setLocalMerchantProducts(current)
    return newProduct
  }

  if (path.startsWith('/merchant/products/') && options.method === 'PUT') {
    const productId = path.replace('/merchant/products/', '')
    const payload = JSON.parse(options.body || '{}')
    const current = getLocalMerchantProducts()
    const index = current.findIndex((p) => p.id === productId)
    if (index >= 0) {
      current[index] = { ...current[index], ...payload }
      setLocalMerchantProducts(current)
      return current[index]
    }
    return { id: productId, ...payload }
  }

  if (path.startsWith('/merchant/products/') && options.method === 'DELETE') {
    const productId = path.replace('/merchant/products/', '')
    const current = getLocalMerchantProducts()
    const filtered = current.filter((p) => p.id !== productId)
    setLocalMerchantProducts(filtered)
    return { success: true }
  }

  throw new Error('Unable to reach the API.')
}

export async function fetchMerchantProducts() {
  const data = await requestJson('/merchant/products')
  return Array.isArray(data) ? data : []
}

export async function createMerchantProduct(payload) {
  return requestJson('/merchant/products', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateMerchantProduct(productId, payload) {
  return requestJson(`/merchant/products/${productId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteMerchantProduct(productId) {
  return requestJson(`/merchant/products/${productId}`, {
    method: 'DELETE',
  })
}
