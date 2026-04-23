import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ProductCard from '../components/ProductCard'
import AnimatedSection from '../components/AnimatedSection'
import PageWrapper from '../components/PageWrapper'
import { fetchCatalogProducts } from '../utils/catalog'
import { fetchPublicBanners, fetchPublicGlobalOffer } from '../utils/platform'
import { addToWishlist, getWishlistItems } from '../utils/wishlist'
import { getStoredUser } from '../utils/auth'

const SALE_SLIDE_INTERVAL = 5000

const defaultSaleSlides = [
  {
    id: 'summer-festival',
    offerText: 'Flat Rs. 300 OFF on your 1st purchase via app',
    offerCode: 'Use code: FIRST300',
    seasonLeft: 'Fashion Carnival',
    seasonTitle: 'Season Sale Live: 50-80% OFF',
    seasonRight: 'Summer Edit 2026',
    kicker: 'Festival Sale',
    title: "Sun's Out, Deals Are In",
    description:
      'Mega savings across Women, Men and Kids. Trending styles, bestsellers, and limited-time flash offers live now.',
    ctaPrimaryLabel: 'Shop Sale Now',
    ctaPrimaryTo: '/products',
    ctaSecondaryLabel: 'Explore Women Deals',
    ctaSecondaryTo: '/products?section=women',
    discount: '50-80%',
    image:
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1300&q=80',
    imageAlt: 'Women seasonal fashion collection',
  },
  {
    id: 'men-weekend',
    offerText: 'Weekend Rush: Extra 15% OFF on top brands',
    offerCode: 'Use code: WEEKEND15',
    seasonLeft: 'Menswear Edit',
    seasonTitle: 'Weekend Price Drop: 40-70% OFF',
    seasonRight: 'Limited Time',
    kicker: 'Season Sale',
    title: 'Fresh Fits For Every Plan',
    description:
      'From street-ready layers to elevated essentials, discover top-rated menswear at unbeatable prices this weekend.',
    ctaPrimaryLabel: 'Shop Men Sale',
    ctaPrimaryTo: '/products?section=men',
    ctaSecondaryLabel: 'View Topwear Deals',
    ctaSecondaryTo: '/products?section=men&department=Topwear',
    discount: '40-70%',
    image:
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1300&q=80',
    imageAlt: 'Menswear sale hero image',
  },
  {
    id: 'kids-holiday',
    offerText: 'Kids Special: Buy 2 Get 1 Free on selected styles',
    offerCode: 'Auto-applied at checkout',
    seasonLeft: 'Holiday Picks',
    seasonTitle: 'Kids Festival Offers Up To 60% OFF',
    seasonRight: 'Daily New Deals',
    kicker: 'Holiday Sale',
    title: 'Colorful Deals For Little Stars',
    description:
      'Play-ready clothing, everyday comfort, and festive picks for kids with exciting offers updated every day.',
    ctaPrimaryLabel: 'Shop Kids Sale',
    ctaPrimaryTo: '/products?section=kids',
    ctaSecondaryLabel: 'Browse Kids Categories',
    ctaSecondaryTo: '/products?section=kids',
    discount: 'Up to 60%',
    image:
      'https://images.unsplash.com/photo-1519457431-44ccd64a579b?auto=format&fit=crop&w=1300&q=80',
    imageAlt: 'Kids clothing sale banner image',
  },
]

const categoryCards = [
  {
    title: 'Women',
    subtitle: 'Trending fits',
    section: 'women',
    image:
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80',
  },
  {
    title: 'Men',
    subtitle: 'Everyday staples',
    section: 'men',
    image:
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
  },
  {
    title: 'Kids',
    subtitle: 'Playful comfort',
    section: 'kids',
    image:
      'https://images.unsplash.com/photo-1519457431-44ccd64a579b?auto=format&fit=crop&w=900&q=80',
  },
]

export default function Home() {
  const [activeSaleSlide, setActiveSaleSlide] = useState(0)
  const [catalogProducts, setCatalogProducts] = useState([])
  const [saleSlides, setSaleSlides] = useState(defaultSaleSlides)
  const [globalOffer, setGlobalOffer] = useState(null)
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const [wishlistedIds, setWishlistedIds] = useState(() => {
    const ids = getWishlistItems({ user: getStoredUser() }).map((item) => Number(item.id))
    return new Set(ids)
  })
  const [wishlistMessage, setWishlistMessage] = useState('')
  const touchStartX = useRef(0)

  const budgetPicks = [...catalogProducts]
    .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))
    .slice(0, 4)

  const featuredProducts = catalogProducts.slice(0, 4)

  const goToNextSlide = () => {
    if (!saleSlides.length) {
      return
    }
    setActiveSaleSlide((current) => (current + 1) % saleSlides.length)
  }

  const goToPrevSlide = () => {
    if (!saleSlides.length) {
      return
    }
    setActiveSaleSlide((current) => (current - 1 + saleSlides.length) % saleSlides.length)
  }

  const goToSlide = (index) => {
    setActiveSaleSlide(index)
  }

  useEffect(() => {
    if (!saleSlides.length) {
      return undefined
    }

    const timer = setInterval(() => {
      setActiveSaleSlide((current) => (current + 1) % saleSlides.length)
    }, SALE_SLIDE_INTERVAL)

    return () => {
      clearInterval(timer)
    }
  }, [saleSlides.length])

  useEffect(() => {
    let mounted = true

    const loadCatalog = async () => {
      const data = await fetchCatalogProducts()
      if (!mounted) {
        return
      }
      setCatalogProducts(data)
    }

    loadCatalog()

    return () => {
      mounted = false
    }
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

  useEffect(() => {
    let mounted = true

    const loadHomepageCampaigns = async () => {
      try {
        const [approvedBanners, offer] = await Promise.all([fetchPublicBanners(), fetchPublicGlobalOffer()])
        if (!mounted) {
          return
        }

        if (Array.isArray(approvedBanners) && approvedBanners.length > 0) {
          const normalizedBanners = approvedBanners.map((banner, index) => ({
            id: banner.id || `banner-${index + 1}`,
            offerText: banner.offer_text || offer?.title || 'Platform approved campaign',
            offerCode: offer?.code ? `Use code: ${offer.code}` : 'Limited period offer',
            seasonLeft: 'Platform Banner',
            seasonTitle: banner.title || 'Approved Campaign',
            seasonRight: 'Live Now',
            kicker: 'Verified Banner',
            title: banner.title || 'Campaign',
            description: banner.subtitle || offer?.description || 'Approved promotion now visible on homepage.',
            ctaPrimaryLabel: 'Shop Now',
            ctaPrimaryTo: banner.target_path || '/products',
            ctaSecondaryLabel: 'Explore Products',
            ctaSecondaryTo: '/products',
            discount: offer?.discount_percent ? `${offer.discount_percent}%` : 'Offer',
            image: banner.image_url,
            imageAlt: banner.title || 'Approved banner',
          }))
          setSaleSlides(normalizedBanners)
        }

        setGlobalOffer(offer)
      } catch {
        if (!mounted) {
          return
        }
        setSaleSlides(defaultSaleSlides)
        setGlobalOffer(null)
      }
    }

    loadHomepageCampaigns()

    return () => {
      mounted = false
    }
  }, [])

  const handleTouchStart = (event) => {
    touchStartX.current = event.changedTouches[0]?.clientX || 0
  }

  const handleTouchEnd = (event) => {
    const endX = event.changedTouches[0]?.clientX || 0
    const deltaX = endX - touchStartX.current

    if (Math.abs(deltaX) < 48) {
      return
    }

    if (deltaX < 0) {
      goToNextSlide()
      return
    }

    goToPrevSlide()
  }

  const handleAddToWishlist = (product) => {
    const role = String(currentUser?.role || '').trim().toLowerCase()

    if (!currentUser || role !== 'user') {
      setWishlistMessage('Please login to add products to wishlist.')
      return
    }

    const result = addToWishlist(product, { user: currentUser })

    if (result.added) {
      setWishlistMessage(`${product.name} added to wishlist.`)
      return
    }

    setWishlistMessage(`${product.name} is already in wishlist.`)
  }

  return (
    <PageWrapper className="home-page">
      <AnimatedSection
        as="section"
        className="home-sale-stack section-card"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="home-sale-track"
          style={{ transform: `translateX(-${activeSaleSlide * 100}%)` }}
          aria-live="polite"
        >
          {saleSlides.map((slide) => (
            <article className="home-sale-slide" key={slide.id}>
              <div className="home-sale-offer-strip">
                <p>{slide.offerText}</p>
                <span>{slide.offerCode}</span>
              </div>

              <div className="home-sale-season-strip">
                <p>{slide.seasonLeft}</p>
                <strong>{slide.seasonTitle}</strong>
                <p>{slide.seasonRight}</p>
              </div>

              <div className="home-sale-hero">
                <div className="home-sale-hero-copy">
                  <p className="home-sale-kicker">{slide.kicker}</p>
                  <h1>{slide.title}</h1>
                  <p>{slide.description}</p>
                  <div className="row-gap">
                    <Link to={slide.ctaPrimaryTo} className="btn btn-primary">
                      {slide.ctaPrimaryLabel}
                    </Link>
                    <Link to={slide.ctaSecondaryTo} className="btn btn-secondary">
                      {slide.ctaSecondaryLabel}
                    </Link>
                  </div>
                </div>

                <div className="home-sale-hero-media">
                  <img src={slide.image} alt={slide.imageAlt} />
                  <div className="home-sale-hero-badge">
                    <p>{slide.discount}</p>
                    <span>OFF</span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="home-sale-controls" aria-label="Banner controls">
          <button type="button" className="home-sale-arrow" onClick={goToPrevSlide} aria-label="Previous banner">
            ‹
          </button>
          <div className="home-sale-dots">
            {saleSlides.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                className={`home-sale-dot ${activeSaleSlide === index ? 'home-sale-dot-active' : ''}`}
                onClick={() => goToSlide(index)}
                aria-label={`View banner ${index + 1}`}
              />
            ))}
          </div>
          <button type="button" className="home-sale-arrow" onClick={goToNextSlide} aria-label="Next banner">
            ›
          </button>
        </div>
      </AnimatedSection>

      <AnimatedSection as="section" className="section-card panel-stack" delay={0.04}>
        <div className="section-head">
          <div>
            <p className="eyebrow">Budget picks</p>
            <h2>Budget-Friendly Picks</h2>
          </div>
          <Link to="/products" className="btn btn-link">
            See all deals
          </Link>
        </div>
        {budgetPicks.length > 0 ? (
          <div className="product-grid">
            {budgetPicks.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                index={index}
                onAddToWishlist={handleAddToWishlist}
                isWishlisted={wishlistedIds.has(Number(product.id))}
              />
            ))}
          </div>
        ) : (
          <p className="empty-state">No products are currently available from the merchant catalog.</p>
        )}
      </AnimatedSection>

      <AnimatedSection as="section" className="section-card category-grid" delay={0.06}>
        <div className="section-head">
          <div>
            <p className="eyebrow">Categories</p>
            <h2>Shop by section</h2>
          </div>
          <Link to="/products" className="btn btn-link">
            Browse all
          </Link>
        </div>

        <div className="category-cards">
          {categoryCards.map((category) => (
            <Link
              key={category.title}
              to={`/products?section=${encodeURIComponent(category.section)}`}
              className="category-card category-card-link"
              aria-label={`Browse ${category.title} section`}
            >
              <img src={category.image} alt={category.title} />
              <div>
                <p className="product-category">{category.subtitle}</p>
                <h3>{category.title}</h3>
              </div>
            </Link>
          ))}
        </div>
      </AnimatedSection>

      <AnimatedSection as="section" className="section-card promo-banner" delay={0.08}>
        <div className="section-head">
          <div>
            <p className="eyebrow">Instant savings</p>
            <h2>{globalOffer?.title || '10% instant discount with select cards'}</h2>
          </div>
          <p>{globalOffer?.description || 'Clean, premium, and built for conversion.'}</p>
        </div>
      </AnimatedSection>

      <AnimatedSection as="section" className="section-card panel-stack" delay={0.1}>
        <div className="section-head">
          <div>
            <p className="eyebrow">Featured Edit</p>
            <h2>Best sellers</h2>
          </div>
          <Link to="/products" className="btn btn-link">
            View all
          </Link>
        </div>
        {featuredProducts.length > 0 ? (
          <div className="product-grid">
            {featuredProducts.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                index={index}
                onAddToWishlist={handleAddToWishlist}
                isWishlisted={wishlistedIds.has(Number(product.id))}
              />
            ))}
          </div>
        ) : (
          <p className="empty-state">No featured products yet. Add products from the admin merchant panel.</p>
        )}
      </AnimatedSection>

      {wishlistMessage ? <p className="wishlist-message">{wishlistMessage}</p> : null}
    </PageWrapper>
  )
}
