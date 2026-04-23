import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Button from './Button'

export default function ProductCard({ product, onAddToWishlist, isWishlisted = false, index = 0 }) {
  const MotionArticle = motion.article
  const navigate = useNavigate()

  const openProduct = () => {
    navigate(`/product/${product.id}`)
  }

  return (
    <MotionArticle
      className="product-card"
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.34, delay: Math.min(index * 0.05, 0.35), ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.03, y: -4 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="product-image-wrap">
        <button
          type="button"
          className="product-image-button"
          onClick={openProduct}
          aria-label={`View details for ${product.name}`}
        >
          <img src={product.image} alt={product.name} className="product-image" />
        </button>
        <span className="product-badge">New</span>
      </div>
      <div className="product-content">
        <p className="product-category">{product.category}</p>
        <h3>{product.name}</h3>
        <p>
          {(product.productType || product.category) +
            (product.subType ? ` • ${product.subType}` : '')}
        </p>
        <p>{product.description}</p>
        <p className="product-price">Rs. {product.price.toFixed(2)}</p>
        <div className="product-card-actions">
          <Button
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation()
              openProduct()
            }}
          >
            View Details
          </Button>
          <Button
            variant={isWishlisted ? 'primary' : 'secondary'}
            onClick={(event) => {
              event.stopPropagation()
              onAddToWishlist?.(product)
            }}
          >
            {isWishlisted ? 'Wishlisted' : 'Add to Wishlist'}
          </Button>
        </div>
      </div>
    </MotionArticle>
  )
}
