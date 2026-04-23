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
      if (error instanceof Error && error.message !== 'Request failed.') {
        throw error
      }
    }
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
