const AUTH_STORAGE_KEY = 'veloura_auth_user'
const AUTH_ACCOUNTS_KEY = 'veloura_auth_accounts'

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) {
      return null
    }
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setStoredUser(user) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user))
  window.dispatchEvent(new Event('auth-changed'))
}

export function clearStoredUser() {
  localStorage.removeItem(AUTH_STORAGE_KEY)
  window.dispatchEvent(new Event('auth-changed'))
}

function getStoredAccounts() {
  try {
    const raw = localStorage.getItem(AUTH_ACCOUNTS_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
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
