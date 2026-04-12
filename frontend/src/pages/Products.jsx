import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ProductCard from '../components/ProductCard'
import PageWrapper from '../components/PageWrapper'
import Input from '../components/Input'
import { products as seedProducts } from '../data/products'
import { getStoredUser } from '../utils/auth'
import { addToWishlist, getWishlistItems } from '../utils/wishlist'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const MIN_BACKEND_PRODUCTS = 30
const REQUIRED_SECTIONS = ['women', 'men', 'kids']

const normalize = (value) => String(value || '').trim().toLowerCase()

const menDepartments = ['Topwear', 'Bottomwear', 'Ethnic Wear', 'Innerwear & Sleepwear', 'Footwear']

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('featured')
  const [maxPrice, setMaxPrice] = useState(10000)
  const [items, setItems] = useState(seedProducts)
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const [wishlistedIds, setWishlistedIds] = useState(() => {
    const ids = getWishlistItems({ user: getStoredUser() }).map((item) => Number(item.id))
    return new Set(ids)
  })
  const [wishlistMessage, setWishlistMessage] = useState('')

  const section = searchParams.get('section') || ''
  const sectionLabel = section ? section.charAt(0).toUpperCase() + section.slice(1) : 'Collection'
  const sectionNormalized = normalize(section)
  const hideCollectionIntro = ['women', 'men', 'kids'].includes(sectionNormalized)
  const urlCategory = searchParams.get('category') || ''
  const activeDepartment = searchParams.get('department') || 'All'
  const activeType = searchParams.get('type') || 'All'
  const activeSubType = searchParams.get('subtype') || 'All'

  useEffect(() => {
    fetch(`${API_BASE}/products`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) {
          setItems(seedProducts)
          return
        }

        const hasMarketplaceShape = data.some(
          (item) => item?.section && item?.category && (item?.productType || item?.subType),
        )

        const sectionsInPayload = new Set(data.map((item) => normalize(item?.section)))
        const hasRequiredSections = REQUIRED_SECTIONS.every((sectionName) => sectionsInPayload.has(sectionName))
        const hasUsefulCatalogVolume = data.length >= MIN_BACKEND_PRODUCTS

        if (hasMarketplaceShape && hasRequiredSections && hasUsefulCatalogVolume) {
          setItems(data)
        } else {
          setItems(seedProducts)
        }
      })
      .catch(() => {
        setItems(seedProducts)
      })
  }, [])

  useEffect(() => {
    const syncWishlist = () => {
      const user = getStoredUser()
      setCurrentUser(user)
      const ids = getWishlistItems({ user }).map((item) => Number(item.id))
      setWishlistedIds(new Set(ids))
    }

    window.addEventListener('wishlist-changed', syncWishlist)
    window.addEventListener('auth-changed', syncWishlist)
    window.addEventListener('storage', syncWishlist)

    return () => {
      window.removeEventListener('wishlist-changed', syncWishlist)
      window.removeEventListener('auth-changed', syncWishlist)
      window.removeEventListener('storage', syncWishlist)
    }
  }, [])

  const sectionItems = useMemo(() => {
    if (!sectionNormalized) {
      return items
    }

    return items.filter((item) => normalize(item.section) === sectionNormalized)
  }, [items, sectionNormalized])

  const highestPrice = useMemo(() => {
    if (sectionItems.length === 0) {
      return 10000
    }

    const max = Math.max(...sectionItems.map((item) => Number(item.price) || 0))
    return Math.max(500, Math.ceil(max / 100) * 100)
  }, [sectionItems])
  const effectiveMaxPrice = Math.min(maxPrice, highestPrice)

  const departments = useMemo(() => {
    if (sectionNormalized === 'men') {
      return ['All', ...menDepartments]
    }

    const all = [...new Set(sectionItems.map((item) => item.category).filter(Boolean))]
    return ['All', ...all]
  }, [sectionItems, sectionNormalized])

  const typeOptions = useMemo(() => {
    const scoped = sectionItems.filter(
      (item) => activeDepartment === 'All' || item.category === activeDepartment,
    )
    const all = [...new Set(scoped.map((item) => item.productType).filter(Boolean))]
    return ['All', ...all]
  }, [sectionItems, activeDepartment])

  const subTypeOptions = useMemo(() => {
    const scoped = sectionItems.filter((item) => {
      const departmentMatch = activeDepartment === 'All' || item.category === activeDepartment
      const typeMatch = activeType === 'All' || item.productType === activeType
      return departmentMatch && typeMatch
    })
    const all = [...new Set(scoped.map((item) => item.subType).filter(Boolean))]
    return ['All', ...all]
  }, [sectionItems, activeDepartment, activeType])

  const resolvedDepartment = useMemo(() => {
    if (activeDepartment !== 'All') {
      return activeDepartment
    }

    if (!urlCategory) {
      return 'All'
    }

    const normalizedCategory = normalize(urlCategory)
    const departmentMatch = departments.find((value) => normalize(value) === normalizedCategory)
    return departmentMatch || 'All'
  }, [activeDepartment, urlCategory, departments])

  const filtered = useMemo(() => {
    const normalizedQuery = query.toLowerCase().trim()
    const normalizedCategory = normalize(urlCategory)

    const nextItems = sectionItems.filter((item) => {
      const searchable = `${item.name} ${item.category} ${item.productType || ''} ${item.subType || ''} ${item.description || ''}`
        .toLowerCase()
      const matchesQuery = searchable.includes(normalizedQuery)
      const matchesDepartment = resolvedDepartment === 'All' || item.category === resolvedDepartment
      const matchesType = activeType === 'All' || item.productType === activeType
      const matchesSubType = activeSubType === 'All' || item.subType === activeSubType
      const matchesPrice = Number(item.price) <= effectiveMaxPrice

      const legacyCategoryMatch =
        !normalizedCategory ||
        normalize(item.category) === normalizedCategory ||
        normalize(item.productType) === normalizedCategory ||
        normalize(item.subType) === normalizedCategory

      return (
        matchesQuery &&
        matchesDepartment &&
        matchesType &&
        matchesSubType &&
        matchesPrice &&
        legacyCategoryMatch
      )
    })

    if (sortBy === 'price-low') {
      return [...nextItems].sort((left, right) => left.price - right.price)
    }

    if (sortBy === 'price-high') {
      return [...nextItems].sort((left, right) => right.price - left.price)
    }

    if (sortBy === 'name-az') {
      return [...nextItems].sort((left, right) => left.name.localeCompare(right.name))
    }

    return nextItems
  }, [
    sectionItems,
    query,
    resolvedDepartment,
    activeType,
    activeSubType,
    effectiveMaxPrice,
    urlCategory,
    sortBy,
  ])

  const updateParam = (key, value) => {
    const nextParams = new URLSearchParams(searchParams)

    if (value === 'All') {
      nextParams.delete(key)
    } else {
      nextParams.set(key, value)
    }

    if (key === 'department') {
      nextParams.delete('type')
      nextParams.delete('subtype')
    }

    if (key === 'type') {
      nextParams.delete('subtype')
    }

    setSearchParams(nextParams)
  }

  const clearAllFilters = () => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('category')
    nextParams.delete('department')
    nextParams.delete('type')
    nextParams.delete('subtype')
    setSearchParams(nextParams)
    setQuery('')
    setSortBy('featured')
    setMaxPrice(highestPrice)
  }

  const handleAddToWishlist = (product) => {
    const result = addToWishlist(product, { user: currentUser })

    if (result.added) {
      setWishlistMessage(`${product.name} added to wishlist.`)
      return
    }

    setWishlistMessage(`${product.name} is already in wishlist.`)
  }

  return (
    <PageWrapper
      eyebrow={hideCollectionIntro ? '' : section ? sectionLabel : 'Flat 300 OFF'}
      title={hideCollectionIntro ? '' : section ? `${sectionLabel} collection` : 'Explore the collection'}
      description={
        hideCollectionIntro
          ? ''
          : 'A premium fashion catalog with filters, sorting, and a visual hierarchy tuned for retail browsing.'
      }
    >
      {hideCollectionIntro ? null : (
        <section className="promo-strip section-card">
          <span>On your 1st purchase via app</span>
          <strong>Flat 300 off on select styles</strong>
          <span>Limited time retail offer</span>
        </section>
      )}

      <section className="catalog-layout">
        <aside className="catalog-sidebar section-card panel-stack">
          <div>
            <p className="eyebrow">Filters</p>
            <h2>Refine your search</h2>
          </div>

          <div className="filter-block">
            <p className="filter-title">Department</p>
            <div className="filter-chip-group">
              {departments.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`filter-chip ${resolvedDepartment === option ? 'filter-chip-active' : ''}`}
                  onClick={() => updateParam('department', option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <p className="filter-title">Product Type</p>
            <div className="filter-chip-group">
              {typeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`filter-chip ${activeType === option ? 'filter-chip-active' : ''}`}
                  onClick={() => updateParam('type', option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <p className="filter-title">Sub Type</p>
            <div className="filter-chip-group">
              {subTypeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`filter-chip ${activeSubType === option ? 'filter-chip-active' : ''}`}
                  onClick={() => updateParam('subtype', option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <p className="filter-title">Price Range</p>
            <div className="price-marks">
              <span>Rs. 0</span>
              <span>Rs. {effectiveMaxPrice}</span>
            </div>
            <input
              className="price-slider"
              type="range"
              min="0"
              max={highestPrice}
              step="100"
              value={effectiveMaxPrice}
              onChange={(event) => setMaxPrice(Number(event.target.value))}
            />
          </div>

          <div className="filter-block">
            <button type="button" className="btn btn-secondary" onClick={clearAllFilters}>
              Clear all filters
            </button>
          </div>
        </aside>

        <main className="catalog-main panel-stack">
          <div className="catalog-toolbar section-card">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products"
              aria-label="Search products"
            />

            <div className="toolbar-meta">
              <p>{filtered.length} items</p>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="featured">Featured</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="name-az">Name: A to Z</option>
              </select>
            </div>
          </div>

          <section className="panel panel-stack">
            <div className="section-head">
              <h2>All products</h2>
              <p>{filtered.length} results</p>
            </div>
            {wishlistMessage ? <p className="wishlist-message">{wishlistMessage}</p> : null}
            {filtered.length > 0 ? (
              <div className="product-grid product-grid-wide">
                {filtered.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAddToWishlist={handleAddToWishlist}
                    isWishlisted={wishlistedIds.has(Number(product.id))}
                  />
                ))}
              </div>
            ) : (
              <p>No products found for the selected filters.</p>
            )}
          </section>
        </main>
      </section>
    </PageWrapper>
  )
}
