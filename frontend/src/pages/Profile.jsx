import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'
import { getStoredUser } from '../utils/auth'
import { useEffect, useState } from 'react'
import Input from '../components/Input'
import toast from 'react-hot-toast'
import { clearSavedDefaultAddress, getSavedDefaultAddress, saveDefaultAddress } from '../utils/profileAddress'

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

function normalizeRole(role) {
  const next = String(role || '').trim().toLowerCase()
  if (next === 'merchant' || next === 'admin') {
    return 'admin'
  }
  if (next === 'customer' || next === 'user') {
    return 'user'
  }
  if (next === 'delivery' || next === 'delivery_associate') {
    return 'delivery'
  }
  if (next === 'operations' || next === 'operations_staff' || next === 'staff') {
    return 'operations'
  }
  return 'user'
}

export default function Profile() {
  const currentUser = getStoredUser()
  const displayName = (currentUser?.full_name || '').trim() || 'My profile'
  const email = (currentUser?.email || '').trim() || 'No email saved'
  const role = normalizeRole(currentUser?.role)
  const status = (currentUser?.status || 'ACTIVE').trim()

  const [paymentMethods, setPaymentMethods] = useState([])
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedMethod, setSelectedMethod] = useState(null)
  const [addressForm, setAddressForm] = useState({
    fullName: '',
    phone: '',
    city: '',
    postalCode: '',
    addressLine: '',
  })
  const [savedAddress, setSavedAddress] = useState(null)
  const [editingAddress, setEditingAddress] = useState(true)
  const [addressMessage, setAddressMessage] = useState('')
  const [formData, setFormData] = useState({
    method_type: 'UPI',
    nickname: '',
    upi_id: '',
    card_number: '',
    card_holder_name: '',
    card_expiry: '',
    bank_name: '',
    wallet_provider: '',
    is_default: false,
  })

  useEffect(() => {
    loadPaymentMethods()
    const existingAddress = getSavedDefaultAddress(currentUser)
    if (existingAddress) {
      setSavedAddress(existingAddress)
      setAddressForm(existingAddress)
      setEditingAddress(false)
    } else {
      setAddressForm((previous) => ({
        ...previous,
        fullName: displayName === 'My profile' ? '' : displayName,
      }))
      setEditingAddress(true)
    }
  }, [])

  function updateAddressForm(field, value) {
    setAddressForm((previous) => ({
      ...previous,
      [field]: field === 'postalCode' ? String(value || '').replace(/\D/g, '').slice(0, 6) : value,
    }))
  }

  function validateAddressForm() {
    if (!addressForm.fullName.trim()) {
      return 'Please enter full name.'
    }
    if (String(addressForm.phone || '').replace(/\D/g, '').length < 10) {
      return 'Please enter a valid phone number.'
    }
    if (!addressForm.city.trim()) {
      return 'Please enter city.'
    }
    if (String(addressForm.postalCode || '').trim().length !== 6) {
      return 'Please enter a valid 6-digit postal code.'
    }
    if (!addressForm.addressLine.trim()) {
      return 'Please enter street address.'
    }
    return ''
  }

  function handleSaveDefaultAddress() {
    const validationError = validateAddressForm()
    if (validationError) {
      setAddressMessage(validationError)
      return
    }

    const saved = saveDefaultAddress(currentUser, addressForm)
    setSavedAddress(saved)
    setAddressForm(saved)
    setEditingAddress(false)
    setAddressMessage('Default address saved. Checkout will let you use this directly.')
  }

  function handleEditAddress() {
    setAddressForm(savedAddress || addressForm)
    setEditingAddress(true)
    setAddressMessage('')
  }

  function handleCancelAddressEdit() {
    if (savedAddress) {
      setAddressForm(savedAddress)
      setEditingAddress(false)
    }
    setAddressMessage('')
  }

  function handleClearSavedAddress() {
    clearSavedDefaultAddress(currentUser)
    setSavedAddress(null)
    setAddressForm({ fullName: '', phone: '', city: '', postalCode: '', addressLine: '' })
    setEditingAddress(true)
    setAddressMessage('Saved default address removed.')
  }

  async function loadPaymentMethods() {
    try {
      setLoading(true)
      const token = localStorage.getItem('auth_token')
      for (const baseUrl of API_CANDIDATES) {
        try {
          const response = await fetch(`${baseUrl}/payment-methods`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (response.ok) {
            const data = await response.json()
            setPaymentMethods(data.payment_methods || [])
            return
          }
          if (response.status < 500) {
            setPaymentMethods([])
            return
          }
        } catch (error) {
          if (baseUrl === API_CANDIDATES[API_CANDIDATES.length - 1]) {
            console.error('Failed to load payment methods:', error)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load payment methods:', error)
      setPaymentMethods([])
    } finally {
      setLoading(false)
    }
  }

  async function handleSavePaymentMethod(e) {
    e.preventDefault()
    try {
      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${API_BASE}/payment-methods`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      })
      if (response.ok) {
        setShowAddForm(false)
        resetForm()
        await loadPaymentMethods()
        toast.success('Payment method saved.')
      } else {
        const error = await response.json()
        toast.error(error.detail || 'Failed to save payment method.')
      }
    } catch (error) {
      toast.error('Failed to save payment method.')
    }
  }

  async function handleDeletePaymentMethod(methodId) {
    if (!window.confirm('Delete this payment method?')) return
    try {
      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${API_BASE}/payment-methods/${methodId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        await loadPaymentMethods()
        toast.success('Payment method deleted.')
      }
    } catch {
      toast.error('Failed to delete payment method.')
    }
  }

  async function handleSetDefault(methodId) {
    try {
      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${API_BASE}/payment-methods/${methodId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_default: true }),
      })
      if (response.ok) {
        await loadPaymentMethods()
      }
    } catch {
      // ignore
    }
  }

  function resetForm() {
    setFormData({
      method_type: 'UPI',
      nickname: '',
      upi_id: '',
      card_number: '',
      card_holder_name: '',
      card_expiry: '',
      bank_name: '',
      wallet_provider: '',
      is_default: false,
    })
  }

  return (
    <PageWrapper
      eyebrow="Profile"
      title="Account overview"
      description="Review your saved profile, orders, and wishlist without leaving the shopping flow."
      actions={
        <div className="row-gap">
          <Button to="/orders/tracking" variant="secondary">
            View orders
          </Button>
          <Button to="/wishlist" variant="primary">
            Open wishlist
          </Button>
        </div>
      }
    >
      <section className="section-card panel-stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">Signed in as</p>
            <h2>{displayName}</h2>
          </div>
          <p>{status}</p>
        </div>

        <div className="summary-row">
          <p>
            Email: <strong>{email}</strong>
          </p>
          <p>
            Role: <strong>{role}</strong>
          </p>
        </div>

        <div className="panel-stack">
          <p className="detail-caption">Profile tools</p>
          <div className="row-gap">
            <Button to="/orders/tracking" variant="secondary">
              Track orders
            </Button>
            <Button to="/wishlist" variant="secondary">
              Wishlist
            </Button>
            <Button to="/cart" variant="secondary">
              Bag
            </Button>
          </div>
        </div>
      </section>

      <section className="section-card panel-stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">Checkout shortcut</p>
            <h3>Default shipping address</h3>
          </div>
          {savedAddress && !editingAddress ? (
            <div className="row-gap">
              <Button variant="secondary" onClick={handleEditAddress}>Edit</Button>
              <Button variant="secondary" onClick={handleClearSavedAddress}>Clear</Button>
            </div>
          ) : null}
        </div>

        {!editingAddress && savedAddress ? (
          <div className="checkout-summary-breakdown">
            <div>
              <span>Name</span>
              <strong>{savedAddress.fullName}</strong>
            </div>
            <div>
              <span>Phone</span>
              <strong>{savedAddress.phone}</strong>
            </div>
            <div>
              <span>City</span>
              <strong>{savedAddress.city}</strong>
            </div>
            <div>
              <span>Pincode</span>
              <strong>{savedAddress.postalCode}</strong>
            </div>
            <div>
              <span>Address</span>
              <strong>{savedAddress.addressLine}</strong>
            </div>
          </div>
        ) : (
          <div className="form-grid">
            <Input
              label="Full name"
              value={addressForm.fullName}
              onChange={(event) => updateAddressForm('fullName', event.target.value)}
              placeholder="e.g. Julianne Moore"
            />
            <Input
              label="Phone number"
              value={addressForm.phone}
              onChange={(event) => updateAddressForm('phone', event.target.value)}
              placeholder="+91 98765 43210"
            />
            <Input
              label="City"
              value={addressForm.city}
              onChange={(event) => updateAddressForm('city', event.target.value)}
              placeholder="Bengaluru"
            />
            <Input
              label="Postal code"
              value={addressForm.postalCode}
              onChange={(event) => updateAddressForm('postalCode', event.target.value)}
              placeholder="560001"
            />
            <Input
              label="Street address"
              value={addressForm.addressLine}
              onChange={(event) => updateAddressForm('addressLine', event.target.value)}
              placeholder="Apartment, suite, unit, etc."
              multiline
              rows={3}
            />
            <div className="row-gap">
              <Button variant="primary" onClick={handleSaveDefaultAddress}>Save address</Button>
              {savedAddress ? <Button variant="secondary" onClick={handleCancelAddressEdit}>Cancel</Button> : null}
            </div>
          </div>
        )}

        {addressMessage ? <p className="wishlist-message">{addressMessage}</p> : null}
      </section>

      {/* Payment Methods Section */}
      <section className="section-card panel-stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">Payments</p>
            <h3>Saved payment methods</h3>
          </div>
          <Button variant="secondary" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Cancel' : '+ Add Method'}
          </Button>
        </div>

        {showAddForm ? (
          <form className="panel-stack form-grid" onSubmit={handleSavePaymentMethod}>
            <label className="field-group">
              <span className="field-label">Payment type</span>
              <select
                className="field"
                value={formData.method_type}
                onChange={(e) => setFormData({ ...formData, method_type: e.target.value })}
              >
                <option value="UPI">UPI</option>
                <option value="CARD">Credit / Debit Card</option>
                <option value="NETBANKING">Net Banking</option>
                <option value="WALLET">Wallet</option>
              </select>
            </label>

            <Input
              label="Nickname (optional)"
              value={formData.nickname}
              onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
              placeholder="e.g. My UPI, Office Card"
            />

            {formData.method_type === 'UPI' ? (
              <Input
                label="UPI ID"
                value={formData.upi_id}
                onChange={(e) => setFormData({ ...formData, upi_id: e.target.value })}
                placeholder="name@bankname"
                required
              />
            ) : null}

            {formData.method_type === 'CARD' ? (
              <>
                <Input
                  label="Card number"
                  value={formData.card_number}
                  onChange={(e) => setFormData({ ...formData, card_number: e.target.value.replace(/\D/g, '') })}
                  placeholder="1234 5678 9012 3456"
                  required
                />
                <Input
                  label="Card holder name"
                  value={formData.card_holder_name}
                  onChange={(e) => setFormData({ ...formData, card_holder_name: e.target.value })}
                  placeholder="John Doe"
                  required
                />
                <Input
                  label="Expiry (MM/YY)"
                  value={formData.card_expiry}
                  onChange={(e) => setFormData({ ...formData, card_expiry: e.target.value })}
                  placeholder="12/25"
                  required
                />
              </>
            ) : null}

            {formData.method_type === 'NETBANKING' ? (
              <Input
                label="Bank name"
                value={formData.bank_name}
                onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                placeholder="HDFC Bank"
                required
              />
            ) : null}

            {formData.method_type === 'WALLET' ? (
              <label className="field-group">
                <span className="field-label">Wallet provider</span>
                <select
                  className="field"
                  value={formData.wallet_provider}
                  onChange={(e) => setFormData({ ...formData, wallet_provider: e.target.value })}
                  required
                >
                  <option value="">Select wallet</option>
                  <option value="Google Pay">Google Pay</option>
                  <option value="PhonePe">PhonePe</option>
                  <option value="Paytm">Paytm</option>
                  <option value="Amazon Pay">Amazon Pay</option>
                </select>
              </label>
            ) : null}

            <label className="field-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
              />
              <span className="field-label" style={{ margin: 0 }}>Set as default</span>
            </label>

            <div className="row-gap">
              <Button type="submit" variant="primary">Save method</Button>
              <Button variant="secondary" onClick={() => { setShowAddForm(false); resetForm() }}>Cancel</Button>
            </div>
          </form>
        ) : null}

        {loading ? <p>Loading payment methods...</p> : null}

        {!loading && paymentMethods.length === 0 ? (
          <p className="empty-state">No saved methods yet. Add one to speed up checkout.</p>
        ) : null}

        {!loading && paymentMethods.length > 0 ? (
          <div className="profile-payment-list">
            {paymentMethods.map((method) => (
              <div
                key={method.id}
                className={`profile-payment-card ${method.is_default ? 'profile-payment-card-default' : ''}`}
              >
                <div className="profile-payment-info">
                  <div className="profile-payment-name">
                    {method.nickname || method.method_type}
                    {method.is_default ? (
                      <span className="profile-payment-default-badge">DEFAULT</span>
                    ) : null}
                  </div>
                  <p className="profile-payment-detail">
                    {method.method_type === 'UPI' && `UPI: ${method.upi_id}`}
                    {method.method_type === 'CARD' && `Card ending in ${method.card_last4} · ${method.card_holder_name}`}
                    {method.method_type === 'NETBANKING' && method.bank_name}
                    {method.method_type === 'WALLET' && method.wallet_provider}
                  </p>
                </div>
                <div className="row-gap">
                  {!method.is_default ? (
                    <Button variant="secondary" onClick={() => handleSetDefault(method.id)}>
                      Set default
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={() => handleDeletePaymentMethod(method.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </PageWrapper>
  )
}

