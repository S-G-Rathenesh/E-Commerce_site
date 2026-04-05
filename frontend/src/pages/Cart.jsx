import { Link } from 'react-router-dom'
import { products } from '../data/products'
import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'

const cartItems = [
  { ...products[0], quantity: 1 },
  { ...products[1], quantity: 1 },
]

export default function Cart() {
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const tax = subtotal * 0.08
  const total = subtotal + tax

  return (
    <PageWrapper
      eyebrow="Basket"
      title="Your shopping cart"
      description="Review the selected items and continue to a streamlined checkout flow."
    >
      <div className="cart-layout">
        <div className="panel panel-stack">
          {cartItems.map((item) => (
            <div key={item.id} className="cart-row">
              <img src={item.image} alt={item.name} />
              <div>
                <h3>{item.name}</h3>
                <p>{item.category}</p>
              </div>
              <p>x{item.quantity}</p>
              <p className="detail-price">${item.price.toFixed(2)}</p>
            </div>
          ))}
        </div>

        <aside className="panel panel-stack">
          <h2>Order summary</h2>
          <div className="summary-row">
            <p>Subtotal: ${subtotal.toFixed(2)}</p>
            <p>Tax: ${tax.toFixed(2)}</p>
            <p>Total: ${total.toFixed(2)}</p>
          </div>
          <Button to="/checkout" variant="primary" className="btn-wide">
            Proceed to Checkout
          </Button>
          <Link to="/products" className="btn btn-link">
            Continue shopping
          </Link>
        </aside>
      </div>
    </PageWrapper>
  )
}
