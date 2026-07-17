import { getAuthToken, setStoredUser } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const PROFILE_ADDRESS_STORAGE_KEY = 'veloura_saved_profile_addresses'

function normalizeUserKey(user) {
  const email = String(user?.email || '').trim().toLowerCase()
  if (email) {
    return email
  }
  return String(user?.id || '').trim().toLowerCase()
}

function readAddressStore() {
  try {
    const raw = localStorage.getItem(PROFILE_ADDRESS_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAddressStore(store) {
  localStorage.setItem(PROFILE_ADDRESS_STORAGE_KEY, JSON.stringify(store))
  window.dispatchEvent(new Event('profile-address-changed'))
}

function normalizeAddressPayload(address) {
  return {
    fullName: String(address?.fullName || '').trim(),
    phone: String(address?.phone || '').trim(),
    city: String(address?.city || '').trim(),
    postalCode: String(address?.postalCode || '').replace(/\D/g, '').slice(0, 6),
    addressLine: String(address?.addressLine || '').trim(),
  }
}

export function getSavedDefaultAddress(user) {
  if (user?.address) {
    const normalized = normalizeAddressPayload(user.address)
    if (normalized.fullName || normalized.phone || normalized.city || normalized.postalCode || normalized.addressLine) {
      return normalized
    }
  }

  const userKey = normalizeUserKey(user)
  if (!userKey) {
    return null
  }

  const store = readAddressStore()
  const value = store[userKey]
  if (!value || typeof value !== 'object') {
    return null
  }

  const normalized = normalizeAddressPayload(value)
  if (!normalized.fullName && !normalized.phone && !normalized.city && !normalized.postalCode && !normalized.addressLine) {
    return null
  }

  return normalized
}

export async function saveDefaultAddress(user, address) {
  const userKey = normalizeUserKey(user)
  if (!userKey) {
    return null
  }

  const normalized = normalizeAddressPayload(address)

  try {
    const token = getAuthToken()
    if (token) {
      const response = await fetch(`${API_BASE}/api/user/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(normalized),
      })
      if (response.ok) {
        const data = await response.json()
        if (data?.user) {
          const stored = getStoredUser() || {}
          setStoredUser({
            ...stored,
            ...data.user,
            token: stored.token || '',
            refresh_token: stored.refresh_token || '',
          })
        }
      }
    }
  } catch (error) {
    console.error('Failed to save profile address to backend:', error)
  }

  const store = readAddressStore()
  store[userKey] = normalized
  writeAddressStore(store)
  return normalized
}

export function clearSavedDefaultAddress(user) {
  const userKey = normalizeUserKey(user)
  if (!userKey) {
    return
  }

  const store = readAddressStore()
  delete store[userKey]
  writeAddressStore(store)
}
