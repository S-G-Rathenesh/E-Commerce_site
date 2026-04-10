import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { clearStoredUser, getStoredUser } from '../utils/auth'

const navItems = ['Women', 'Men', 'Kids']

const megaMenuData = {
  Women: [
    {
      title: 'Western Wear',
      items: [
        'Dresses',
        'Tops & T-Shirts',
        'Shirts & Blouses',
        'Jumpsuits & Playsuits',
        'Skirts',
        'Jeans & Jeggings',
        'Trousers & Pants',
        'Shorts',
      ],
    },
    {
      title: 'Ethnic Wear',
      items: ['Sarees', 'Kurtis', 'Salwar Kameez', 'Lehenga Choli', 'Ethnic Gowns', 'Dupattas'],
    },
    {
      title: 'Winter & Outerwear',
      items: ['Jackets', 'Coats', 'Shrugs', 'Sweaters', 'Hoodies'],
    },
    {
      title: 'Innerwear & Loungewear',
      items: ['Bras', 'Panties', 'Shapewear', 'Nightwear', 'Loungewear'],
    },
    {
      title: 'Footwear & Accessories',
      items: [
        'Heels',
        'Flats',
        'Sneakers',
        'Sandals',
        'Boots',
        'Handbags',
        'Jewelry',
        'Scarves & Stoles',
        'Belts',
        'Sunglasses',
      ],
    },
  ],
  Men: [
    {
      title: 'Topwear',
      items: [
        'T-Shirts (Crew neck, V-neck, Polo)',
        'Shirts (Casual, Formal, Linen, Denim)',
        'Sweatshirts',
        'Hoodies',
        'Jackets & Coats (Bomber, Blazer, Leather, Winter)',
        'Vests',
      ],
    },
    {
      title: 'Bottomwear',
      items: [
        'Jeans (Slim, Skinny, Regular)',
        'Trousers (Formal, Casual)',
        'Chinos',
        'Joggers',
        'Shorts',
        'Track Pants',
      ],
    },
    {
      title: 'Ethnic Wear',
      items: ['Kurta & Pajama', 'Sherwani', 'Nehru Jackets', 'Dhoti'],
    },
    {
      title: 'Innerwear & Sleepwear',
      items: ['Vests', 'Briefs / Boxers', 'Thermals', 'Nightwear'],
    },
    {
      title: 'Footwear',
      items: ['Sneakers', 'Formal Shoes', 'Loafers', 'Sandals & Flip-flops', 'Boots'],
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
      items: ['Veloura', 'Studio Select', 'Modern Basics', 'Premium Edit'],
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
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const navigate = useNavigate()
  const location = useLocation()

  const productSectionPath = (section) => `/products?section=${encodeURIComponent(section.toLowerCase())}`
  const sectionParam = (new URLSearchParams(location.search).get('section') || '').trim().toLowerCase()
  const isHomeActive = location.pathname === '/'
  const isAllActive = location.pathname === '/products' && !sectionParam

  useEffect(() => {
    const syncAuth = () => setCurrentUser(getStoredUser())
    window.addEventListener('auth-changed', syncAuth)
    window.addEventListener('storage', syncAuth)

    return () => {
      window.removeEventListener('auth-changed', syncAuth)
      window.removeEventListener('storage', syncAuth)
    }
  }, [])

  const displayName = (currentUser?.full_name || '').trim() || 'Guest'

  const handleLogout = () => {
    clearStoredUser()
    navigate('/')
  }

  return (
    <header className="navbar-wrap">
      <div className="navbar-shell">
        <nav className="navbar shell navbar-retail">
          <NavLink to="/" className="brand brand-retail" aria-label="Veloura home">
            <span className="brand-mark">DA</span>
            <span>Veloura</span>
          </NavLink>

          <div className="nav-menu-region">
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
                  onClick={() => {
                    navigate(productSectionPath(item))
                  }}
                >
                  {item.toUpperCase()}
                </button>
              ))}
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
            <button type="button" className="nav-action">
              <span>♡</span>
              <small>Wishlist</small>
            </button>
            <NavLink to="/cart" className="nav-action" aria-label="Open cart">
              <span>🛍</span>
              <small>Bag</small>
            </NavLink>
          </div>
        </nav>
      </div>
    </header>
  )
}
