import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { buildAuthHeaders } from '../utils/auth'
import { imgFallback } from '../utils/imgFallback'
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
import Button from '../components/Button'
import DiscoveryProductCard from '../components/DiscoveryProductCard'
import PageWrapper from '../components/PageWrapper'
import AnimatedSection from '../components/AnimatedSection'
import DeliveryEstimate from '../components/DeliveryEstimate'
import SkeletonProductCard from '../components/SkeletonProductCard'
import { addToCart, getCartItems } from '../utils/cart'
import { getStoredUser } from '../utils/auth'
import { addToWishlist, getWishlistItems } from '../utils/wishlist'
import {
  fetchCatalogFrequentlyBought,
  fetchCatalogProductById,
  fetchCatalogRelatedProducts,
  fetchCatalogRecommendedProducts,
  fetchCatalogRecentlyViewed,
} from '../utils/catalog'

const sizeOptions = ['S', 'M', 'L', 'XL']

const normalizeRole = (role) => {
  const next = String(role || '').trim().toLowerCase()
  if (next === 'merchant') return 'admin'
  return next
}


const RECENTLY_VIEWED_KEY = 'veloura_recently_viewed_products_v1'

function readRecentlyViewedIds() {
  try {
    const raw = window.localStorage.getItem(RECENTLY_VIEWED_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((value) => Number(value)).filter(Boolean) : []
  } catch {
    return []
  }
}

function writeRecentlyViewedIds(ids) {
  window.localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(ids))
}

function recordRecentlyViewedId(productId) {
  const normalizedId = Number(productId)
  if (!normalizedId) {
    return
  }

  const next = [normalizedId, ...readRecentlyViewedIds().filter((value) => value !== normalizedId)].slice(0, 8)
  writeRecentlyViewedIds(next)
}

function getDiscoveryImage(product) {
  return product?.image || ''
}

function getDiscoveryTitle(product) {
  return product?.title || product?.name || 'Product'
}

function getDiscoveryPrice(product) {
  return Number(product?.price || 0)
}

function getDiscoveryBadge(product) {
  return product?.delivery_badge || 'Free Delivery'
}

function getDiscountLabel(product) {
  const discount = Number(product?.discount_percent || 0)
  return `${discount || 5}% OFF`
}

function normalizeDiscoveryProduct(product) {
  if (!product) {
    return null
  }

  return {
    ...product,
    id: Number(product.id),
    title: getDiscoveryTitle(product),
    image: getDiscoveryImage(product),
    price: getDiscoveryPrice(product),
  }
}

function discoveryProductsToIdList(items) {
  return (Array.isArray(items) ? items : []).map((item) => Number(item?.id)).filter(Boolean)
}

function normalizeProductText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function getProductCategoryKind(product) {
  const searchableText = normalizeProductText(
    [product?.name, product?.category, product?.section, product?.productType, product?.subType].filter(Boolean).join(' '),
  )

  if (/(shoe|shoes|sneaker|sneakers|sandal|sandals|boot|boots|footwear)/.test(searchableText)) {
    return 'shoes'
  }

  if (/(electronics?|mobile|phone|smartphone|laptop|tablet|camera|television|tv|headphone|speaker|watch)/.test(searchableText)) {
    return 'electronics'
  }

  return 'fashion'
}

function formatSpecificationValue(value) {
  if (Array.isArray(value)) {
    const next = value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)
    return next.length > 0 ? next.join(', ') : '—'
  }

  if (value === null || value === undefined || value === '') {
    return '—'
  }

  return String(value)
}

function buildProductSpecifications(product) {
  if (!product) {
    return []
  }

  const categoryKind = getProductCategoryKind(product)

  if (categoryKind === 'electronics') {
    return [
      { label: 'Brand', value: formatSpecificationValue(product.brand) },
      { label: 'Category', value: formatSpecificationValue(product.category) },
      { label: 'Product Code', value: formatSpecificationValue(product.sku) },
      { label: 'Technology Type', value: formatSpecificationValue(product.productType || product.subType) },
      { label: 'Color', value: formatSpecificationValue(product.color) },
      { label: 'Weight', value: formatSpecificationValue(product.weight) },
      { label: 'Country of Origin', value: formatSpecificationValue(product.country_of_origin) },
      { label: 'Stock Availability', value: formatSpecificationValue(product.stock_status) },
      { label: 'Description', value: formatSpecificationValue(product.description) },
    ]
  }

  if (categoryKind === 'shoes') {
    return [
      { label: 'Brand', value: formatSpecificationValue(product.brand) },
      { label: 'Upper Material', value: formatSpecificationValue(product.fabric) },
      { label: 'Fit Type', value: formatSpecificationValue(product.fit_type) },
      { label: 'Pattern', value: formatSpecificationValue(product.pattern) },
      { label: 'Closure Type', value: formatSpecificationValue(product.closure_type) },
      { label: 'Occasion', value: formatSpecificationValue(product.occasion) },
      { label: 'SKU / Product Code', value: formatSpecificationValue(product.sku) },
      { label: 'Available Sizes', value: formatSpecificationValue(product.available_sizes) },
      { label: 'Color', value: formatSpecificationValue(product.color) },
      { label: 'Weight', value: formatSpecificationValue(product.weight) },
      { label: 'Country of Origin', value: formatSpecificationValue(product.country_of_origin) },
      { label: 'Stock Availability', value: formatSpecificationValue(product.stock_status) },
    ]
  }

  return [
    { label: 'Fabric / Material', value: formatSpecificationValue(product.fabric) },
    { label: 'Fit Type', value: formatSpecificationValue(product.fit_type) },
    { label: 'Pattern', value: formatSpecificationValue(product.pattern) },
    { label: 'Sleeve Type', value: formatSpecificationValue(product.sleeve_type) },
    { label: 'Neck Type', value: formatSpecificationValue(product.neck_type) },
    { label: 'Occasion', value: formatSpecificationValue(product.occasion) },
    { label: 'Closure Type', value: formatSpecificationValue(product.closure_type) },
    { label: 'Wash Care', value: formatSpecificationValue(product.wash_care) },
    { label: 'Country of Origin', value: formatSpecificationValue(product.country_of_origin) },
    { label: 'Brand', value: formatSpecificationValue(product.brand) },
    { label: 'SKU / Product Code', value: formatSpecificationValue(product.sku) },
    { label: 'Weight', value: formatSpecificationValue(product.weight) },
    { label: 'Available Sizes', value: formatSpecificationValue(product.available_sizes) },
    { label: 'Color', value: formatSpecificationValue(product.color) },
    { label: 'Stock Availability', value: formatSpecificationValue(product.stock_status) },
    { label: 'Style Note', value: formatSpecificationValue(product.description || 'Handpicked retail style.') },
  ]
}

function buildCompareSpecRows(product) {
  return [
    { label: 'Fabric', value: formatSpecificationValue(product.fabric) },
    { label: 'Fit', value: formatSpecificationValue(product.fit_type) },
    { label: 'Price', value: `Rs. ${Number(product.price || 0).toFixed(2)}` },
    { label: 'Ratings', value: `${Number(product.rating || 4.8).toFixed(1)} / 5` },
  ]
}

function getRelatedBadge(product, index) {
  const price = Number(product?.price || 0)
  if (index === 0 || price >= 3500) {
    return 'Best Seller'
  }
  if (price >= 1800 || Number(product?.rating || 0) >= 4.7) {
    return 'Trending'
  }
  return 'New'
}

function renderRatingStars(rating) {
  const fullStars = Math.max(1, Math.min(5, Math.round(Number(rating || 0))))
  return `${'★'.repeat(fullStars)}${'☆'.repeat(5 - fullStars)}`
}

export default function ProductDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bundleData, setBundleData] = useState(null)
  const [relatedProducts, setRelatedProducts] = useState([])
  const [recommendedProducts, setRecommendedProducts] = useState([])
  const [recentlyViewedProducts, setRecentlyViewedProducts] = useState([])
  const [relatedLoading, setRelatedLoading] = useState(true)
  const [recommendedLoading, setRecommendedLoading] = useState(true)
  const [bundleLoading, setBundleLoading] = useState(true)
  const [recentlyViewedLoading, setRecentlyViewedLoading] = useState(true)
  const [showFullSpecifications, setShowFullSpecifications] = useState(false)
  const [selectedSize, setSelectedSize] = useState('M')
  const [quantity, setQuantity] = useState(1)
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const [actionMessage, setActionMessage] = useState('')
  const [productReviews, setProductReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [reviewStats, setReviewStats] = useState({
    total_reviews: 0,
    average_rating: 0,
    rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  })

  useEffect(() => {
    let active = true

    const loadPageData = async () => {
      setLoading(true)
      setBundleLoading(true)
      setRelatedLoading(true)
      setRecommendedLoading(true)
      setRecentlyViewedLoading(true)
      setReviewsLoading(true)

      try {
        const recentSeedIds = readRecentlyViewedIds().filter((value) => value !== Number(id))
        const cartIds = discoveryProductsToIdList(getCartItems(currentUser))
        const wishlistIds = discoveryProductsToIdList(getWishlistItems({ user: currentUser }))

        const [productResult, bundleResult, relatedResult, recommendedResult, recentlyViewedResult, reviewsResult] = await Promise.allSettled([
          fetchCatalogProductById(id),
          fetchCatalogFrequentlyBought(id),
          fetchCatalogRelatedProducts(id),
          fetchCatalogRecommendedProducts(id, {
            cart_ids: cartIds,
            wishlist_ids: wishlistIds,
            viewed_ids: recentSeedIds,
          }),
          fetchCatalogRecentlyViewed(recentSeedIds),
          fetch(`${API_BASE}/products/${id}/reviews`).then(res => res.json()),
        ])

        if (!active) {
          return
        }

        const productData = productResult.status === 'fulfilled' ? productResult.value : null
        const bundleResponse = bundleResult.status === 'fulfilled' ? bundleResult.value : null
        const relatedData = relatedResult.status === 'fulfilled' ? relatedResult.value : []
        const recommendedData = recommendedResult.status === 'fulfilled' ? recommendedResult.value : []
        const recentlyViewedData = recentlyViewedResult.status === 'fulfilled' ? recentlyViewedResult.value : []
        const reviewsData = reviewsResult.status === 'fulfilled' ? reviewsResult.value : { reviews: [], total_reviews: 0, average_rating: 0, rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }

        if (productData?.id) {
          recordRecentlyViewedId(productData.id)
        }

        setProduct(productData ? normalizeDiscoveryProduct(productData) : null)
        setBundleData(bundleResponse && typeof bundleResponse === 'object' ? bundleResponse : null)
        setRelatedProducts(Array.isArray(relatedData) ? relatedData.map(normalizeDiscoveryProduct).filter(Boolean) : [])
        setRecommendedProducts(Array.isArray(recommendedData) ? recommendedData.map(normalizeDiscoveryProduct).filter(Boolean) : [])
        const fallbackRecent = Array.isArray(recentlyViewedData) ? recentlyViewedData.map(normalizeDiscoveryProduct).filter(Boolean) : []
        setRecentlyViewedProducts(fallbackRecent.length > 0 ? fallbackRecent : relatedData.map(normalizeDiscoveryProduct).filter(Boolean).slice(0, 4))
        setProductReviews(reviewsData.reviews || [])
        setReviewStats({
          total_reviews: reviewsData.total_reviews || 0,
          average_rating: reviewsData.average_rating || 0,
          rating_distribution: reviewsData.rating_distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
        })
        setActiveImageIndex(0)
      } finally {
        if (active) {
          setLoading(false)
          setBundleLoading(false)
          setRelatedLoading(false)
          setReviewsLoading(false)
          setRecommendedLoading(false)
          setRecentlyViewedLoading(false)
        }
      }
    }

    loadPageData()

    return () => {
      active = false
    }
  }, [id, currentUser])

  useEffect(() => {
    const syncAuth = () => setCurrentUser(getStoredUser())
    window.addEventListener('auth-changed', syncAuth)
    window.addEventListener('storage', syncAuth)

    return () => {
      window.removeEventListener('auth-changed', syncAuth)
      window.removeEventListener('storage', syncAuth)
    }
  }, [])

  const wishlistedDiscoveryIds = useMemo(
    () => new Set(getWishlistItems({ user: currentUser }).map((item) => Number(item.id)).filter(Boolean)),
    [currentUser],
  )

  const productCategoryKind = useMemo(() => getProductCategoryKind(product), [product])
  const productSpecifications = useMemo(() => buildProductSpecifications(product), [product])
  const visibleProductSpecifications = useMemo(
    () => (showFullSpecifications ? productSpecifications : productSpecifications.slice(0, 6)),
    [productSpecifications, showFullSpecifications],
  )
  const compareProducts = useMemo(() => [product, ...relatedProducts.slice(0, 2)].filter(Boolean), [product, relatedProducts])

  const imageSet = useMemo(() => {
    if (!product) return []

    // Build gallery from the product's own image data — never use a hardcoded map
    // that could mismatch products when IDs change or new products are added.
    const primary = String(product.image || '').trim()

    // Support additional_images array if the product has one (backend may provide it)
    const extras = Array.isArray(product.additional_images)
      ? product.additional_images.map((u) => String(u || '').trim()).filter(Boolean)
      : []

    // Deduplicate: primary first, then extras without repeating primary
    const all = [primary, ...extras.filter((u) => u !== primary)].filter(Boolean)

    // Always show at least one image
    return all.length > 0 ? all : [primary].filter(Boolean)
  }, [product])

  if (loading) {
    return (
      <PageWrapper className="product-detail-page" title="Loading product" description="Preparing the product details and discovery section.">
        <section className="detail-loading-shell panel panel-stack">
          <div className="detail-loading-grid">
            <div className="detail-loading-media skeleton-shimmer" />
            <div className="detail-loading-copy panel panel-stack">
              <div className="skeleton-line skeleton-line-long skeleton-shimmer" />
              <div className="skeleton-line skeleton-line-medium skeleton-shimmer" />
              <div className="skeleton-line skeleton-line-short skeleton-shimmer" />
              <div className="skeleton-line skeleton-line-long skeleton-shimmer" />
              <div className="skeleton-line skeleton-line-medium skeleton-shimmer" />
              <div className="detail-loading-actions">
                <div className="skeleton-btn skeleton-shimmer" />
                <div className="skeleton-btn skeleton-shimmer" />
              </div>
            </div>
          </div>
          <div className="detail-loading-related">
            <div className="detail-section-head">
              <div>
                <div className="skeleton-line skeleton-line-medium skeleton-shimmer" />
                <div className="skeleton-line skeleton-line-short skeleton-shimmer" />
              </div>
            </div>
            <div className="related-products-track related-products-track-loading">
              {Array.from({ length: 4 }).map((_, index) => (
                <SkeletonProductCard key={`detail-loading-${index}`} />
              ))}
            </div>
          </div>
        </section>
      </PageWrapper>
    )
  }

  if (!product) {
    return (
      <PageWrapper title="Product not found" description="The requested item could not be loaded.">
        <Button to="/products" variant="primary">
          Back to products
        </Button>
      </PageWrapper>
    )
  }

  const activeImage = imageSet[activeImageIndex] || product.image
  const renderedStars = '★★★★★'

  const handleAddToCart = () => {
    const role = normalizeRole(currentUser?.role)
    if (!currentUser || role !== 'user') {
      const message = 'Please login to add products to bag.'
      setActionMessage(message)
      toast(message)
      navigate('/login')
      return
    }

    // Prevent adding out-of-stock items
    const available = Number(product?.available_stock || 0)
    if (available <= 0) {
      const message = 'This product is currently out of stock. Click Notify Me to get a restock alert.'
      setActionMessage(message)
      toast(message)
      return
    }

    addToCart(product, { quantity, size: selectedSize, user: currentUser })
    const message = `${product.name} added to bag.`
    setActionMessage(message)
    toast.success(message)
  }

  const handleBuyNow = () => {
    const role = normalizeRole(currentUser?.role)
    if (!currentUser || role !== 'user') {
      const message = 'Please login to buy products.'
      setActionMessage(message)
      toast(message)
      navigate('/login')
      return
    }

    const available = Number(product?.available_stock || 0)
    if (available <= 0) {
      const message = 'This product is currently out of stock.'
      setActionMessage(message)
      toast(message)
      return
    }

    // Write a single-item buy-now session so Checkout can pick it up
    const buyNowItem = {
      id: Number(product.id),
      name: String(product.name || 'Product'),
      category: String(product.category || ''),
      productType: String(product.productType || ''),
      subType: String(product.subType || ''),
      image: String(product.image || ''),
      price: Number(product.price) || 0,
      size: selectedSize,
      quantity,
      inStock: true,
    }
    sessionStorage.setItem('veloura_buy_now', JSON.stringify(buyNowItem))
    navigate('/checkout')
  }

  const handleAddRelatedToCart = (relatedProduct) => {
    const role = normalizeRole(currentUser?.role)

    if (!currentUser || role !== 'user') {
      const message = 'Please login to add products to bag.'
      setActionMessage(message)
      toast(message)
      navigate('/login')
      return
    }

    const cartProduct = {
      ...relatedProduct,
      name: relatedProduct.title,
    }
    addToCart(cartProduct, { quantity: 1, size: selectedSize, user: currentUser })
    const message = `${relatedProduct.title} added to bag.`
    setActionMessage(message)
    toast.success(message)
  }

  const handleDiscoveryAddToCart = (discoveryProduct) => {
    const role = normalizeRole(currentUser?.role)

    if (!currentUser || role !== 'user') {
      const message = 'Please login to add products to bag.'
      setActionMessage(message)
      toast(message)
      navigate('/login')
      return
    }

    const cartProduct = {
      ...discoveryProduct,
      name: getDiscoveryTitle(discoveryProduct),
    }

    addToCart(cartProduct, { quantity: 1, size: selectedSize, user: currentUser })
    const message = `${getDiscoveryTitle(discoveryProduct)} added to bag.`
    setActionMessage(message)
    toast.success(message)
  }

  const handleToggleDiscoveryWishlist = (discoveryProduct) => {
    const role = normalizeRole(currentUser?.role)

    if (!currentUser || role !== 'user') {
      const message = 'Please login to add products to wishlist.'
      setActionMessage(message)
      toast(message)
      navigate('/login')
      return
    }

    const result = addToWishlist(
      {
        ...discoveryProduct,
        name: getDiscoveryTitle(discoveryProduct),
      },
      { user: currentUser },
    )

    if (result.added) {
      const message = `${getDiscoveryTitle(discoveryProduct)} added to wishlist.`
      setActionMessage(message)
      toast.success(message)
    } else {
      const message = `${getDiscoveryTitle(discoveryProduct)} is already in wishlist.`
      setActionMessage(message)
      toast(message)
    }
  }

  const handleAddBundleToCart = () => {
    const role = normalizeRole(currentUser?.role)

    if (!currentUser || role !== 'user') {
      const message = 'Please login to add bundle items to bag.'
      setActionMessage(message)
      toast(message)
      navigate('/login')
      return
    }

    const bundleItems = [product, ...((bundleData && Array.isArray(bundleData.bundle)) ? bundleData.bundle : [])].filter(Boolean)
    bundleItems.forEach((item) => {
      const cartProduct = {
        ...item,
        name: getDiscoveryTitle(item),
      }
      addToCart(cartProduct, { quantity: 1, size: selectedSize, user: currentUser })
    })

    const message = `${bundleItems.length} items added to bag.`
    setActionMessage(message)
    toast.success(message)
  }

  const handleAddToWishlist = () => {
    const role = normalizeRole(currentUser?.role)

    if (!currentUser || role !== 'user') {
      const message = 'Please login to add products to wishlist.'
      setActionMessage(message)
      toast(message)
      navigate('/login')
      return
    }

    const result = addToWishlist(product, { user: currentUser })
    if (result.added) {
      // Sync to server-side wishlist when authenticated
      (async () => {
        try {
          await fetch(`${API_BASE}/wishlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
            body: JSON.stringify({ product_id: Number(product.id) }),
          })
        } catch {
          // ignore sync failures
        }
      })()

      const message = `${product.name} added to wishlist.`
      setActionMessage(message)
      toast.success(message)
    } else {
      const message = `${product.name} is already in wishlist.`
      setActionMessage(message)
      toast(message)
    }
  }

  return (
    <PageWrapper className="product-detail-page">
      <nav className="detail-breadcrumb" aria-label="Breadcrumb">
        <Link to="/products">Shop</Link>
        <span>›</span>
        <Link to={`/products?category=${encodeURIComponent(product.category)}`}>{product.category}</Link>
        <span>›</span>
        <strong>{product.name}</strong>
      </nav>

      <AnimatedSection as="section" className="detail-showcase">
        <div className="detail-gallery">
          <div className="detail-main-image-wrap">
            <img src={activeImage} alt={product.name} className="detail-main-image" />
          </div>
          <div className="detail-thumbs" aria-label="Product images">
            {imageSet.slice(0, 4).map((image, index) => (
              <button
                key={`${product.id}-${index}`}
                type="button"
                className={`detail-thumb ${activeImageIndex === index ? 'detail-thumb-active' : ''}`}
                onClick={() => setActiveImageIndex(index)}
                aria-label={`View image ${index + 1}`}
              >
                <img src={image} alt={`${product.name} preview ${index + 1}`} />
              </button>
            ))}
          </div>
        </div>

        <article className="detail-summary">
          <div className="detail-summary-core">
            <div className="detail-title-row">
              <h1>{product.name}</h1>
              {product?.stock_status === 'Out of Stock' ? (
                <span className="detail-stock-badge badge-out">Out of Stock</span>
              ) : product?.stock_status === 'Limited Stock' ? (
                <span className="detail-stock-badge badge-low">Only {product?.available_stock ?? product?.stock} left</span>
              ) : null}
            </div>
            <p className="detail-price">Rs. {Number(product.price).toFixed(2)}</p>
            <p className="detail-copy">{product.description}</p>
            <DeliveryEstimate productId={product.id} currentUser={currentUser} orderTotal={Number(product.price) || 0} />
          </div>

          <div className="detail-purchase-block">
            <div className="detail-size-row">
              <div className="detail-size-head">
                <p>Select Size</p>
                <button type="button" className="btn btn-link detail-guide-btn">
                  Size Guide
                </button>
              </div>
              <div className="detail-size-options">
                {sizeOptions.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`detail-size-chip ${selectedSize === size ? 'detail-size-chip-active' : ''}`}
                    onClick={() => setSelectedSize(size)}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div className="detail-cart-row">
              <div className="detail-qty" aria-label="Quantity controls">
                <button
                  type="button"
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span>{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((current) => Math.min(10, current + 1))}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <Button
                variant="primary"
                className="btn-wide detail-add-btn"
                onClick={handleAddToCart}
                disabled={Number(product?.available_stock || 0) <= 0}
              >
                {Number(product?.available_stock || 0) <= 0 ? 'Unavailable' : 'Add to Cart'}
              </Button>
            </div>

            <div className="detail-buy-now-row">
              <Button
                variant="accent"
                className="btn-wide detail-buy-now-btn"
                onClick={handleBuyNow}
                disabled={Number(product?.available_stock || 0) <= 0}
              >
                {Number(product?.available_stock || 0) <= 0 ? 'Out of Stock' : 'Buy Now'}
              </Button>
            </div>
            
            <div className="row-gap detail-secondary-actions">
              {Number(product?.available_stock || 0) <= 0 ? (
                <Button variant="secondary" onClick={handleAddToWishlist}>
                  Notify Me
                </Button>
              ) : (
                <Button variant="secondary" onClick={handleAddToWishlist}>
                  Add to Wishlist
                </Button>
              )}
            </div>

            {actionMessage ? <p className="wishlist-message">{actionMessage}</p> : null}
          </div>

          <div className="detail-feature-row">
            <p>🚚 Free Express Shipping</p>
            <p>🌿 Sustainable Materials</p>
          </div>
        </article>
      </AnimatedSection>

      <AnimatedSection as="section" className="detail-specs" delay={0.03}>
        <div className="detail-section-head">
          <div>
            <p className="detail-section-eyebrow">Product specification</p>
            <h2>Product details at a glance</h2>
            <p>
              {productCategoryKind === 'electronics'
                ? 'Technical product details with a clean, category-aware view.'
                : productCategoryKind === 'shoes'
                  ? 'Shoe specifications that help shoppers compare fit, size, and finish.'
                  : 'Fashion specifications styled like Amazon, Myntra, and Flipkart product tables.'}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setShowFullSpecifications((current) => !current)}
            aria-expanded={showFullSpecifications}
          >
            {showFullSpecifications ? 'Hide full specifications' : 'View Full Specifications'}
          </Button>
        </div>

        <div className="detail-spec-table" role="table" aria-label="Product specifications">
          {visibleProductSpecifications.map((spec) => (
            <div key={spec.label} className="detail-spec-row" role="row">
              <p className="detail-spec-label" role="cell">
                {spec.label}
              </p>
              <strong className="detail-spec-value" role="cell">
                {spec.value}
              </strong>
            </div>
          ))}
        </div>

        {!showFullSpecifications && productSpecifications.length > visibleProductSpecifications.length ? (
          <p className="detail-specs-note">
            Showing {visibleProductSpecifications.length} of {productSpecifications.length} specifications.
          </p>
        ) : null}
      </AnimatedSection>

      {compareProducts.length > 1 ? (
        <AnimatedSection as="section" className="detail-compare-section" delay={0.045}>
          <div className="detail-section-head">
            <div>
              <p className="detail-section-eyebrow">Comparison</p>
              <h2>Compare Similar Products</h2>
              <p>Check fabric, fit, price, and ratings side by side before you decide.</p>
            </div>
          </div>

          <div className="detail-compare-grid">
            {compareProducts.map((compareProduct, index) => {
              const compareRows = buildCompareSpecRows(compareProduct)
              return (
                <article
                  key={compareProduct.id}
                  className={`detail-compare-card ${index === 0 ? 'detail-compare-card-current' : ''}`}
                >
                  <div className="detail-compare-card-head">
                    <div>
                      <p>{index === 0 ? 'Current product' : 'Similar product'}</p>
                      <h3>{compareProduct.name || compareProduct.title}</h3>
                    </div>
                    <Link to={`/product/${compareProduct.id}`} className="btn btn-link detail-compare-link">
                      View Product
                    </Link>
                  </div>

                  <dl className="detail-compare-specs">
                    {compareRows.map((row) => (
                      <div key={row.label} className="detail-compare-row">
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              )
            })}
          </div>
        </AnimatedSection>
      ) : null}

      <AnimatedSection as="section" className="detail-reviews" delay={0.06}>
        <div className="detail-reviews-head">
          <div>
            <h2>Customer Reviews</h2>
            <p>
              <span>{renderedStars}</span> {reviewStats.average_rating.toFixed(1)} out of 5 ({reviewStats.total_reviews} {reviewStats.total_reviews === 1 ? 'review' : 'reviews'})
            </p>
          </div>
        </div>

        {reviewsLoading ? (
          <p>Loading reviews...</p>
        ) : productReviews.length > 0 ? (
          <div className="detail-review-grid">
            {productReviews.map((review) => (
              <article key={review.review_id} className="detail-review-card">
                <div className="detail-review-meta">
                  <div className="detail-review-avatar">{review.customer_name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <h3>{review.customer_name}</h3>
                    <p>
                      Verified Buyer • {new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <strong>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</strong>
                </div>
                {review.review_text && <p>{review.review_text}</p>}
              </article>
            ))}
          </div>
        ) : (
          <div className="no-reviews-message">
            <p>No reviews yet. Be the first to review this product!</p>
          </div>
        )}

        <div className="detail-review-foot">
          <Link to="/products" className="btn btn-link">
            Continue Shopping
          </Link>
        </div>
      </AnimatedSection>

      <AnimatedSection as="section" className="detail-related-products" delay={0.09}>
        <div className="detail-section-head">
          <div>
            <p className="detail-section-eyebrow">Bundle</p>
            <h2>Frequently Bought Together</h2>
            <p>Complete the look with compatible pieces based on this product.</p>
          </div>
          <Button variant="primary" onClick={handleAddBundleToCart}>
            Add All to Cart
          </Button>
        </div>

        <div className="bundle-summary">
          <p>Bundle total</p>
          <strong className="bundle-price">Rs. {Number(bundleData?.bundle_total_price || Number(product.price || 0)).toFixed(2)}</strong>
          <p className="bundle-savings">Save Rs. {Number(bundleData?.bundle_savings || 0).toFixed(2)} on this set.</p>
          <p>Includes the current item plus handpicked companions.</p>
        </div>

        <div className="related-products-track" aria-label="Frequently bought together">
          {(bundleLoading ? Array.from({ length: 4 }).map(() => null) : [bundleData?.product, ...((bundleData && Array.isArray(bundleData.bundle)) ? bundleData.bundle : [])].filter(Boolean)).map((item, index) => (
            bundleLoading ? (
              <SkeletonProductCard key={`bundle-skeleton-${index}`} />
            ) : (
              <DiscoveryProductCard
                key={item.id}
                product={{
                  ...item,
                  badge: index === 0 ? 'Current' : index === 1 ? 'Best Seller' : index === 2 ? 'Trending' : 'New',
                }}
                wishlisted={wishlistedDiscoveryIds.has(Number(item.id))}
                onAddToCart={handleDiscoveryAddToCart}
                onToggleWishlist={handleToggleDiscoveryWishlist}
              />
            )
          ))}
        </div>
      </AnimatedSection>

      <AnimatedSection as="section" className="detail-related-products" delay={0.12}>
        <div className="detail-section-head">
          <div>
            <p className="detail-section-eyebrow">Discovery</p>
            <h2>Related Products</h2>
            <p>Similar products based on category, style, color theme, and price range.</p>
          </div>
          <Button to="/products" variant="secondary">
            Browse all products
          </Button>
        </div>

        <div className="related-products-track" aria-label="Related products">
          {relatedLoading ? (
            Array.from({ length: 4 }).map((_, index) => <SkeletonProductCard key={`related-skeleton-${index}`} />)
          ) : relatedProducts.length > 0 ? (
            relatedProducts.map((relatedProduct, index) => (
              <DiscoveryProductCard
                key={relatedProduct.id}
                product={{
                  ...relatedProduct,
                  badge: getRelatedBadge(relatedProduct, index),
                }}
                wishlisted={wishlistedDiscoveryIds.has(Number(relatedProduct.id))}
                onAddToCart={handleDiscoveryAddToCart}
                onToggleWishlist={handleToggleDiscoveryWishlist}
              />
            ))
          ) : (
            <p className="detail-related-empty">No related products available right now.</p>
          )}
        </div>
      </AnimatedSection>

      <AnimatedSection as="section" className="detail-related-products" delay={0.15}>
        <div className="detail-section-head">
          <div>
            <p className="detail-section-eyebrow">Personalized</p>
            <h2>Recommended For You</h2>
            <p>Personalized suggestions based on wishlist, cart, viewed items, and your browsing pattern.</p>
          </div>
        </div>

        <div className="related-products-track" aria-label="Recommended products">
          {recommendedLoading ? (
            Array.from({ length: 4 }).map((_, index) => <SkeletonProductCard key={`recommended-skeleton-${index}`} />)
          ) : recommendedProducts.length > 0 ? (
            recommendedProducts.map((recommendedProduct, index) => (
              <DiscoveryProductCard
                key={recommendedProduct.id}
                product={{
                  ...recommendedProduct,
                  badge: index === 0 ? 'Trending' : index === 1 ? 'Best Seller' : 'New',
                }}
                wishlisted={wishlistedDiscoveryIds.has(Number(recommendedProduct.id))}
                onAddToCart={handleDiscoveryAddToCart}
                onToggleWishlist={handleToggleDiscoveryWishlist}
              />
            ))
          ) : (
            <p className="detail-related-empty">No recommendations available right now.</p>
          )}
        </div>
      </AnimatedSection>

      <AnimatedSection as="section" className="detail-related-products" delay={0.18}>
        <div className="detail-section-head">
          <div>
            <p className="detail-section-eyebrow">History</p>
            <h2>Recently Viewed</h2>
            <p>Last opened products stay visible here so discovery continues from where you left off.</p>
          </div>
        </div>

        <div className="related-products-track" aria-label="Recently viewed products">
          {recentlyViewedLoading ? (
            Array.from({ length: 4 }).map((_, index) => <SkeletonProductCard key={`recent-skeleton-${index}`} />)
          ) : recentlyViewedProducts.length > 0 ? (
            recentlyViewedProducts.map((recentProduct, index) => (
              <DiscoveryProductCard
                key={recentProduct.id}
                product={{
                  ...recentProduct,
                  badge: index === 0 ? 'Recently Viewed' : 'New',
                }}
                wishlisted={wishlistedDiscoveryIds.has(Number(recentProduct.id))}
                onAddToCart={handleDiscoveryAddToCart}
                onToggleWishlist={handleToggleDiscoveryWishlist}
              />
            ))
          ) : (
            <p className="detail-related-empty">No recently viewed products yet.</p>
          )}
        </div>
      </AnimatedSection>
    </PageWrapper>
  )
}
