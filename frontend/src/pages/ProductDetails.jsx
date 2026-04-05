import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { findProductById } from '../data/products'
import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const sizeOptions = ['S', 'M', 'L', 'XL']

const galleryById = {
  1: [
    'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1592878904946-b3cd3b7d20fd?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1617137968427-85924c800a22?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1527719327859-c6ce80353573?auto=format&fit=crop&w=900&q=80',
  ],
  2: [
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=900&q=80',
  ],
  3: [
    'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1604176354204-9268737828e4?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=80',
  ],
}

const reviews = [
  {
    id: 'review-1',
    name: 'Julian S.',
    tag: 'Verified Buyer',
    age: '2 days ago',
    rating: 5,
    text: 'The texture is even better in person. It has a substantial weight to it that makes it feel much more expensive than it is. Perfect for transitional weather.',
  },
  {
    id: 'review-2',
    name: 'Amara M.',
    tag: 'Verified Buyer',
    age: '1 week ago',
    rating: 5,
    text: 'Fit is slightly oversized as described. The medium sits right for a modern look. I can style it with denim or tailored pants and it works every time.',
  },
]

export default function ProductDetails() {
  const { id } = useParams()
  const localProduct = findProductById(id)
  const [product, setProduct] = useState(localProduct)
  const [selectedSize, setSelectedSize] = useState('M')
  const [quantity, setQuantity] = useState(1)
  const [activeImageIndex, setActiveImageIndex] = useState(0)

  useEffect(() => {
    let active = true

    fetch(`${API_BASE}/product/${id}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!active || !data || data.error) {
          return
        }
        setProduct(data)
      })
      .catch(() => {
        if (active) {
          setProduct((current) => current || localProduct)
        }
      })

    return () => {
      active = false
    }
  }, [id, localProduct])

  useEffect(() => {
    setActiveImageIndex(0)
    setQuantity(1)
    setSelectedSize('M')
  }, [id])

  if (!product) {
    return (
      <PageWrapper title="Product not found" description="The requested item could not be loaded.">
        <Button to="/products" variant="primary">
          Back to products
        </Button>
      </PageWrapper>
    )
  }

  const imageSet = useMemo(() => {
    const curatedSet = galleryById[product.id]
    if (Array.isArray(curatedSet) && curatedSet.length > 0) {
      return curatedSet
    }
    return [product.image, product.image, product.image]
  }, [product])

  const activeImage = imageSet[activeImageIndex] || product.image
  const renderedStars = '★★★★★'

  return (
    <PageWrapper className="product-detail-page">
      <nav className="detail-breadcrumb" aria-label="Breadcrumb">
        <Link to="/products">Shop</Link>
        <span>›</span>
        <Link to={`/products?category=${encodeURIComponent(product.category)}`}>{product.category}</Link>
        <span>›</span>
        <strong>{product.name}</strong>
      </nav>

      <section className="detail-showcase">
        <div className="detail-gallery">
          <img src={activeImage} alt={product.name} className="detail-main-image" />
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
          <h1>{product.name}</h1>
          <p className="detail-price">${Number(product.price).toFixed(2)}</p>
          <p className="detail-copy">{product.description}</p>

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
            <Button variant="primary" className="btn-wide detail-add-btn">
              Add to Cart
            </Button>
          </div>

          <div className="detail-feature-row">
            <p>🚚 Free Express Shipping</p>
            <p>🌿 Sustainable Materials</p>
          </div>
        </article>
      </section>

      <section className="detail-reviews">
        <div className="detail-reviews-head">
          <div>
            <h2>Client Reviews</h2>
            <p>
              <span>{renderedStars}</span> 4.8 out of 5 (128 reviews)
            </p>
          </div>
          <button type="button" className="btn btn-secondary">
            Write a Review
          </button>
        </div>

        <div className="detail-review-grid">
          {reviews.map((review) => (
            <article key={review.id} className="detail-review-card">
              <div className="detail-review-meta">
                <div className="detail-review-avatar">{review.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <h3>{review.name}</h3>
                  <p>
                    {review.tag} • {review.age}
                  </p>
                </div>
                <strong>{'★'.repeat(review.rating)}</strong>
              </div>
              <p>{review.text}</p>
            </article>
          ))}
        </div>

        <div className="detail-review-foot">
          <Link to="/products" className="btn btn-link">
            Continue Shopping
          </Link>
        </div>
      </section>
    </PageWrapper>
  )
}
