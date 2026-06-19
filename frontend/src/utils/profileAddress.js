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

export function saveDefaultAddress(user, address) {
  const userKey = normalizeUserKey(user)
  if (!userKey) {
    return null
  }

  const normalized = normalizeAddressPayload(address)
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
