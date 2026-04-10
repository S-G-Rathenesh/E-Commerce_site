import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { products as seedProducts } from '../data/products'
import { clearStoredUser, getStoredUser } from '../utils/auth'

const navItems = ['Women', 'Men', 'Kids']

const normalize = (value) => String(value || '').trim().toLowerCase()

const uniqueValues = (values) => [...new Set(values.filter(Boolean))]

export default function Navbar() {
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const [activeMegaMenu, setActiveMegaMenu] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const closeMenuTimerRef = useRef(null)

  const searchParams = new URLSearchParams(location.search)
  const sectionParam = normalize(searchParams.get('section'))
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
    const syncAuth = () => setCurrentUser(getStoredUser())
    window.addEventListener('auth-changed', syncAuth)
    window.addEventListener('storage', syncAuth)

    return () => {
      window.removeEventListener('auth-changed', syncAuth)
      window.removeEventListener('storage', syncAuth)
    }
  }, [])

  useEffect(() => {
    closeMegaMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search])

  useEffect(() => {
    return () => {
      clearCloseTimer()
    }
  }, [])

  const displayName = (currentUser?.full_name || '').trim() || 'Guest'

  const handleLogout = () => {
    clearStoredUser()
    navigate('/')
  }

  const handleProtectedNav = (path) => {
    if (!currentUser) {
      navigate('/login')
      return
    }

    navigate(path)
  }

  return (
    <header className={`navbar-wrap ${activeMegaMenu ? 'navbar-wrap-open' : ''}`}>
      <div className="navbar-shell">
        <nav className="navbar shell navbar-retail">
          <NavLink to="/" className="brand brand-retail" aria-label="Veloura home">
            <span className="brand-mark">DA</span>
            <span>Veloura</span>
          </NavLink>

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

          <div className="nav-actions">
            {currentUser ? (
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
                <NavLink to="/login" className="nav-action">
                  <small>Login</small>
                </NavLink>
                <NavLink to="/signup" className="nav-action nav-action-signup">
                  <small>Signup</small>
                </NavLink>
              </>
            )}
            <button type="button" className="nav-action" onClick={() => handleProtectedNav('/wishlist')}>
              <span>♡</span>
              <small>Wishlist</small>
            </button>
            <button
              type="button"
              className="nav-action"
              aria-label="Open cart"
              onClick={() => handleProtectedNav('/cart')}
            >
              <span>🛍</span>
              <small>Bag</small>
            </button>
          </div>
        </nav>
      </div>
    </header>
  )
}
