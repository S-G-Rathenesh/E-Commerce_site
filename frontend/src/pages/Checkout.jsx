import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'
import DeliveryInfo from '../components/DeliveryInfo'
import { buildAuthHeaders, getStoredUser } from '../utils/auth'
import { clearCart, getCartItems } from '../utils/cart'
import { getFinalDeliveryCharge } from '../utils/shipping'
import { getSavedDefaultAddress } from '../utils/profileAddress'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const API_FALLBACK_BASE = API_BASE.includes('127.0.0.1') ? API_BASE.replace('127.0.0.1', 'localhost') : ''
const API_CANDIDATES = Array.from(
  new Set(
    [
      API_BASE,
      API_FALLBACK_BASE,
      'http://127.0.0.1:8000',
      'http://localhost:8000',
    ].filter(Boolean),
  ),
)

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
  const [savedDefaultAddress, setSavedDefaultAddress] = useState(null)
  const [addressSource, setAddressSource] = useState('current')
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
  const isUsingDefaultAddress = Boolean(savedDefaultAddress) && addressSource === 'default'

  useEffect(() => {
    loadSavedPaymentMethods()
    const existingAddress = getSavedDefaultAddress(currentUser)
    if (existingAddress) {
      setSavedDefaultAddress(existingAddress)
      setAddressSource('default')
      setFullName(existingAddress.fullName)
      setPhone(existingAddress.phone)
      setCity(existingAddress.city)
      setPostalCode(existingAddress.postalCode)
      setAddress(existingAddress.addressLine)
    }
  }, [])

  const useCurrentOrderAddress = () => {
    setAddressSource('current')
    setFullName('')
    setPhone('')
    setCity('')
    setPostalCode('')
    setAddress('')
  }

  const useSavedDefaultAddress = () => {
    if (!savedDefaultAddress) {
      return
    }
    setAddressSource('default')
    setFullName(savedDefaultAddress.fullName)
    setPhone(savedDefaultAddress.phone)
    setCity(savedDefaultAddress.city)
    setPostalCode(savedDefaultAddress.postalCode)
    setAddress(savedDefaultAddress.addressLine)
  }

  const loadSavedPaymentMethods = async () => {
    const token = localStorage.getItem('auth_token')
    const requestInit = {
      headers: { Authorization: `Bearer ${token}` },
    }

    for (const baseUrl of API_CANDIDATES) {
      try {
        const response = await fetch(`${baseUrl}/payment-methods`, requestInit)
        if (response.ok) {
          const data = await response.json()
          setSavedMethods(data.payment_methods || [])
          return
        }
        if (response.status < 500) {
          setSavedMethods([])
          return
        }
      } catch (error) {
        if (baseUrl === API_CANDIDATES[API_CANDIDATES.length - 1]) {
          console.error('Failed to load saved payment methods:', error)
        }
      }
    }

    setSavedMethods([])
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

    let lastError = null
    for (const baseUrl of API_CANDIDATES) {
      try {
        return await fetch(`${baseUrl}/orders`, requestOptions)
      } catch (error) {
        lastError = error
      }
    }

    throw lastError || new Error('Unable to reach the order service.')
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

    if (!String(fullName || '').trim() || !String(city || '').trim() || !String(address || '').trim()) {
      setMessage('Please complete shipping details before placing the order.')
      return
    }

    if (String(phone || '').replace(/\D/g, '').length < 10) {
      setMessage('Please enter a valid phone number for shipping.')
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
    <PageWrapper className="page-customer page-checkout" eyebrow="Checkout" title="Secure checkout" description="A centered, consistent checkout experience with structured sections and one primary action style.">
      <div className="checkout-grid">
        <section className="panel panel-stack checkout-form-card">
          <h2>Shipping details</h2>
          <div className="form-grid">
            {savedDefaultAddress ? (
              <div className="checkout-address-source">
                <p className="checkout-section-label">Address preference</p>
                <div className="checkout-saved-method-list">
                  <label className={`checkout-saved-method ${addressSource === 'default' ? 'checkout-saved-method-active' : ''}`}>
                    <input
                      type="radio"
                      name="addressSource"
                      checked={addressSource === 'default'}
                      onChange={useSavedDefaultAddress}
                      className="checkout-saved-method-radio"
                    />
                    <div className="checkout-saved-method-details">
                      <p>Use default saved address</p>
                      <p>{`${savedDefaultAddress.fullName}, ${savedDefaultAddress.city} - ${savedDefaultAddress.postalCode}`}</p>
                    </div>
                  </label>

                  <label className={`checkout-saved-method ${addressSource === 'current' ? 'checkout-saved-method-active' : ''}`}>
                    <input
                      type="radio"
                      name="addressSource"
                      checked={addressSource === 'current'}
                      onChange={useCurrentOrderAddress}
                      className="checkout-saved-method-radio"
                    />
                    <div className="checkout-saved-method-details">
                      <p>Use current order address</p>
                      <p>Enter a one-time address for this order only</p>
                    </div>
                  </label>
                </div>
              </div>
            ) : null}

            {isUsingDefaultAddress ? (
              <div className="checkout-summary-breakdown">
                <div>
                  <span>Name</span>
                  <strong>{fullName}</strong>
                </div>
                <div>
                  <span>Phone</span>
                  <strong>{phone}</strong>
                </div>
                <div>
                  <span>City</span>
                  <strong>{city}</strong>
                </div>
                <div>
                  <span>Pincode</span>
                  <strong>{postalCode}</strong>
                </div>
                <div>
                  <span>Address</span>
                  <strong>{address}</strong>
                </div>
              </div>
            ) : (
              <>
                <Input label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Julianne Moore" />
                <Input label="Phone number" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 (555) 000-0000" />
                <Input label="City" value={city} onChange={(event) => setCity(event.target.value)} placeholder="New York" />
                <Input label="Postal code" value={postalCode} onChange={(event) => setPostalCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="560001" />
              </>
            )}

            {postalCode ? (
              <div className="checkout-delivery-availability">
                <DeliveryInfo customerPincode={postalCode} orderTotal={total} showDetails={true} />
              </div>
            ) : null}

            {savedMethods.length > 0 ? (
              <div className="checkout-saved-methods">
                <label className="checkout-section-label">
                  Saved Payment Methods
                </label>
                <div className="checkout-saved-method-list">
                  {savedMethods.map((method) => (
                    <label
                      key={method.id}
                      className={`checkout-saved-method ${selectedSavedMethod?.id === method.id ? 'checkout-saved-method-active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="savedMethod"
                        checked={usingSaved && selectedSavedMethod?.id === method.id}
                        onChange={() => {
                          setUsingSaved(true)
                          setSelectedSavedMethod(method)
                        }}
                        className="checkout-saved-method-radio"
                      />
                      <div className="checkout-saved-method-details">
                        <p>{method.nickname}</p>
                        <p>
                          {method.method_type === 'UPI' && `UPI: ${method.upi_id}`}
                          {method.method_type === 'CARD' && `Card ending in ${method.card_last4}`}
                          {method.method_type === 'NETBANKING' && `${method.bank_name}`}
                          {method.method_type === 'WALLET' && `${method.wallet_provider}`}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="checkout-saved-methods-footer">
                  <label className="checkout-saved-method-toggle">
                    <input
                      type="radio"
                      name="savedMethod"
                      checked={!usingSaved}
                      onChange={() => setUsingSaved(false)}
                      className="checkout-saved-method-radio"
                    />
                    <span>Use a different payment method</span>
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
                  <p className="wishlist-message checkout-cod-note">
                    You will pay at delivery time.
                  </p>
                ) : null}
              </>
            ) : null}

            {!isUsingDefaultAddress ? (
              <Input
                label="Street address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Apartment, suite, unit, etc."
                multiline
                rows={4}
              />
            ) : null}
          </div>
        </section>

        <aside className="panel panel-stack checkout-summary-card">
          <h2>Order summary</h2>
          <div className="checkout-summary-breakdown">
            <div>
              <span>Subtotal</span>
              <strong>Rs. {subtotal.toFixed(2)}</strong>
            </div>
            <div>
              <span>Discount</span>
              <strong>-Rs. {discount.toFixed(2)}</strong>
            </div>
            <div>
              <span>Shipping</span>
              <strong>{shippingCharge === 0 ? 'Free' : '₹49'}</strong>
            </div>
            <div className="checkout-summary-total">
              <span>Total</span>
              <strong>Rs. {finalTotal.toFixed(2)}</strong>
            </div>
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
