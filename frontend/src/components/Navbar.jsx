import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { buildAuthHeaders, clearStoredUser, getStoredUser, setStoredUser } from '../utils/auth'
import { syncGuestWishlistToUser } from '../utils/wishlist'
import { fetchCatalogProducts } from '../utils/catalog'
import { fetchPublicPlatformSettings, getCachedBranding, getSuperAdminSecretPath, onBrandingUpdated } from '../utils/platform'

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
  if (next === 'operations' || next === 'operations_staff' || next === 'staff') {
    return 'operations'
  }
  return 'user'
}

export default function Navbar() {
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const [branding, setBranding] = useState(getCachedBranding())
  const [catalogProducts, setCatalogProducts] = useState([])
  const [activeMegaMenu, setActiveMegaMenu] = useState('')
  const [isCartPulse, setIsCartPulse] = useState(false)
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0)
  const [pendingReturnsCount, setPendingReturnsCount] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const superAdminSecretPath = getSuperAdminSecretPath()
  const closeMenuTimerRef = useRef(null)
  const cartPulseTimerRef = useRef(null)
  const notificationsMenuRef = useRef(null)
  const profileMenuRef = useRef(null)

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

  const loadNotifications = async () => {
    try {
      const response = await fetch(`${API_BASE}/notifications/my`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setNotifications([])
        return
      }

      setNotifications(Array.isArray(data?.notifications) ? data.notifications : [])
    } catch {
      setNotifications([])
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
      const sectionItems = catalogProducts.filter((item) => normalize(item.section) === normalize(section))
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
  }, [catalogProducts])

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

    const onNotificationsChanged = () => {
      loadNotifications()
    }

    window.addEventListener('auth-changed', syncAuth)
    window.addEventListener('storage', syncAuth)
    window.addEventListener('cart-changed', onCartChanged)
    window.addEventListener('approvals-changed', onApprovalsChanged)
    window.addEventListener('returns-changed', onReturnsChanged)
    window.addEventListener('notifications-changed', onNotificationsChanged)

    return () => {
      window.removeEventListener('auth-changed', syncAuth)
      window.removeEventListener('storage', syncAuth)
      window.removeEventListener('cart-changed', onCartChanged)
      window.removeEventListener('approvals-changed', onApprovalsChanged)
      window.removeEventListener('returns-changed', onReturnsChanged)
      window.removeEventListener('notifications-changed', onNotificationsChanged)
    }
  }, [])

  useEffect(() => {
    loadApprovalsCount()
    loadReturnsCount()
    loadNotifications()
  }, [currentUser])

  useEffect(() => {
    let mounted = true

    const loadCatalog = async () => {
      const data = await fetchCatalogProducts()
      if (!mounted) {
        return
      }
      setCatalogProducts(Array.isArray(data) ? data : [])
    }

    loadCatalog()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const loadBranding = async () => {
      try {
        const nextBranding = await fetchPublicPlatformSettings()
        if (!mounted) {
          return
        }
        setBranding(nextBranding)
      } catch {
        if (!mounted) {
          return
        }
        setBranding(getCachedBranding())
      }
    }

    const unsubscribe = onBrandingUpdated((event) => {
      setBranding(event?.detail || getCachedBranding())
    })

    loadBranding()

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const pendingCustomersAttentionCount = pendingApprovalsCount + pendingReturnsCount
  const unreadNotifications = notifications.filter((note) => !note.is_read).length

  useEffect(() => {
    closeMegaMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search])

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (notificationsMenuRef.current && !notificationsMenuRef.current.contains(event.target)) {
        setNotificationsOpen(false)
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

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
  const isSuperAdmin = role === 'super_admin'
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

  const markNotificationsRead = async () => {
    try {
      await fetch(`${API_BASE}/notifications/mark-all-read`, {
        method: 'PUT',
        headers: buildAuthHeaders(),
      })
      window.dispatchEvent(new Event('notifications-changed'))
    } catch {
      // ignore notification read sync failures
    }
  }

  const markNotificationRead = async (notificationId) => {
    try {
      await fetch(`${API_BASE}/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'PUT',
        headers: buildAuthHeaders(),
      })
      setNotifications((current) =>
        current.map((note) => (note.id === notificationId ? { ...note, is_read: true } : note)),
      )
      window.dispatchEvent(new Event('notifications-changed'))
    } catch {
      // ignore notification read sync failures
    }
  }

  const handleNotificationSelect = async (note, onSelect) => {
    await markNotificationRead(note.id)
    if (typeof onSelect === 'function') {
      onSelect(note)
    }
    setNotificationsOpen(false)
  }

  const renderNotificationsMenu = ({ maxItems = 5, onSelect } = {}) => (
    <div className="staff-notification-wrap" ref={notificationsMenuRef}>
      <button
        type="button"
        className="nav-action staff-icon-button nav-notification-button"
        onClick={() => {
          setNotificationsOpen((current) => !current)
          setProfileMenuOpen(false)
          void markNotificationsRead()
        }}
        aria-label="View notifications"
        aria-expanded={notificationsOpen}
      >
        <span aria-hidden="true">🔔</span>
        {unreadNotifications > 0 ? <span className="nav-badge">{unreadNotifications}</span> : null}
      </button>

      <div
        className={`dropdown-menu staff-dropdown nav-notification-dropdown ${notificationsOpen ? 'staff-dropdown-open' : ''}`}
        role="menu"
        aria-label="Notifications"
      >
        {notifications.length > 0 ? (
          notifications.slice(0, maxItems).map((note) => (
            <button
              key={note.id}
              type="button"
              className={`staff-notification-item staff-notification-button ${note.is_read ? 'staff-notification-read' : 'staff-notification-unread'}`}
              onClick={() => {
                void handleNotificationSelect(note, onSelect)
              }}
            >
              <p>{note.title || note.message}</p>
              <small>{note.created_at ? new Date(note.created_at).toLocaleString() : 'Just now'}</small>
            </button>
          ))
        ) : (
          <p className="staff-dropdown-empty">No notifications</p>
        )}
      </div>
    </div>
  )

  const handleProtectedNav = (path) => {
    if (!currentUser && (path === '/wishlist' || path === '/cart')) {
      navigate('/login')
      return
    }

    if ((role === 'admin' || role === 'delivery' || role === 'operations') && (path === '/wishlist' || path === '/cart')) {
      if (role === 'super_admin') {
        navigate(superAdminSecretPath)
      } else if (role === 'admin') {
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
            <img className="brand-logo" src={branding.logo_url} alt={`${branding.platform_name} logo`} />
            <span>{branding.platform_name}</span>
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
          ) : isSuperAdmin ? (
            <div className="nav-links nav-links-retail nav-links-admin">
              <div className="nav-links nav-links-retail nav-links-admin-desktop">
                <button
                  type="button"
                  className={`nav-link nav-link-retail nav-link-button ${location.pathname === superAdminSecretPath ? 'active-link' : ''}`}
                  onClick={() => navigate(superAdminSecretPath)}
                >
                  PLATFORM CONTROL
                </button>
              </div>
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
            <div className="nav-links nav-links-retail nav-links-operations">
              <div className="nav-staff-title">OPERATIONS DASHBOARD</div>
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
            {currentUser && isOperations ? (
              <div className="nav-staff-actions">
                {renderNotificationsMenu()}

                <div className="profile-menu" ref={profileMenuRef}>
                  <button
                    type="button"
                    className="nav-action profile-trigger"
                    aria-haspopup="menu"
                    aria-label="Open operations profile menu"
                    onClick={() => {
                      setProfileMenuOpen((current) => !current)
                      setNotificationsOpen(false)
                    }}
                  >
                    <span className="profile-name">👤 {displayName}</span>
                    <span className="dropdown-icon" aria-hidden="true">▼</span>
                  </button>

                  <div className={`dropdown-menu ${profileMenuOpen ? 'staff-dropdown-open' : ''}`} role="menu" aria-label="Operations profile menu">
                    <button type="button" role="menuitem" onClick={() => navigate('/operations/dashboard')}>
                      Profile
                    </button>
                    <button type="button" className="logout-btn" role="menuitem" onClick={handleLogout}>
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            ) : currentUser && isCustomer ? (
              <>
                {renderNotificationsMenu({
                  maxItems: 8,
                  onSelect: (note) => {
                    if (note.order_id) {
                      navigate('/orders/tracking')
                    }
                  },
                })}

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
              </>
            ) : currentUser && isAdmin ? (
              <div className="nav-staff-actions">
                {renderNotificationsMenu()}
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
              </div>
            ) : currentUser && isSuperAdmin ? (
              <div className="nav-staff-actions">
                {renderNotificationsMenu()}
                <div className="profile-menu">
                <button type="button" className="nav-action profile-trigger" aria-haspopup="menu" aria-label="Open super admin profile menu">
                  <span className="profile-name">👤 {displayName}</span>
                  <span className="dropdown-icon" aria-hidden="true">▼</span>
                </button>

                <div className="dropdown-menu" role="menu" aria-label="Super admin profile menu">
                  <button type="button" role="menuitem" onClick={() => navigate(superAdminSecretPath)}>
                    Dashboard
                  </button>
                  <button type="button" className="logout-btn" role="menuitem" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
                </div>
              </div>
            ) : currentUser && isDelivery ? (
              <div className="nav-staff-actions">
                {renderNotificationsMenu({
                  onSelect: (note) => {
                    if (note.order_id) {
                      navigate('/delivery/dashboard')
                    }
                  },
                })}
                <div className="profile-menu">
                <button type="button" className="nav-action profile-trigger" aria-haspopup="menu" aria-label="Open delivery profile menu">
                  <span className="profile-name">👤 {displayName}</span>
                  <span className="dropdown-icon" aria-hidden="true">▼</span>
                </button>

                <div className="dropdown-menu" role="menu" aria-label="Delivery profile menu">
                  <button type="button" role="menuitem" onClick={() => navigate('/delivery/profile')}>
                    Profile
                  </button>
                  <button type="button" role="menuitem" onClick={() => navigate('/delivery/dashboard')}>
                    Dashboard
                  </button>
                  <button type="button" className="logout-btn" role="menuitem" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
                </div>
              </div>
            ) : currentUser ? (
              <>
                <span className="nav-user-name" title={currentUser.email}>
                  {displayName}
                </span>
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
            {isAdmin || isSuperAdmin || isDelivery || isOperations || isAuthPage ? null : (
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
