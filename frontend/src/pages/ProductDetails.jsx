import { Link, useParams } from 'react-router-dom'
import { findProductById } from '../data/products'
import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'

export default function ProductDetails() {
  const { id } = useParams()
  const product = findProductById(id)

  if (!product) {
    return (
      <PageWrapper title="Product not found" description="The requested item could not be loaded.">
        <Button to="/products" variant="primary">
          Back to products
        </Button>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper
      eyebrow={product.category}
      title={product.name}
      description={product.description}
      actions={<p className="detail-price">${product.price.toFixed(2)}</p>}
    >
      <div className="product-detail">
        <img src={product.image} alt={product.name} className="detail-image" />
        <div className="panel panel-stack detail-panel">
          <div className="summary-row">
            <p className="meta-label">Product details</p>
            <p>Designed for a modern wardrobe with premium finishes and a clean silhouette.</p>
            <p>Consistent spacing, a unified button system, and a card-first structure keep the experience cohesive.</p>
          </div>
          <div className="row-gap">
            <Button variant="primary">Add to Cart</Button>
            <Button to="/cart" variant="secondary">
              Go to Cart
            </Button>
          </div>
          <Link to="/products" className="btn btn-link">
            Back to products
          </Link>
        </div>
      </div>
    </PageWrapper>
  )
}
