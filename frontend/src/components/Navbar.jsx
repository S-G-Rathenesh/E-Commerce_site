import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

const navItems = ['Women', 'Men', 'Kids', 'Beauty', 'Studio']

const megaMenuData = {
  Women: [
    {
      title: 'Topwear',
      items: ['T-Shirts', 'Casual Shirts', 'Formal Shirts', 'Sweatshirts', 'Sweaters', 'Jackets'],
    },
    {
      title: 'Bottomwear',
      items: ['Jeans', 'Casual Trousers', 'Formal Trousers', 'Shorts', 'Track Pants & Joggers'],
    },
    {
      title: 'Footwear',
      items: ['Casual Shoes', 'Sports Shoes', 'Formal Shoes', 'Sneakers', 'Sandals & Floaters'],
    },
    {
      title: 'Fashion Accessories',
      items: ['Wallets', 'Belts', 'Perfumes & Body Mists', 'Trimmers', 'Caps & Hats'],
    },
    {
      title: 'Bags & Backpacks',
      items: ['Handbags', 'Backpacks', 'Clutches', 'Laptop Bags', 'Luggage & Trolleys'],
    },
  ],
  Men: [
    {
      title: 'Topwear',
      items: ['T-Shirts', 'Casual Shirts', 'Formal Shirts', 'Sweatshirts', 'Jackets'],
    },
    {
      title: 'Bottomwear',
      items: ['Jeans', 'Casual Trousers', 'Formal Trousers', 'Shorts', 'Joggers'],
    },
    {
      title: 'Footwear',
      items: ['Casual Shoes', 'Sports Shoes', 'Sneakers', 'Formal Shoes', 'Sandals'],
    },
    {
      title: 'Accessories',
      items: ['Wallets', 'Belts', 'Sunglasses', 'Perfumes', 'Caps & Hats'],
    },
    {
      title: 'Grooming',
      items: ['Trimmers', 'Shaving Essentials', 'Fragrances', 'Deodorants', 'Grooming Kits'],
    },
  ],
  Kids: [
    {
      title: 'Girls Clothing',
      items: ['Dresses', 'Tops', 'T-Shirts', 'Jeans', 'Shorts'],
    },
    {
      title: 'Boys Clothing',
      items: ['T-Shirts', 'Shirts', 'Shorts', 'Jeans', 'Track Pants'],
    },
    {
      title: 'Footwear',
      items: ['Sneakers', 'Casual Shoes', 'Sandals', 'Flats', 'Sports Shoes'],
    },
    {
      title: 'Toys & Accessories',
      items: ['Toys', 'Backpacks', 'Lunch Boxes', 'Stationery', 'Watches'],
    },
    {
      title: 'Baby Care',
      items: ['Essentials', 'Clothing Sets', 'Blankets', 'Bedding', 'Care Kits'],
    },
  ],
  Beauty: [
    {
      title: 'Makeup',
      items: ['Lipstick', 'Foundation', 'Mascara', 'Eyeliner', 'Primers'],
    },
    {
      title: 'Skincare',
      items: ['Face Wash', 'Serums', 'Moisturizers', 'Sunscreen', 'Masks'],
    },
    {
      title: 'Fragrance',
      items: ['Perfumes', 'Body Mists', 'Deodorants', 'Gift Sets', 'Roll-Ons'],
    },
    {
      title: 'Hair Care',
      items: ['Shampoos', 'Conditioners', 'Hair Oils', 'Serums', 'Styling'],
    },
    {
      title: 'Bath & Body',
      items: ['Body Wash', 'Lotions', 'Hand Care', 'Soap Bars', 'Scrubs'],
    },
  ],
  Studio: [
    {
      title: 'Editorial Picks',
      items: ['Trending Looks', 'Seasonal Edits', 'Curated Drops', 'Style Stories'],
    },
    {
      title: 'The Edit',
      items: ['Office Wear', 'Weekend Wear', 'Travel Fits', 'Occasion Wear'],
    },
    {
      title: 'Inspiration',
      items: ['Shop the Look', 'New Arrivals', 'Campaigns', 'Top Rated'],
    },
    {
      title: 'Occasion Guides',
      items: ['Work', 'Wedding', 'Vacation', 'Festive'],
    },
    {
      title: 'Featured Brands',
      items: ['Digital Atelier', 'Studio Select', 'Modern Basics', 'Premium Edit'],
    },
  ],
}

const quickLinks = [
  {
    title: 'Trending Now',
    text: 'Fresh drops and curated edits inspired by the season.',
  },
  {
    title: 'New In',
    text: 'Discover new silhouettes, elevated basics, and statement layers.',
  },
]

const profileLinks = [
  'Orders',
  'Wishlist',
  'Gift Cards',
  'Contact Us',
  'Myntra Insider',
  'Myntra Credit',
  'Coupons',
  'Saved Cards',
  'Saved VPA',
  'Saved Addresses',
]

export default function Navbar() {
  const [activeMenu, setActiveMenu] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const menuCloseTimeoutRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()

  const clearMenuCloseTimeout = () => {
    if (menuCloseTimeoutRef.current) {
      clearTimeout(menuCloseTimeoutRef.current)
      menuCloseTimeoutRef.current = null
    }
  }

  const scheduleMenuClose = () => {
    clearMenuCloseTimeout()
    menuCloseTimeoutRef.current = setTimeout(() => {
      setMenuOpen(false)
      setActiveMenu(null)
    }, 180)
  }

  useEffect(() => () => clearMenuCloseTimeout(), [])

  const currentMenu = activeMenu || 'Women'
  const menuColumns = useMemo(() => megaMenuData[currentMenu] || megaMenuData.Women, [currentMenu])

  const productSectionPath = (section) => `/products?section=${encodeURIComponent(section.toLowerCase())}`

  const categoryPath = (category) => `/products?category=${encodeURIComponent(category)}`

  const sectionParam = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return (params.get('section') || '').trim().toLowerCase()
  }, [location.search])

  const selectedSection = useMemo(
    () => navItems.find((item) => item.toLowerCase() === sectionParam) || null,
    [sectionParam],
  )

  const visibleActiveMenu = menuOpen ? activeMenu : selectedSection

  const handleWishlistClick = () => {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true'
    if (!isLoggedIn) {
      navigate('/login')
    }
  }

  const handleBagClick = (event) => {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true'
    if (!isLoggedIn) {
      event.preventDefault()
      navigate('/login')
    }
  }

  return (
    <header className={`navbar-wrap ${(menuOpen || profileOpen) ? 'navbar-wrap-open' : ''}`}>
      <div className="navbar-shell">
        <nav className="navbar shell navbar-retail">
          <NavLink to="/" className="brand brand-retail" aria-label="Digital Atelier home">
            <span className="brand-mark">DA</span>
            <span>Digital Atelier</span>
          </NavLink>

          <div
            className="nav-menu-region"
            onMouseEnter={clearMenuCloseTimeout}
            onMouseLeave={scheduleMenuClose}
          >
            <div className="nav-links nav-links-retail">
              <NavLink to="/" end className={({ isActive }) => `nav-link nav-link-retail ${isActive ? 'active-link' : ''}`}>
                HOME
              </NavLink>

              {navItems.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`nav-link nav-link-retail nav-link-button ${visibleActiveMenu === item ? 'active-link' : ''}`}
                  onMouseEnter={() => {
                    clearMenuCloseTimeout()
                    setMenuOpen(true)
                    setActiveMenu(item)
                  }}
                  onFocus={() => {
                    clearMenuCloseTimeout()
                    setMenuOpen(true)
                    setActiveMenu(item)
                  }}
                  onClick={() => {
                    clearMenuCloseTimeout()
                    setMenuOpen(false)
                    navigate(productSectionPath(item))
                  }}
                  aria-expanded={activeMenu === item}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>

            <section
              className={`mega-menu shell ${menuOpen ? 'mega-menu-open' : ''}`}
              aria-label={`${currentMenu} menu`}
              onMouseEnter={clearMenuCloseTimeout}
              onMouseLeave={scheduleMenuClose}
            >
              <div className="mega-menu-head">
                <div>
                  <p className="eyebrow">{currentMenu}</p>
                  <h2>Shop by category</h2>
                </div>
                <p>Expand and browse like a modern fashion marketplace.</p>
              </div>

              <div className="mega-menu-grid">
                {menuColumns.map((column) => (
                  <div key={column.title} className="mega-menu-column">
                    <h3>{column.title}</h3>
                    <ul>
                      {column.items.map((item) => (
                        <li key={item}>
                          <NavLink to={categoryPath(item)}>{item}</NavLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                <div className="mega-menu-side">
                  {quickLinks.map((link) => (
                    <article key={link.title}>
                      <p className="meta-label">{link.title}</p>
                      <p>{link.text}</p>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="nav-search">
            <span className="nav-search-icon">⌕</span>
            <input aria-label="Search products" placeholder="Search for products, brands and more" />
          </div>

          <div
            className="nav-profile-wrap"
            onMouseEnter={() => setProfileOpen(true)}
            onMouseLeave={() => setProfileOpen(false)}
          >
            <button
              type="button"
              className={`nav-action nav-profile-trigger ${profileOpen ? 'nav-profile-trigger-open' : ''}`}
              onClick={() => setProfileOpen((current) => !current)}
              aria-expanded={profileOpen}
            >
              <span>◌</span>
              <small>Profile</small>
            </button>

            <div className={`profile-menu ${profileOpen ? 'profile-menu-open' : ''}`}>
              <div className="profile-menu-head">
                <h3>Welcome</h3>
                <p>To access account and manage orders</p>
                <div className="profile-auth-actions">
                  <NavLink to="/login" className="btn btn-secondary profile-login-btn" onClick={() => setProfileOpen(false)}>
                    LOGIN
                  </NavLink>
                  <NavLink to="/signup" className="btn btn-primary profile-signup-btn" onClick={() => setProfileOpen(false)}>
                    SIGNUP
                  </NavLink>
                </div>
              </div>

              <div className="profile-menu-list">
                {profileLinks.slice(0, 4).map((item) => (
                  <NavLink key={item} to={item === 'Orders' ? '/cart' : '/products'} className="profile-menu-link">
                    {item}
                  </NavLink>
                ))}
                <div className="profile-menu-divider" />
                {profileLinks.slice(4).map((item) => (
                  <NavLink key={item} to="/products" className="profile-menu-link profile-menu-link-muted">
                    {item}
                    {item === 'Myntra Insider' ? <span>New</span> : null}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>

          <div className="nav-actions">
            <button type="button" className="nav-action" onClick={handleWishlistClick}>
              <span>♡</span>
              <small>Wishlist</small>
            </button>
            <NavLink to="/cart" className="nav-action" aria-label="Open cart" onClick={handleBagClick}>
              <span>🛍</span>
              <small>Bag</small>
            </NavLink>
          </div>
        </nav>

        <div className={`mega-menu-overlay ${menuOpen ? 'mega-menu-overlay-open' : ''}`} aria-hidden="true" />
      </div>
    </header>
  )
}
