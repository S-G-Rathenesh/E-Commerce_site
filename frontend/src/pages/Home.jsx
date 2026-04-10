import { Link } from 'react-router-dom'
import { products } from '../data/products'
import ProductCard from '../components/ProductCard'
import PageWrapper from '../components/PageWrapper'

const categoryCards = [
  {
    title: 'Women',
    subtitle: 'Trending fits',
    image:
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80',
  },
  {
    title: 'Men',
    subtitle: 'Everyday staples',
    image:
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
  },
  {
    title: 'Kids',
    subtitle: 'Playful comfort',
    image:
      'https://images.unsplash.com/photo-1519457431-44ccd64a579b?auto=format&fit=crop&w=900&q=80',
  },
]

const budgetPicks = [...products]
  .sort((a, b) => a.price - b.price)
  .slice(0, 4)

export default function Home() {
  return (
    <PageWrapper className="home-page">
      <section className="section-card panel-stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">Budget picks</p>
            <h2>Budget-Friendly Picks</h2>
          </div>
          <Link to="/products" className="btn btn-link">
            See all deals
          </Link>
        </div>
        <div className="product-grid">
          {budgetPicks.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      <section className="section-card category-grid">
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
            <article key={category.title} className="category-card">
              <img src={category.image} alt={category.title} />
              <div>
                <p className="product-category">{category.subtitle}</p>
                <h3>{category.title}</h3>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section-card promo-banner">
        <div className="section-head">
          <div>
            <p className="eyebrow">Instant savings</p>
            <h2>10% instant discount with select cards</h2>
          </div>
          <p>Clean, premium, and built for conversion.</p>
        </div>
      </section>

      <section className="section-card panel-stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">Featured Edit</p>
            <h2>Best sellers</h2>
          </div>
          <Link to="/products" className="btn btn-link">
            View all
          </Link>
        </div>
        <div className="product-grid">
          {products.slice(0, 4).map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </PageWrapper>
  )
}
