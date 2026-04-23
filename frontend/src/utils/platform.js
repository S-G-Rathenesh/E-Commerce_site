const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const BRANDING_CACHE_KEY = 'veloura_platform_branding'
const BRANDING_EVENT = 'platform-branding-updated'
const SUPER_ADMIN_FALLBACK_PATH = '/_private/ops/super-admin-portal-x9f4q2'

export function getSuperAdminSecretPath() {
  const configured = String(import.meta.env.VITE_SUPER_ADMIN_SECRET_PATH || '').trim()
  if (!configured.startsWith('/')) {
    return SUPER_ADMIN_FALLBACK_PATH
  }
  return configured
}

export function getDefaultBranding() {
  return {
    platform_name: 'Movi Fashion',
    logo_url: '/movicloud%20logo.png',
  }
}

export function getCachedBranding() {
  try {
    const raw = localStorage.getItem(BRANDING_CACHE_KEY)
    if (!raw) {
      return getDefaultBranding()
    }
    const parsed = JSON.parse(raw)
    return {
      platform_name: String(parsed?.platform_name || 'Movi Fashion').trim() || 'Movi Fashion',
      logo_url: String(parsed?.logo_url || '/movicloud%20logo.png').trim() || '/movicloud%20logo.png',
    }
  } catch {
    return getDefaultBranding()
  }
}

export function setCachedBranding(branding) {
  const payload = {
    platform_name: String(branding?.platform_name || 'Movi Fashion').trim() || 'Movi Fashion',
    logo_url: String(branding?.logo_url || '/movicloud%20logo.png').trim() || '/movicloud%20logo.png',
  }
  localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(payload))
  window.dispatchEvent(new CustomEvent(BRANDING_EVENT, { detail: payload }))
  return payload
}

export function onBrandingUpdated(handler) {
  window.addEventListener(BRANDING_EVENT, handler)
  return () => window.removeEventListener(BRANDING_EVENT, handler)
}

export async function fetchPublicPlatformSettings() {
  const response = await fetch(`${API_BASE}/public/platform-settings`)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.detail || 'Failed to load platform settings')
  }
  return setCachedBranding(data)
}

export async function fetchPublicBanners() {
  const response = await fetch(`${API_BASE}/public/banners`)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.detail || 'Failed to load banners')
  }
  return Array.isArray(data?.banners) ? data.banners : []
}

export async function fetchPublicGlobalOffer() {
  const response = await fetch(`${API_BASE}/public/global-offer`)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.detail || 'Failed to load global offer')
  }
  return data?.offer || null
}
