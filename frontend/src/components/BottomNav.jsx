import { NavLink, useLocation } from 'react-router-dom'
import { getStoredUser } from '../utils/auth'

const normalizeRole = (role) => {
  const next = String(role || '').trim().toLowerCase()
  if (next === 'merchant' || next === 'admin') return 'admin'
  if (next === 'customer' || next === 'user') return 'user'
  if (next === 'delivery' || next === 'delivery_associate') return 'delivery'
  if (next === 'operations' || next === 'operations_staff' || next === 'staff') return 'operations'
  return 'user'
}

export default function BottomNav() {
  const location = useLocation()
  const user = getStoredUser()
  const role = normalizeRole(user?.role)

  // Only show for customers / guests on mobile
  if (role === 'admin' || role === 'delivery' || role === 'operations') {
    return null
  }

  const isAuthPage =
    location.pathname === '/login' ||
    location.pathname === '/signup' ||
    location.pathname === '/merchant-register' ||
    location.pathname === '/delivery-register' ||
    location.pathname === '/operations-register'

  if (isAuthPage) return null

  const tabs = [
    { to: '/', icon: '🏠', label: 'Home', exact: true },
    { to: '/products', icon: '🔍', label: 'Browse', exact: false },
    { to: '/wishlist', icon: '♡', label: 'Wishlist', exact: false },
    { to: '/orders', icon: '📦', label: 'Orders', exact: false },
    { to: user ? '/profile' : '/login', icon: '👤', label: user ? 'Profile' : 'Login', exact: false },
  ]

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {tabs.map((tab) => {
        const isActive = tab.exact
          ? location.pathname === tab.to
          : location.pathname.startsWith(tab.to)
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={`mobile-bottom-nav-item ${isActive ? 'mobile-bottom-nav-active' : ''}`}
          >
            <span className="mobile-bottom-nav-icon">{tab.icon}</span>
            <span className="mobile-bottom-nav-label">{tab.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
