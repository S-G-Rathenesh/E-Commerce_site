import { Link } from 'react-router-dom'
import Button from './Button'

function renderStars(rating) {
  const fullStars = Math.max(1, Math.min(5, Math.round(Number(rating || 0))))
  return `${'★'.repeat(fullStars)}${'☆'.repeat(5 - fullStars)}`
}

export default function DiscoveryProductCard({
  product,
  wishlisted = false,
  onAddToCart,
  onToggleWishlist,
  primaryActionLabel = 'Add to Cart',
  secondaryActionLabel = 'View Product',
}) {
  const title = String(product?.title || product?.name || 'Product')
  const price = Number(product?.price || 0)
  const discount = Number(product?.discount_percent || 0)
  const rating = Number(product?.rating || 0)
  const image = String(product?.image || '')
  const category = String(product?.category || '')
  const badge = String(product?.delivery_badge || 'Free Delivery')

  return (
    <article className="discovery-card">
      <div className="discovery-card-media">
        <span className="discovery-card-badge">{product?.badge || 'New'}</span>
        <span className="discovery-card-discount">{discount ? `${discount}% OFF` : 'Deal'}</span>
        <button
          type="button"
          className={`discovery-card-wishlist ${wishlisted ? 'discovery-card-wishlist-active' : ''}`}
          onClick={() => onToggleWishlist?.(product)}
          aria-label={wishlisted ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`}
        >
          {wishlisted ? '♥' : '♡'}
        </button>
        <Link to={`/product/${product?.id}`} className="discovery-card-image-link" aria-label={`View product ${title}`}>
          <img src={image} alt={title} className="discovery-card-image" loading="lazy" />
        </Link>
      </div>

      <div className="discovery-card-content">
        <p className="discovery-card-category">{category}</p>
        <h3>{title}</h3>
        <div className="discovery-card-rating" aria-label={`Rating ${rating} out of 5`}>
          <span className="discovery-card-stars">{renderStars(rating)}</span>
          <span>{rating ? rating.toFixed(1) : '0.0'}</span>
        </div>
        <div className="discovery-card-price-row">
          <span className="discovery-card-price">Rs. {price.toFixed(2)}</span>
          <span className="discovery-card-delivery">{badge}</span>
        </div>
        <div className="discovery-card-actions">
          <Button to={`/product/${product?.id}`} variant="secondary">
            {secondaryActionLabel}
          </Button>
          <Button variant="primary" onClick={() => onAddToCart?.(product)}>
            {primaryActionLabel}
          </Button>
        </div>
      </div>
    </article>
  )
}
