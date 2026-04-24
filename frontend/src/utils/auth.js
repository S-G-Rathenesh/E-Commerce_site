const AUTH_STORAGE_KEY = 'veloura_auth_user'
const AUTH_ACCOUNTS_KEY = 'veloura_auth_accounts'
const LEGACY_AUTH_TOKEN_KEY = 'auth_token'
const LEGACY_ACCESS_TOKEN_KEY = 'access_token'

const DEMO_ACCOUNTS = [
  {
    full_name: 'Demo Admin',
    email: 'admin.demo@veloura.com',
    password: 'Admin#Demo2026',
    provider: 'email',
    role: 'admin',
  },
  {
    full_name: 'Demo Customer',
    email: 'customer.demo@veloura.com',
    password: 'Customer#Demo2026',
    provider: 'email',
    role: 'user',
  },
  {
    full_name: 'Demo Delivery Partner',
    email: 'delivery.demo@veloura.com',
    password: 'Delivery#Demo2026',
    provider: 'email',
    role: 'delivery',
  },
  {
    full_name: 'Demo Operations Staff',
    email: 'ops.demo@veloura.com',
    password: 'Ops#Demo2026',
    provider: 'email',
    role: 'operations',
  },
]

function normalizeRole(role) {
  const next = String(role || '').trim().toLowerCase()
  if (next === 'super_admin' || next === 'superadmin') {
    return 'super_admin'
  }
  if (next === 'merchant' || next === 'admin') {
    return 'admin'
  }
  if (next === 'customer' || next === 'user') {
    return 'user'
  }
  if (next === 'delivery' || next === 'delivery_associate') {
    return 'delivery'
  }
  if (next === 'operations_staff' || next === 'staff' || next === 'operations') {
    return 'operations'
  }
  return 'user'
}

function normalizeStatus(status) {
  const next = String(status || '').trim().toUpperCase()
  if (next === 'ACTIVE' || next === 'PENDING' || next === 'BLOCKED') {
    return next
  }
  return 'ACTIVE'
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) {
      const legacyToken = String(
        localStorage.getItem(LEGACY_AUTH_TOKEN_KEY) || localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY) || '',
      ).trim()
      if (!legacyToken) {
        return null
      }
      return {
        role: 'user',
        status: 'ACTIVE',
        token: legacyToken,
      }
    }
    const parsed = JSON.parse(raw)
    if (!parsed) {
      return null
    }
    return {
      ...parsed,
      role: normalizeRole(parsed.role),
      status: normalizeStatus(parsed.status),
      token: parsed.token || '',
    }
  } catch {
    return null
  }
}

export function setStoredUser(user) {
  const payload = {
    ...user,
    role: normalizeRole(user?.role),
    status: normalizeStatus(user?.status),
    token: user?.token || '',
    refresh_token: user?.refresh_token || '',
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload))
  if (payload.token) {
    localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, payload.token)
    localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, payload.token)
  } else {
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY)
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY)
  }
  window.dispatchEvent(new Event('auth-changed'))
}

export function clearStoredUser() {
  localStorage.removeItem(AUTH_STORAGE_KEY)
  localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY)
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY)
  window.dispatchEvent(new Event('auth-changed'))
}

export function getAuthToken() {
  const user = getStoredUser()
  return String(
    user?.token || localStorage.getItem(LEGACY_AUTH_TOKEN_KEY) || localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY) || '',
  ).trim()
}

export function isAuthenticated() {
  return Boolean(getAuthToken())
}

export function buildAuthHeaders(headers = {}) {
  const token = getAuthToken()
  if (!token) {
    return { ...headers }
  }
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  }
}

export async function refreshAuthToken(apiBase) {
  const user = getStoredUser()
  const refreshToken = String(user?.refresh_token || '').trim()
  if (!refreshToken || !apiBase) {
    return false
  }

  try {
    const response = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    const data = await response.json()
    if (!response.ok || !data?.token) {
      return false
    }

    setStoredUser({
      ...(user || {}),
      ...(data?.user || {}),
      role: data?.role || user?.role || 'user',
      status: data?.status || user?.status || 'ACTIVE',
      token: data.token,
      refresh_token: data.refresh_token || refreshToken,
    })
    return true
  } catch {
    return false
  }
}

function getStoredAccounts() {
  try {
    const raw = localStorage.getItem(AUTH_ACCOUNTS_KEY)
    if (!raw) {
      return DEMO_ACCOUNTS
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return DEMO_ACCOUNTS
    }

    const existingEmails = new Set(parsed.map((account) => String(account?.email || '').trim().toLowerCase()))
    const merged = [...parsed]

    for (const demoAccount of DEMO_ACCOUNTS) {
      if (!existingEmails.has(demoAccount.email.toLowerCase())) {
        merged.push(demoAccount)
      }
    }

    return merged
  } catch {
    return DEMO_ACCOUNTS
  }
}

function setStoredAccounts(accounts) {
  localStorage.setItem(AUTH_ACCOUNTS_KEY, JSON.stringify(accounts))
}

export function findLocalAccountByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) {
    return null
  }

  const accounts = getStoredAccounts()
  return accounts.find((account) => String(account.email).toLowerCase() === normalized) || null
}

export function upsertLocalAccount(account) {
  const normalizedEmail = String(account?.email || '').trim().toLowerCase()
  if (!normalizedEmail) {
    return null
  }

  const nextAccount = {
    full_name: (account?.full_name || '').trim() || normalizedEmail.split('@')[0],
    email: normalizedEmail,
    password: account?.password || '',
    provider: account?.provider || 'email',
    role: normalizeRole(account?.role || 'user'),
    status: normalizeStatus(account?.status || 'ACTIVE'),
    token: account?.token || '',
  }

  const accounts = getStoredAccounts()
  const index = accounts.findIndex((item) => String(item.email).toLowerCase() === normalizedEmail)

  if (index >= 0) {
    accounts[index] = { ...accounts[index], ...nextAccount }
  } else {
    accounts.push(nextAccount)
  }

  setStoredAccounts(accounts)
  return nextAccount
}
