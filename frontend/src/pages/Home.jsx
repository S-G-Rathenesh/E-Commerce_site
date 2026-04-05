import { Link } from 'react-router-dom'
import { products } from '../data/products'
import ProductCard from '../components/ProductCard'
import Button from '../components/Button'
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

export default function Home() {
  return (
    <PageWrapper
      eyebrow="Flat 300 OFF"
      title="Fashion-led shopping with a premium retail feel"
      description="A storefront inspired by modern fashion marketplaces: strong hero promotions, category discovery, polished cards, and a unified browsing rhythm."
      actions={
        <>
          <Button to="/products" variant="primary">
            Shop Collection
          </Button>
          <Button to="/admin" variant="secondary">
            Open Admin
          </Button>
        </>
      }
    >
      <section className="promo-strip section-card">
        <span>On your 1st purchase via app</span>
        <strong>Use code STYLE300</strong>
        <span>Limited time offer</span>
      </section>

      <section className="hero-banner section-card">
        <div>
          <p className="eyebrow">Fashion carnival</p>
          <h2>Sun’s out. Deals are in.</h2>
          <p className="hero-copy">
            Discover an elevated shopping experience built around seasonal fashion, bold promotions, and a clean marketplace layout.
          </p>
          <div className="row-gap">
            <Button to="/products" variant="primary">
              Shop Collection
            </Button>
            <Button to="/login" variant="secondary">
              Sign In
            </Button>
          </div>
          <div className="hero-metrics">
            <div>
              <strong>1.2k+</strong>
              <span>New arrivals</span>
            </div>
            <div>
              <strong>300+</strong>
              <span>Premium brands</span>
            </div>
            <div>
              <strong>24h</strong>
              <span>Express dispatch</span>
            </div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-deal-card">
            <p>50-80% OFF</p>
            <span>Shop by style and season</span>
          </div>
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
