import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ProductCard from '../components/ProductCard'
import PageWrapper from '../components/PageWrapper'
import Input from '../components/Input'
import { products as seedProducts } from '../data/products'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const categoryOptions = ['All', 'Outerwear', 'Knitwear', 'Bottoms', 'Shirts', 'Footwear']

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('featured')
  const [items, setItems] = useState(seedProducts)

  const section = searchParams.get('section') || ''
  const sectionLabel = section ? section.charAt(0).toUpperCase() + section.slice(1) : 'Collection'
  const urlCategory = searchParams.get('category') || ''
  const activeCategory = urlCategory || 'All'

  useEffect(() => {
    fetch(`${API_BASE}/products`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setItems(data)
        }
      })
      .catch(() => {
        setItems(seedProducts)
      })
  }, [])

  const filtered = useMemo(() => {
    const normalizedQuery = query.toLowerCase()

    const nextItems = items.filter((item) => {
      const matchesQuery = `${item.name} ${item.category}`.toLowerCase().includes(normalizedQuery)
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory
      return matchesQuery && matchesCategory
    })

    if (sortBy === 'price-low') {
      return [...nextItems].sort((left, right) => left.price - right.price)
    }

    if (sortBy === 'price-high') {
      return [...nextItems].sort((left, right) => right.price - left.price)
    }

    return nextItems
  }, [items, query, activeCategory, sortBy])

  const updateCategory = (nextCategory) => {
    const nextParams = new URLSearchParams(searchParams)

    if (nextCategory === 'All') {
      nextParams.delete('category')
    } else {
      nextParams.set('category', nextCategory)
    }

    setSearchParams(nextParams)
  }

  return (
    <PageWrapper
      eyebrow={section ? sectionLabel : 'Flat 300 OFF'}
      title={section ? `${sectionLabel} collection` : 'Explore the collection'}
      description="A premium fashion catalog with filters, sorting, and a visual hierarchy tuned for retail browsing."
    >
      <section className="promo-strip section-card">
        <span>On your 1st purchase via app</span>
        <strong>Flat 300 off on select styles</strong>
        <span>Limited time retail offer</span>
      </section>

      <section className="catalog-layout">
        <aside className="catalog-sidebar section-card panel-stack">
          <div>
            <p className="eyebrow">Filters</p>
            <h2>Refine your search</h2>
          </div>

          <div className="filter-block">
            <p className="filter-title">Category</p>
            <div className="filter-chip-group">
              {categoryOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`filter-chip ${activeCategory === option ? 'filter-chip-active' : ''}`}
                  onClick={() => updateCategory(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <p className="filter-title">Price range</p>
            <div className="price-marks">
              <span>$0</span>
              <span>$1000+</span>
            </div>
            <input className="price-slider" type="range" min="0" max="1000" />
          </div>

          <div className="filter-block">
            <p className="filter-title">Trending themes</p>
            <div className="pill-list">
              <span>New season</span>
              <span>Best sellers</span>
              <span>Workwear</span>
              <span>Weekend wear</span>
            </div>
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
              </select>
            </div>
          </div>

          <section className="panel panel-stack">
            <div className="section-head">
              <h2>All products</h2>
              <p>{filtered.length} results</p>
            </div>
            <div className="product-grid product-grid-wide">
              {filtered.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        </main>
      </section>
    </PageWrapper>
  )
}
