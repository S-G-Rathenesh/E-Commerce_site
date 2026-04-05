import { useNavigate } from 'react-router-dom'
import Button from './Button'

export default function ProductCard({ product }) {
  const navigate = useNavigate()

  const openProduct = () => {
    navigate(`/product/${product.id}`)
  }

  return (
    <article
      className="product-card product-card-clickable"
      role="button"
      tabIndex={0}
      onClick={openProduct}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openProduct()
        }
      }}
    >
      <div className="product-image-wrap">
        <img src={product.image} alt={product.name} className="product-image" />
        <span className="product-badge">New</span>
      </div>
      <div className="product-content">
        <p className="product-category">{product.category}</p>
        <h3>{product.name}</h3>
        <p>{product.description}</p>
        <p className="product-price">${product.price.toFixed(2)}</p>
        <Button
          variant="secondary"
          onClick={(event) => {
            event.stopPropagation()
            openProduct()
          }}
        >
          View Details
        </Button>
      </div>
    </article>
  )
}
