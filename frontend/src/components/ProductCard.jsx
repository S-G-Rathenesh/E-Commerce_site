import Button from './Button'

export default function ProductCard({ product }) {
  return (
    <article className="product-card">
      <div className="product-image-wrap">
        <img src={product.image} alt={product.name} className="product-image" />
        <span className="product-badge">New</span>
      </div>
      <div className="product-content">
        <p className="product-category">{product.category}</p>
        <h3>{product.name}</h3>
        <p>{product.description}</p>
        <p className="product-price">${product.price.toFixed(2)}</p>
        <Button to={`/product/${product.id}`} variant="secondary">
          View Details
        </Button>
      </div>
    </article>
  )
}
