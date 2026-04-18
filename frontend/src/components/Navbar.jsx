import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { products as seedProducts } from '../data/products'
import { buildAuthHeaders, clearStoredUser, getStoredUser } from '../utils/auth'
import { syncGuestWishlistToUser } from '../utils/wishlist'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const navItems = ['Women', 'Men', 'Kids']
const merchantNavItems = [
  { label: 'Dashboard', path: '/admin/dashboard', legacyTab: '' },
  { label: 'Products', path: '/admin/products', legacyTab: '' },
  { label: 'Orders', path: '/admin/orders', legacyTab: '' },
  { label: 'Customers', path: '/admin/customers', legacyTab: '' },
  { label: 'Analytics', path: '/admin/analytics', legacyTab: '' },
]

const normalize = (value) => String(value || '').trim().toLowerCase()

const uniqueValues = (values) => [...new Set(values.filter(Boolean))]

const normalizeRole = (role) => {
  const next = String(role || '').trim().toLowerCase()
  if (next === 'merchant' || next === 'admin') {
    return 'admin'
  }
  if (next === 'customer' || next === 'user') {
    return 'user'
  }
  if (next === 'delivery' || next === 'delivery_associate') {
    return 'delivery'
  }
  if (next === 'operations' || next === 'operations_staff' || next === 'staff') {
    return 'operations'
  }
  return 'user'
}

export default function Navbar() {
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const [activeMegaMenu, setActiveMegaMenu] = useState('')
  const [isCartPulse, setIsCartPulse] = useState(false)
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0)
  const [pendingReturnsCount, setPendingReturnsCount] = useState(0)
  const navigate = useNavigate()
  const location = useLocation()
  const closeMenuTimerRef = useRef(null)
  const cartPulseTimerRef = useRef(null)

  const loadApprovalsCount = async () => {
    const role = normalizeRole(getStoredUser()?.role)
    if (role !== 'admin') {
      setPendingApprovalsCount(0)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/admin/user-approvals?status_filter=PENDING`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setPendingApprovalsCount(0)
        return
      }

      const users = Array.isArray(data?.users) ? data.users : []
      setPendingApprovalsCount(users.length)
    } catch {
      setPendingApprovalsCount(0)
    }
  }

  const loadReturnsCount = async () => {
    const role = normalizeRole(getStoredUser()?.role)
    if (role !== 'admin') {
      setPendingReturnsCount(0)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/admin/returns?status_filter=RETURN_REQUESTED`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setPendingReturnsCount(0)
        return
      }

      const returns = Array.isArray(data?.returns) ? data.returns : []
      setPendingReturnsCount(returns.length)
    } catch {
      setPendingReturnsCount(0)
    }
  }

  const searchParams = new URLSearchParams(location.search)
  const sectionParam = normalize(searchParams.get('section'))
  const merchantTabParam = normalize(searchParams.get('tab'))
  const departmentParam = searchParams.get('department') || ''
  const typeParam = searchParams.get('type') || ''
  const isHomeActive = location.pathname === '/'
  const isAllActive = location.pathname === '/products' && !sectionParam

  const megaMenuData = useMemo(() => {
    return navItems.reduce((accumulator, section) => {
      const sectionItems = seedProducts.filter((item) => normalize(item.section) === normalize(section))
      const categories = uniqueValues(sectionItems.map((item) => item.category))

      accumulator[section] = categories.map((category) => {
        const scopedItems = sectionItems.filter((item) => item.category === category)
        const types = uniqueValues(scopedItems.map((item) => item.productType || item.subType)).slice(0, 8)

        return {
          title: category,
          items: types,
        }
      })

      return accumulator
    }, {})
  }, [])

  const activeColumns = megaMenuData[activeMegaMenu] || []

  const buildProductsPath = (section, filters = {}) => {
    const params = new URLSearchParams()
    params.set('section', section.toLowerCase())

    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        params.set(key, value)
      }
    })

    return `/products?${params.toString()}`
  }

  const clearCloseTimer = () => {
    if (closeMenuTimerRef.current) {
      clearTimeout(closeMenuTimerRef.current)
      closeMenuTimerRef.current = null
    }
  }

  const openMegaMenu = (section) => {
    clearCloseTimer()
    setActiveMegaMenu(section)
  }

  const scheduleMegaMenuClose = () => {
    clearCloseTimer()
    closeMenuTimerRef.current = setTimeout(() => {
      setActiveMegaMenu('')
    }, 140)
  }

  const closeMegaMenu = () => {
    clearCloseTimer()
    setActiveMegaMenu('')
  }

  const goToProducts = (section, filters = {}) => {
    navigate(buildProductsPath(section, filters))
    closeMegaMenu()
  }

  useEffect(() => {
    const syncAuth = () => {
      const user = getStoredUser()
      if (user) {
        syncGuestWishlistToUser(user)
      }
      setCurrentUser(user)
    }

    const onCartChanged = () => {
      setIsCartPulse(true)
      if (cartPulseTimerRef.current) {
        clearTimeout(cartPulseTimerRef.current)
      }
      cartPulseTimerRef.current = setTimeout(() => setIsCartPulse(false), 420)
    }

    const onApprovalsChanged = () => {
      loadApprovalsCount()
    }

    const onReturnsChanged = () => {
      loadReturnsCount()
    }

    window.addEventListener('auth-changed', syncAuth)
    window.addEventListener('storage', syncAuth)
    window.addEventListener('cart-changed', onCartChanged)
    window.addEventListener('approvals-changed', onApprovalsChanged)
    window.addEventListener('returns-changed', onReturnsChanged)

    return () => {
      window.removeEventListener('auth-changed', syncAuth)
      window.removeEventListener('storage', syncAuth)
      window.removeEventListener('cart-changed', onCartChanged)
      window.removeEventListener('approvals-changed', onApprovalsChanged)
      window.removeEventListener('returns-changed', onReturnsChanged)
    }
  }, [])

  useEffect(() => {
    loadApprovalsCount()
    loadReturnsCount()
  }, [currentUser])

  const pendingCustomersAttentionCount = pendingApprovalsCount + pendingReturnsCount

  useEffect(() => {
    closeMegaMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search])

  useEffect(() => {
    return () => {
      clearCloseTimer()
      if (cartPulseTimerRef.current) {
        clearTimeout(cartPulseTimerRef.current)
      }
    }
  }, [])

  const displayName = (currentUser?.full_name || '').trim() || 'Guest'
  const role = normalizeRole(currentUser?.role)
  const isAdmin = role === 'admin'
  const isDelivery = role === 'delivery'
  const isOperations = role === 'operations'
  const isCustomer = role === 'user'
  const isAuthPage =
    location.pathname === '/login' ||
    location.pathname === '/signup' ||
    location.pathname === '/merchant-register' ||
    location.pathname === '/delivery-register' ||
    location.pathname === '/operations-register'

  const handleLogout = () => {
    clearStoredUser()
    navigate('/login')
  }

  const handleProtectedNav = (path) => {
    if (!currentUser && (path === '/wishlist' || path === '/cart')) {
      navigate('/login')
      return
    }

    if ((role === 'admin' || role === 'delivery' || role === 'operations') && (path === '/wishlist' || path === '/cart')) {
      if (role === 'admin') {
        navigate('/admin/dashboard')
      } else if (role === 'delivery') {
        navigate('/delivery')
      } else {
        navigate('/operations')
      }
      return
    }

    navigate(path)
  }

  const isMerchantItemActive = (item) => {
    if (location.pathname === item.path) {
      return true
    }

    if (item.legacyTab) {
      return location.pathname === '/admin' && merchantTabParam === item.legacyTab
    }

    return item.path === '/admin/dashboard' && location.pathname === '/admin/dashboard' && !merchantTabParam
  }

  return (
    <header className={`navbar-wrap ${activeMegaMenu ? 'navbar-wrap-open' : ''}`}>
      <div className="navbar-shell">
        <nav className="navbar shell navbar-retail">
          <NavLink to="/" className="brand brand-retail" aria-label="Movi Fashion E-Commerce Platform home">
            <img className="brand-logo" src="/movicloud%20logo.png" alt="Movi Fashion logo" />
            <span>Movi Fashion</span>
          </NavLink>

          {isAuthPage ? null : isAdmin ? (
            <div className="nav-links nav-links-retail nav-links-admin">
              <div className="nav-links nav-links-retail nav-links-admin-desktop">
                {merchantNavItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`nav-link nav-link-retail nav-link-button ${isMerchantItemActive(item) ? 'active-link' : ''}`}
                    onClick={() => navigate(item.path)}
                  >
                    {item.label.toUpperCase()}
                    {item.path === '/admin/customers' && pendingCustomersAttentionCount > 0 ? (
                      <span className="nav-badge">{pendingCustomersAttentionCount}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              <select
                className="field nav-admin-select"
                value={merchantNavItems.find((item) => isMerchantItemActive(item))?.path || '/admin/dashboard'}
                onChange={(event) => navigate(event.target.value)}
              >
                {merchantNavItems.map((item) => (
                  <option key={`select-${item.path}`} value={item.path}>
                    {item.label}
                    {item.path === '/admin/customers' && pendingCustomersAttentionCount > 0
                      ? ` (${pendingCustomersAttentionCount})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : isDelivery ? (
            <div className="nav-links nav-links-retail">
              <button
                type="button"
                className={`nav-link nav-link-retail nav-link-button ${location.pathname === '/delivery/dashboard' ? 'active-link' : ''}`}
                onClick={() => navigate('/delivery')}
              >
                DELIVERY DASHBOARD
              </button>
            </div>
          ) : isOperations ? (
            <div className="nav-links nav-links-retail">
              <button
                type="button"
                className={`nav-link nav-link-retail nav-link-button ${location.pathname === '/operations/dashboard' ? 'active-link' : ''}`}
                onClick={() => navigate('/operations')}
              >
                OPERATIONS DASHBOARD
              </button>
            </div>
          ) : (
            <div
              className="nav-menu-region"
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleMegaMenuClose}
            >
              <div className="nav-links nav-links-retail">
                <NavLink to="/" end className={`nav-link nav-link-retail ${isHomeActive ? 'active-link' : ''}`}>
                  HOME
                </NavLink>

                <NavLink to="/products" end className={`nav-link nav-link-retail ${isAllActive ? 'active-link' : ''}`}>
                  ALL
                </NavLink>

                {navItems.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`nav-link nav-link-retail nav-link-button ${
                      location.pathname === '/products' && sectionParam === item.toLowerCase() ? 'active-link' : ''
                    }`}
                    onMouseEnter={() => openMegaMenu(item)}
                    onFocus={() => openMegaMenu(item)}
                    onClick={() => goToProducts(item)}
                    aria-expanded={activeMegaMenu === item}
                  >
                    {item.toUpperCase()}
                  </button>
                ))}
              </div>

              <div
                className={`mega-menu-overlay ${activeMegaMenu ? 'mega-menu-overlay-open' : ''}`}
                onMouseEnter={clearCloseTimer}
                onMouseLeave={scheduleMegaMenuClose}
                onClick={closeMegaMenu}
                aria-hidden={!activeMegaMenu}
              />

              <div
                className={`mega-menu ${activeMegaMenu ? 'mega-menu-open' : ''}`}
                onMouseEnter={clearCloseTimer}
                onMouseLeave={scheduleMegaMenuClose}
              >
                {activeMegaMenu ? (
                  <div>
                    <div className="mega-menu-head">
                      <div>
                        <p className="eyebrow">Shop {activeMegaMenu}</p>
                        <h3>{activeMegaMenu} categories</h3>
                      </div>
                      <button
                        type="button"
                        className="btn btn-link"
                        onClick={() => goToProducts(activeMegaMenu)}
                      >
                        View all {activeMegaMenu}
                      </button>
                    </div>

                    <div className="mega-menu-grid">
                      {activeColumns.map((group) => (
                        <div className="mega-menu-column" key={group.title}>
                          <h3>{group.title}</h3>
                          <ul>
                            <li>
                              <button
                                type="button"
                                className={`mega-menu-link ${
                                  location.pathname === '/products' &&
                                  sectionParam === normalize(activeMegaMenu) &&
                                  departmentParam === group.title &&
                                  !typeParam
                                    ? 'mega-menu-link-active'
                                    : ''
                                }`}
                                onClick={() => goToProducts(activeMegaMenu, { department: group.title })}
                              >
                                All {group.title}
                              </button>
                            </li>
                            {group.items.map((item) => (
                              <li key={`${group.title}-${item}`}>
                                <button
                                  type="button"
                                  className={`mega-menu-link ${
                                    location.pathname === '/products' &&
                                    sectionParam === normalize(activeMegaMenu) &&
                                    departmentParam === group.title &&
                                    typeParam === item
                                      ? 'mega-menu-link-active'
                                      : ''
                                  }`}
                                  onClick={() => goToProducts(activeMegaMenu, { department: group.title, type: item })}
                                >
                                  {item}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}

                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <div className="nav-actions">
            {currentUser && isCustomer ? (
              <div className="profile-menu">
                <button type="button" className="nav-action profile-trigger" aria-haspopup="menu" aria-label="Open profile menu">
                  <span className="profile-name">👤 {displayName}</span>
                  <span className="dropdown-icon" aria-hidden="true">▼</span>
                </button>

                <div className="dropdown-menu" role="menu" aria-label="Profile menu">
                  <NavLink to="/profile" role="menuitem">
                    My Profile
                  </NavLink>
                  <NavLink to="/orders" role="menuitem">
                    My Orders
                  </NavLink>
                  <NavLink to="/wishlist" role="menuitem">
                    Wishlist
                  </NavLink>
                  <button type="button" className="logout-btn" role="menuitem" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
              </div>
            ) : currentUser && isAdmin ? (
              <div className="profile-menu">
                <button type="button" className="nav-action profile-trigger" aria-haspopup="menu" aria-label="Open admin profile menu">
                  <span className="profile-name">👤 {displayName}</span>
                  <span className="dropdown-icon" aria-hidden="true">▼</span>
                </button>

                <div className="dropdown-menu" role="menu" aria-label="Admin profile menu">
                  <NavLink to="/admin/profile" role="menuitem">
                    Profile
                  </NavLink>
                  <NavLink to="/admin/settings" role="menuitem">
                    Settings
                  </NavLink>
                  <button type="button" className="logout-btn" role="menuitem" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
              </div>
            ) : currentUser ? (
              <>
                <span className="nav-user-name" title={currentUser.email}>
                  {displayName}
                </span>
                {isDelivery ? (
                  <button type="button" className="nav-action" onClick={() => handleProtectedNav('/delivery/dashboard')}>
                    <small>Dashboard</small>
                  </button>
                ) : null}
                <button type="button" className="nav-action" onClick={handleLogout}>
                  <small>Logout</small>
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className="nav-action nav-action-login">
                  <small>Login</small>
                </NavLink>
                <NavLink to="/signup" className="nav-action nav-action-signup">
                  <small>Signup</small>
                </NavLink>
              </>
            )}
            {isAdmin || isDelivery ? null : (
              <>
                <button type="button" className="nav-action" onClick={() => handleProtectedNav('/wishlist')}>
                  <span>♡</span>
                  <small>Wishlist</small>
                </button>
                <button
                  type="button"
                  className={`nav-action ${isCartPulse ? 'nav-action-pulse' : ''}`}
                  aria-label="Open cart"
                  onClick={() => handleProtectedNav('/cart')}
                >
                  <span>🛍</span>
                  <small>Bag</small>
                </button>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  )
}
