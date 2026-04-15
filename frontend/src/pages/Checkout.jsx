import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders, getStoredUser } from '../utils/auth'
import { clearCart, getCartItems } from '../utils/cart'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export default function Checkout() {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [address, setAddress] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('COD')
  const [message, setMessage] = useState('')
  const [placing, setPlacing] = useState(false)
  const navigate = useNavigate()

  const currentUser = getStoredUser()
  const cartItems = getCartItems(currentUser)
  const subtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0),
    [cartItems],
  )
  const discount = subtotal > 500 ? 45 : 0
  const total = Math.max(0, subtotal - discount)

  const handlePlaceOrder = async () => {
    if (!cartItems.length) {
      setMessage('Your cart is empty. Add products before placing an order.')
      return
    }
    if (!postalCode || String(postalCode).trim().length < 6) {
      setMessage('Enter a valid pincode to place the order.')
      return
    }

    setPlacing(true)
    setMessage('')

    try {
      const response = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          pincode: String(postalCode).replace(/\D/g, '').slice(0, 6),
          payment_method: paymentMethod,
          items: cartItems.map((item) => ({
            product_id: Number(item.id),
            quantity: Number(item.quantity || 1),
          })),
          shipping_details: {
            full_name: fullName,
            phone,
            city,
            address,
          },
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to place order right now.')
        return
      }

      clearCart({ user: currentUser })
      setMessage(data?.message || 'Order placed successfully.')
      navigate('/orders/tracking')
    } catch {
      setMessage('Unable to place order right now.')
    } finally {
      setPlacing(false)
    }
  }

  return (
    <PageWrapper
      eyebrow="Checkout"
      title="Secure checkout"
      description="A centered, consistent checkout experience with structured sections and one primary action style."
    >
      <div className="checkout-grid">
        <section className="panel panel-stack">
          <h2>Shipping details</h2>
          <div className="form-grid">
            <Input label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Julianne Moore" />
            <Input label="Phone number" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 (555) 000-0000" />
            <Input label="City" value={city} onChange={(event) => setCity(event.target.value)} placeholder="New York" />
            <Input label="Postal code" value={postalCode} onChange={(event) => setPostalCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="560001" />
            <label className="field-group">
              <span className="field-label">Payment Method</span>
              <select className="field" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                <option value="COD">Cash on Delivery</option>
                <option value="ONLINE">Online Payment</option>
              </select>
            </label>
            <Input label="Street address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Apartment, suite, unit, etc." multiline rows={4} />
          </div>
        </section>
        <aside className="panel panel-stack">
          <h2>Order summary</h2>
          <div className="summary-row">
            <p>Subtotal: Rs. {subtotal.toFixed(2)}</p>
            <p>Discount: -Rs. {discount.toFixed(2)}</p>
            <p>Shipping: Free</p>
            <p className="detail-price">Total: Rs. {total.toFixed(2)}</p>
          </div>
          <Button variant="primary" className="btn-wide" onClick={handlePlaceOrder} disabled={placing}>
            {placing ? 'Placing Order...' : 'Complete Order'}
          </Button>
          {message ? <p className="wishlist-message">{message}</p> : null}
        </aside>
      </div>
    </PageWrapper>
  )
}
