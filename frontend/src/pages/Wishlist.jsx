import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'
import { getStoredUser } from '../utils/auth'
import {
  clearWishlist,
  createWishlist,
  createWishlistShareLink,
  getWishlistNotifications,
  getWishlistState,
  moveWishlistItemToCart,
  removeFromWishlist,
  setActiveWishlist,
  syncGuestWishlistToUser,
} from '../utils/wishlist'
import { fetchCatalogProducts } from '../utils/catalog'

function normalizeRole(role) {
  const next = String(role || '').trim().toLowerCase()
  if (next === 'merchant') {
    return 'admin'
  }
  return next
}

function decodeSharePayload(encodedPayload) {
  if (!encodedPayload) {
    return null
  }

  try {
    const json = decodeURIComponent(escape(atob(encodedPayload)))
    return JSON.parse(json)
  } catch {
    return null
  }
}

function compareBySort(sortBy) {
  if (sortBy === 'price-low') {
    return (left, right) => Number(left.price) - Number(right.price)
  }

  if (sortBy === 'price-high') {
    return (left, right) => Number(right.price) - Number(left.price)
  }

  if (sortBy === 'popularity') {
    return (left, right) => Number(right.id) - Number(left.id)
  }

  return (left, right) => new Date(right.addedAt).getTime() - new Date(left.addedAt).getTime()
}

export default function Wishlist() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const [state, setState] = useState(() => getWishlistState(getStoredUser()))
  const [sortBy, setSortBy] = useState('date-added')
  const [availabilityFilter, setAvailabilityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [newListName, setNewListName] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [catalogById, setCatalogById] = useState({})

  const sharePayload = useMemo(() => decodeSharePayload(searchParams.get('share')), [searchParams])

  const activeList = useMemo(() => {
    const found = state.lists.find((list) => list.id === state.activeListId)
    return found || state.lists[0]
  }, [state])

  const enrichedItems = useMemo(() => {
    const items = activeList?.items || []

    return items.map((item) => {
      const latest = catalogById[Number(item.id)]
      if (!latest) {
        return item
      }

      return {
        ...item,
        name: latest.name || item.name,
        category: latest.category || item.category,
        image: latest.image || item.image,
        price: Number(latest.price) || Number(item.price) || 0,
        inStock:
          typeof latest.inStock === 'boolean'
            ? latest.inStock
            : Number(latest.stock ?? (item.inStock ? 1 : 0)) > 0,
      }
    })
  }, [activeList, catalogById])

  const categories = useMemo(() => {
    const all = new Set(enrichedItems.map((item) => item.category).filter(Boolean))
    return ['all', ...all]
  }, [enrichedItems])

  const filteredItems = useMemo(() => {
    const base = [...enrichedItems]

    return base
      .filter((item) => {
        const availabilityMatch =
          availabilityFilter === 'all' ||
          (availabilityFilter === 'in-stock' && item.inStock) ||
          (availabilityFilter === 'out-of-stock' && !item.inStock)

        const categoryMatch = categoryFilter === 'all' || item.category === categoryFilter
        return availabilityMatch && categoryMatch
      })
      .sort(compareBySort(sortBy))
  }, [enrichedItems, availabilityFilter, categoryFilter, sortBy])

  const socialLinks = useMemo(() => {
    const shareLink = createWishlistShareLink({ listId: activeList?.id, user: currentUser })
    const encoded = encodeURIComponent(shareLink)
    const text = encodeURIComponent(`Check my ${activeList?.name || 'wishlist'} on Veloura`)

    return {
      shareLink,
      whatsapp: `https://wa.me/?text=${text}%20${encoded}`,
      twitter: `https://twitter.com/intent/tweet?text=${text}&url=${encoded}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    }
  }, [activeList, currentUser])

  useEffect(() => {
    const updateState = () => {
      const user = getStoredUser()
      setCurrentUser(user)
      setState(getWishlistState(user))
    }

    const syncAfterAuth = () => {
      const user = getStoredUser()
      if (user) {
        syncGuestWishlistToUser(user)
      }
      updateState()
    }

    window.addEventListener('wishlist-changed', updateState)
    window.addEventListener('auth-changed', syncAfterAuth)
    window.addEventListener('storage', updateState)

    return () => {
      window.removeEventListener('wishlist-changed', updateState)
      window.removeEventListener('auth-changed', syncAfterAuth)
      window.removeEventListener('storage', updateState)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const loadCatalog = async () => {
      const source = await fetchCatalogProducts()
      if (!mounted) {
        return
      }
      const mapped = source.reduce((accumulator, item) => {
        accumulator[Number(item.id)] = item
        return accumulator
      }, {})
      setCatalogById(mapped)
    }

    loadCatalog()

    return () => {
      mounted = false
    }
  }, [])

  const createList = () => {
    const id = createWishlist(newListName, { user: currentUser })
    setActiveWishlist(id, { user: currentUser })
    setNewListName('')
    setStatusMessage('New wishlist created.')
  }

  const onMoveToCart = (productId) => {
    if (!currentUser || normalizeRole(currentUser?.role) !== 'user') {
      setStatusMessage('Please login to move items to bag.')
      navigate('/login')
      return
    }

    const moved = moveWishlistItemToCart(productId, { listId: activeList.id, user: currentUser })
    setStatusMessage(moved ? 'Moved to bag.' : 'Unable to move item.')
  }

  const onClear = () => {
    clearWishlist({ listId: activeList.id, user: currentUser })
    setStatusMessage('Wishlist cleared.')
  }

  const onRemove = (productId) => {
    removeFromWishlist(productId, { listId: activeList.id, user: currentUser })
    setStatusMessage('Item removed from wishlist.')
  }

  return (
    <PageWrapper
      eyebrow="Wishlist"
      title="Saved styles for later"
      description="Track favorites, organize multiple lists, and move products directly to your bag."
      actions={
        <div className="row-gap">
          <Button variant="secondary" onClick={onClear}>
            Clear current list
          </Button>
          <Button to="/products" variant="primary">
            Browse products
          </Button>
        </div>
      }
    >
      {sharePayload ? (
        <section className="section-card panel-stack">
          <div className="section-head">
            <h2>Shared wishlist preview</h2>
            <p>{sharePayload.items?.length || 0} items</p>
          </div>
          <div className="wishlist-grid">
            {(sharePayload.items || []).map((item) => (
              <article key={`shared-${item.id}`} className="wishlist-card">
                <img src={item.image} alt={item.name} />
                <div>
                  <p className="product-category">{item.category}</p>
                  <h3>{item.name}</h3>
                  <p className="detail-price">Rs. {Number(item.price).toFixed(2)}</p>
                  <p className={`wishlist-stock ${item.inStock ? 'wishlist-stock-in' : 'wishlist-stock-out'}`}>
                    {item.inStock ? 'In stock' : 'Out of stock'}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="wishlist-layout">
        <aside className="section-card panel-stack">
          <div>
            <p className="eyebrow">Lists</p>
            <h2>Multiple wishlists</h2>
          </div>

          <div className="wishlist-list-tabs">
            {state.lists.map((list) => (
              <button
                key={list.id}
                type="button"
                className={`filter-chip ${state.activeListId === list.id ? 'filter-chip-active' : ''}`}
                onClick={() => setActiveWishlist(list.id, { user: currentUser })}
              >
                {list.name} ({list.items.length})
              </button>
            ))}
          </div>

          <div className="form-grid">
            <Input
              label="Create new list"
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder="Birthday, Festival, Office..."
            />
            <Button variant="secondary" onClick={createList}>
              Add list
            </Button>
          </div>

          <div className="panel panel-stack">
            <p className="filter-title">Share list</p>
            <Input value={socialLinks.shareLink} readOnly aria-label="Share wishlist link" />
            <div className="wishlist-share-links">
              <a href={socialLinks.whatsapp} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
              <a href={socialLinks.twitter} target="_blank" rel="noreferrer">
                X / Twitter
              </a>
              <a href={socialLinks.facebook} target="_blank" rel="noreferrer">
                Facebook
              </a>
            </div>
          </div>
        </aside>

        <main className="panel panel-stack">
          <div className="catalog-toolbar section-card">
            <div className="toolbar-meta">
              <p>{filteredItems.length} items</p>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="date-added">Date Added</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="popularity">Popularity</option>
              </select>
              <select
                value={availabilityFilter}
                onChange={(event) => setAvailabilityFilter(event.target.value)}
              >
                <option value="all">All availability</option>
                <option value="in-stock">In stock</option>
                <option value="out-of-stock">Out of stock</option>
              </select>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category === 'all' ? 'All categories' : category}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {statusMessage ? <p className="wishlist-message">{statusMessage}</p> : null}

          {filteredItems.length > 0 ? (
            <div className="wishlist-grid">
              {filteredItems.map((item) => {
                const notice = getWishlistNotifications(item)

                return (
                  <article key={`${activeList.id}-${item.id}`} className="wishlist-card">
                    <img src={item.image} alt={item.name} />
                    <div className="panel-stack">
                      <div>
                        <p className="product-category">{item.category}</p>
                        <h3>{item.name}</h3>
                        <p className="detail-price">Rs. {Number(item.price).toFixed(2)}</p>
                        <p className={`wishlist-stock ${item.inStock ? 'wishlist-stock-in' : 'wishlist-stock-out'}`}>
                          {item.inStock ? 'In stock' : 'Out of stock'}
                        </p>
                        <div className="wishlist-notes">
                          {notice.priceDropped ? <span>Price dropped since you added this item.</span> : null}
                          {notice.backInStock ? <span>Back in stock now.</span> : null}
                        </div>
                      </div>

                      <div className="row-gap">
                        <Button variant="primary" onClick={() => onMoveToCart(item.id)}>
                          Move to Bag
                        </Button>
                        <Button variant="secondary" onClick={() => onRemove(item.id)}>
                          Remove
                        </Button>
                        <Link to={`/product/${item.id}`} className="btn btn-link">
                          View details
                        </Link>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <section className="section-card panel-stack">
              <h3>No items in this list yet</h3>
              <p>Add products from listing or product detail pages to start building your wishlist.</p>
              <div className="row-gap">
                <Button to="/products" variant="primary">
                  Start shopping
                </Button>
              </div>
            </section>
          )}
        </main>
      </section>
    </PageWrapper>
  )
}
