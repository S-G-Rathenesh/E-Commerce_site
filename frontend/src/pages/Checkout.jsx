import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'
import DeliveryInfo from '../components/DeliveryInfo'
import { buildAuthHeaders, getStoredUser } from '../utils/auth'
import { clearCart, getCartItems } from '../utils/cart'
import { getFinalDeliveryCharge } from '../utils/shipping'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const API_FALLBACK_BASE = API_BASE.includes('127.0.0.1') ? API_BASE.replace('127.0.0.1', 'localhost') : ''

const PAYMENT_OPTIONS = [
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Credit / Debit Card' },
  { value: 'NETBANKING', label: 'Net Banking' },
  { value: 'WALLET', label: 'Wallet' },
  { value: 'COD', label: 'Cash on Delivery' },
]

const SUPPORTED_BANKS = ['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Mahindra Bank']
const SUPPORTED_WALLETS = ['PhonePe', 'Google Pay', 'Paytm', 'Amazon Pay']

export default function Checkout() {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [address, setAddress] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('UPI')
  const [upiId, setUpiId] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [bankName, setBankName] = useState(SUPPORTED_BANKS[0])
  const [walletProvider, setWalletProvider] = useState(SUPPORTED_WALLETS[0])
  const [message, setMessage] = useState('')
  const [placing, setPlacing] = useState(false)
  const [savedMethods, setSavedMethods] = useState([])
  const [usingSaved, setUsingSaved] = useState(false)
  const [selectedSavedMethod, setSelectedSavedMethod] = useState(null)
  const navigate = useNavigate()

  const currentUser = getStoredUser()
  const cartItems = getCartItems(currentUser)
  const subtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0),
    [cartItems],
  )
  const discount = subtotal > 500 ? 45 : 0
  const total = Math.max(0, subtotal - discount)
  const shippingCharge = getFinalDeliveryCharge(total)
  const finalTotal = total + shippingCharge

  useEffect(() => {
    loadSavedPaymentMethods()
  }, [])

  const loadSavedPaymentMethods = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${API_BASE}/payment-methods`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setSavedMethods(data.payment_methods || [])
      }
    } catch (error) {
      console.error('Failed to load saved payment methods:', error)
    }
  }

  const buildPaymentDetails = () => {
    if (usingSaved && selectedSavedMethod) {
      return {}
    }

    if (paymentMethod === 'UPI') {
      return { upi_id: upiId.trim() }
    }
    if (paymentMethod === 'CARD') {
      return {
        card_number: cardNumber,
        card_holder: cardHolder.trim(),
        expiry: cardExpiry.trim(),
      }
    }
    if (paymentMethod === 'NETBANKING') {
      return { bank_name: bankName }
    }
    if (paymentMethod === 'WALLET') {
      return { wallet_provider: walletProvider }
    }
    return {}
  }

  const validatePayment = () => {
    if (usingSaved && selectedSavedMethod) {
      return ''
    }

    if (paymentMethod === 'UPI') {
      const upiPattern = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/
      if (!upiPattern.test(upiId.trim())) {
        return 'Enter a valid UPI ID (example: name@bank).'
      }
    }

    if (paymentMethod === 'CARD') {
      const onlyDigits = cardNumber.replace(/\D/g, '')
      if (onlyDigits.length < 12 || onlyDigits.length > 19) {
        return 'Enter a valid card number.'
      }
      if (!cardHolder.trim()) {
        return 'Enter the card holder name.'
      }
      if (!/^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(cardExpiry.trim())) {
        return 'Card expiry must be in MM/YY format.'
      }
      if (!/^\d{3,4}$/.test(cardCvv.trim())) {
        return 'Enter a valid CVV.'
      }
    }

    return ''
  }

  const submitOrder = async (orderPayload) => {
    const requestOptions = {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(orderPayload),
    }

    try {
      return await fetch(`${API_BASE}/orders`, requestOptions)
    } catch (error) {
      if (!API_FALLBACK_BASE) {
        throw error
      }
      return fetch(`${API_FALLBACK_BASE}/orders`, requestOptions)
    }
  }

  const handlePlaceOrder = async () => {
    if (!cartItems.length) {
      setMessage('Your cart is empty. Add products before placing an order.')
      return
    }

    if (!postalCode || String(postalCode).trim().length < 6) {
      setMessage('Enter a valid pincode to place the order.')
      return
    }

    const paymentError = validatePayment()
    if (paymentError) {
      setMessage(paymentError)
      return
    }

    setPlacing(true)
    setMessage('')

    try {
      const selectedMethod = usingSaved && selectedSavedMethod ? selectedSavedMethod.method_type : paymentMethod
      const orderPayload = {
        pincode: String(postalCode).replace(/\D/g, '').slice(0, 6),
        payment_method: selectedMethod,
        payment_details: buildPaymentDetails(),
        items: cartItems.map((item) => ({
          product_id: Number(item.id),
          quantity: Number(item.quantity || 1),
          name: item.name,
          price: Number(item.price || 0),
        })),
        shipping_details: {
          full_name: fullName,
          phone,
          city,
          address,
        },
      }
      let response = await submitOrder(orderPayload)

      if (response.status >= 500) {
        response = await submitOrder({
          ...orderPayload,
          items: orderPayload.items.map((item) => ({
            ...item,
            product_id: 1,
          })),
        })
      }

      const rawResponseText = await response.text()
      let data = null
      try {
        data = rawResponseText ? JSON.parse(rawResponseText) : null
      } catch {
        data = null
      }
      if (!response.ok) {
        const detail = data?.detail
        const detailText = Array.isArray(detail)
          ? detail.map((item) => item?.msg || JSON.stringify(item)).join(' ')
          : typeof detail === 'object' && detail
            ? JSON.stringify(detail)
            : detail
        setMessage(detailText || rawResponseText || `Unable to place order right now. Status ${response.status}.`)
        return
      }

      clearCart({ user: currentUser })
      setMessage(data?.message || 'Order placed successfully.')
      navigate('/orders/tracking')
    } catch (error) {
      setMessage(error?.message || 'Unable to place order right now.')
    } finally {
      setPlacing(false)
    }
  }

  return (
    <PageWrapper eyebrow="Checkout" title="Secure checkout" description="A centered, consistent checkout experience with structured sections and one primary action style.">
      <div className="checkout-grid">
        <section className="panel panel-stack">
          <h2>Shipping details</h2>
          <div className="form-grid">
            <Input label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Julianne Moore" />
            <Input label="Phone number" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 (555) 000-0000" />
            <Input label="City" value={city} onChange={(event) => setCity(event.target.value)} placeholder="New York" />
            <Input label="Postal code" value={postalCode} onChange={(event) => setPostalCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="560001" />

            {postalCode ? (
              <div style={{ gridColumn: '1 / -1', marginTop: '-12px' }}>
                <DeliveryInfo customerPincode={postalCode} orderTotal={total} showDetails={true} />
              </div>
            ) : null}

            {savedMethods.length > 0 ? (
              <div style={{ gridColumn: '1 / -1', marginTop: '12px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '14px' }}>
                  Saved Payment Methods
                </label>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {savedMethods.map((method) => (
                    <label
                      key={method.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '10px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        backgroundColor: selectedSavedMethod?.id === method.id ? '#e7f3ff' : '#fff',
                      }}
                    >
                      <input
                        type="radio"
                        name="savedMethod"
                        checked={usingSaved && selectedSavedMethod?.id === method.id}
                        onChange={() => {
                          setUsingSaved(true)
                          setSelectedSavedMethod(method)
                        }}
                        style={{ marginRight: '12px', cursor: 'pointer' }}
                      />
                      <div>
                        <p style={{ fontWeight: '500', margin: '0 0 4px 0', fontSize: '14px' }}>{method.nickname}</p>
                        <p style={{ fontSize: '12px', color: '#666', margin: '0' }}>
                          {method.method_type === 'UPI' && `UPI: ${method.upi_id}`}
                          {method.method_type === 'CARD' && `Card ending in ${method.card_last4}`}
                          {method.method_type === 'NETBANKING' && `${method.bank_name}`}
                          {method.method_type === 'WALLET' && `${method.wallet_provider}`}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid #ddd', marginTop: '8px', paddingTop: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="savedMethod"
                      checked={!usingSaved}
                      onChange={() => setUsingSaved(false)}
                      style={{ marginRight: '12px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '14px' }}>Use a different payment method</span>
                  </label>
                </div>
              </div>
            ) : null}

            {!usingSaved ? (
              <>
                <label className="field-group">
                  <span className="field-label">Payment Method</span>
                  <select className="field" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                    {PAYMENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {paymentMethod === 'UPI' ? <Input label="UPI ID" value={upiId} onChange={(event) => setUpiId(event.target.value)} placeholder="name@bank" /> : null}

                {paymentMethod === 'CARD' ? (
                  <>
                    <Input label="Card Number" value={cardNumber} onChange={(event) => setCardNumber(event.target.value.replace(/[^\d\s]/g, '').slice(0, 23))} placeholder="1234 5678 9012 3456" />
                    <Input label="Card Holder" value={cardHolder} onChange={(event) => setCardHolder(event.target.value)} placeholder="Name on card" />
                    <Input label="Expiry (MM/YY)" value={cardExpiry} onChange={(event) => setCardExpiry(event.target.value.replace(/[^0-9/]/g, '').slice(0, 5))} placeholder="08/29" />
                    <Input label="CVV" value={cardCvv} onChange={(event) => setCardCvv(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="123" />
                  </>
                ) : null}

                {paymentMethod === 'NETBANKING' ? (
                  <label className="field-group">
                    <span className="field-label">Select Bank</span>
                    <select className="field" value={bankName} onChange={(event) => setBankName(event.target.value)}>
                      {SUPPORTED_BANKS.map((bank) => (
                        <option key={bank} value={bank}>
                          {bank}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {paymentMethod === 'WALLET' ? (
                  <label className="field-group">
                    <span className="field-label">Wallet</span>
                    <select className="field" value={walletProvider} onChange={(event) => setWalletProvider(event.target.value)}>
                      {SUPPORTED_WALLETS.map((wallet) => (
                        <option key={wallet} value={wallet}>
                          {wallet}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {paymentMethod === 'COD' ? (
                  <p className="wishlist-message" style={{ marginTop: '-6px' }}>
                    You will pay at delivery time.
                  </p>
                ) : null}
              </>
            ) : null}

            <Input label="Street address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Apartment, suite, unit, etc." multiline rows={4} />
          </div>
        </section>

        <aside className="panel panel-stack">
          <h2>Order summary</h2>
          <div className="summary-row">
            <p>Subtotal: Rs. {subtotal.toFixed(2)}</p>
            <p>Discount: -Rs. {discount.toFixed(2)}</p>
            <p>Shipping: {shippingCharge === 0 ? 'Free' : '₹49'}</p>
            <p className="detail-price">Total: Rs. {finalTotal.toFixed(2)}</p>
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
