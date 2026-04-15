import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'
import { clearCart, getCartItems, removeFromCart, updateCartQuantity } from '../utils/cart'
import { getStoredUser } from '../utils/auth'

export default function Cart() {
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const [cartItems, setCartItems] = useState(() => getCartItems(getStoredUser()))
  const [message, setMessage] = useState('')

  useEffect(() => {
    const syncCart = () => {
      const user = getStoredUser()
      setCurrentUser(user)
      setCartItems(getCartItems(user))
    }

    window.addEventListener('cart-changed', syncCart)
    window.addEventListener('auth-changed', syncCart)
    window.addEventListener('storage', syncCart)

    return () => {
      window.removeEventListener('cart-changed', syncCart)
      window.removeEventListener('auth-changed', syncCart)
      window.removeEventListener('storage', syncCart)
    }
  }, [])

  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const tax = subtotal * 0.08
  const total = subtotal + tax

  const totalItems = useMemo(
    () => cartItems.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0),
    [cartItems],
  )

  const updateQuantity = (item, delta) => {
    const next = Math.max(1, Math.min(20, Number(item.quantity || 1) + delta))
    updateCartQuantity(item.id, next, { size: item.size, user: currentUser })
  }

  const removeItem = (item) => {
    removeFromCart(item.id, { size: item.size, user: currentUser })
    setMessage(`${item.name} removed from bag.`)
  }

  const clearAll = () => {
    clearCart({ user: currentUser })
    setMessage('Bag cleared.')
  }

  return (
    <PageWrapper
      eyebrow="Basket"
      title="Your shopping cart"
      description="Review the selected items and continue to a streamlined checkout flow."
      actions={
        <div className="row-gap">
          <p>{totalItems} items</p>
          <Button variant="secondary" onClick={clearAll}>
            Clear bag
          </Button>
        </div>
      }
    >
      <div className="cart-layout">
        <div className="panel panel-stack">
          {message ? <p className="wishlist-message">{message}</p> : null}
          {cartItems.length > 0 ? (
            cartItems.map((item) => (
              <div key={`${item.id}-${item.size}`} className="cart-row">
                <img src={item.image} alt={item.name} />
                <div>
                  <h3>{item.name}</h3>
                  <p>
                    {item.category}
                    {item.size ? ` • Size ${item.size}` : ''}
                  </p>
                  <button type="button" className="btn btn-link" onClick={() => removeItem(item)}>
                    Remove
                  </button>
                </div>
                <div className="detail-qty" aria-label="Quantity controls">
                  <button type="button" onClick={() => updateQuantity(item, -1)} aria-label="Decrease quantity">
                    −
                  </button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => updateQuantity(item, 1)} aria-label="Increase quantity">
                    +
                  </button>
                </div>
                <p className="detail-price">Rs. {item.price.toFixed(2)}</p>
              </div>
            ))
          ) : (
            <section className="section-card panel-stack">
              <h3>Your bag is empty</h3>
              <p>Add products to continue checkout.</p>
              <div className="row-gap">
                <Button to="/products" variant="primary">
                  Shop now
                </Button>
                <Button to="/wishlist" variant="secondary">
                  Open wishlist
                </Button>
              </div>
            </section>
          )}
        </div>

        <aside className="panel panel-stack">
          <h2>Order summary</h2>
          <div className="summary-row">
            <p>Subtotal: Rs. {subtotal.toFixed(2)}</p>
            <p>Tax: Rs. {tax.toFixed(2)}</p>
            <p>Total: Rs. {total.toFixed(2)}</p>
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
