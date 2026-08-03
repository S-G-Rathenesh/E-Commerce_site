/**
 * Resolves a product image URL to an absolute URL that works in any environment.
 *
 * Handles:
 * - Relative paths like `/uploads/images/xxx.jpg` → prepends API base
 * - Legacy absolute localhost URLs (`http://127.0.0.1:8000/...` or `http://localhost:8000/...`)
 *   → rewrites them to use the current API base
 * - Already-valid HTTPS URLs → returned as-is
 * - Empty / falsy values → returns an inline SVG placeholder
 */

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

// Matches `http://127.0.0.1:PORT` or `http://localhost:PORT`
const LOCALHOST_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i

/**
 * Determine the effective API base URL.
 * If VITE_API_BASE_URL is still a localhost URL but the page is served over
 * HTTPS (i.e. deployed to Render/Vercel/etc.), derive the backend URL from
 * the current origin — assuming backend is on the same domain or on a
 * well-known Render service URL.
 */
function getEffectiveApiBase() {
  // If the env var points to a real deployed URL, use it as-is.
  if (RAW_API_BASE && !LOCALHOST_RE.test(RAW_API_BASE)) {
    return RAW_API_BASE
  }

  // Running locally — use the configured localhost URL.
  if (typeof window === 'undefined' || window.location.protocol === 'http:') {
    return RAW_API_BASE
  }

  // Deployed over HTTPS but env var is still localhost — fall back to the
  // current origin so relative image paths resolve to the same host.
  // This works when the frontend is served by the backend (e.g. FastAPI
  // serves the built frontend dist).
  return window.location.origin
}

const API_BASE = getEffectiveApiBase()

const PLACEHOLDER_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">' +
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#f3f4f6"/><stop offset="100%" stop-color="#e5e7eb"/>' +
    '</linearGradient></defs>' +
    '<rect width="480" height="360" rx="24" fill="url(#bg)"/>' +
    '<rect x="86" y="76" width="308" height="208" rx="18" fill="#fff" stroke="#cbd5e1" stroke-width="4"/>' +
    '<circle cx="190" cy="152" r="18" fill="#94a3b8"/>' +
    '<path d="M122 244l68-72 58 54 44-36 66 54" fill="none" stroke="#94a3b8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<text x="240" y="318" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#64748b">Image unavailable</text>' +
    '</svg>',
)}`

export function resolveImageUrl(raw) {
  const url = String(raw || '').trim()

  if (!url) {
    return PLACEHOLDER_SVG
  }

  // Relative path like `/uploads/images/xxx.jpg`
  if (url.startsWith('/')) {
    return API_BASE ? `${API_BASE}${url}` : url
  }

  // Rewrite legacy localhost URLs to the deployed API base
  if (LOCALHOST_RE.test(url) && API_BASE && !LOCALHOST_RE.test(API_BASE)) {
    return url.replace(LOCALHOST_RE, API_BASE)
  }

  // Already a full URL (https://..., data:, blob:, etc.)
  return url
}

export { PLACEHOLDER_SVG }
