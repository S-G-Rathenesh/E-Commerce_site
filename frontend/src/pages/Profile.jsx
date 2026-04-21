import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'
import { getStoredUser } from '../utils/auth'
import { useEffect, useState } from 'react'
import Input from '../components/Input'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

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
  }, [])

  async function loadPaymentMethods() {
    try {
      setLoading(true)
      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${API_BASE}/payment-methods`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setPaymentMethods(data.payment_methods || [])
      }
    } catch (error) {
      console.error('Failed to load payment methods:', error)
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
        alert('Payment method saved successfully!')
      } else {
        const error = await response.json()
        alert(`Error: ${error.detail || 'Failed to save payment method'}`)
      }
    } catch (error) {
      console.error('Error saving payment method:', error)
      alert('Failed to save payment method')
    }
  }

  async function handleDeletePaymentMethod(methodId) {
    if (!confirm('Are you sure you want to delete this payment method?')) return

    try {
      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${API_BASE}/payment-methods/${methodId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        await loadPaymentMethods()
        alert('Payment method deleted successfully!')
      }
    } catch (error) {
      console.error('Error deleting payment method:', error)
      alert('Failed to delete payment method')
    }
  }

  async function handleSetDefault(methodId) {
    try {
      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${API_BASE}/payment-methods/${methodId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_default: true }),
      })
      if (response.ok) {
        await loadPaymentMethods()
      }
    } catch (error) {
      console.error('Error setting default payment method:', error)
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

      {/* Payment Methods Section */}
      <section className="section-card panel-stack">
        <div className="section-head">
          <h3>Saved Payment Methods</h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            {showAddForm ? 'Cancel' : '+ Add Payment Method'}
          </button>
        </div>

        {/* Add Payment Method Form */}
        {showAddForm && (
          <form onSubmit={handleSavePaymentMethod} style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Payment Method Type
              </label>
              <select
                value={formData.method_type}
                onChange={(e) => setFormData({ ...formData, method_type: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                <option value="UPI">UPI</option>
                <option value="CARD">Credit/Debit Card</option>
                <option value="NETBANKING">Net Banking</option>
                <option value="WALLET">Wallet</option>
              </select>
            </div>

            <Input
              label="Nickname (optional)"
              value={formData.nickname}
              onChange={(value) => setFormData({ ...formData, nickname: value })}
              placeholder="e.g., My UPI, Office Card"
            />

            {formData.method_type === 'UPI' && (
              <Input
                label="UPI ID"
                value={formData.upi_id}
                onChange={(value) => setFormData({ ...formData, upi_id: value })}
                placeholder="name@bankname"
                required
              />
            )}

            {formData.method_type === 'CARD' && (
              <>
                <Input
                  label="Card Number"
                  value={formData.card_number}
                  onChange={(value) => setFormData({ ...formData, card_number: value.replace(/\D/g, '') })}
                  placeholder="1234 5678 9012 3456"
                  maxLength="19"
                  required
                />
                <Input
                  label="Card Holder Name"
                  value={formData.card_holder_name}
                  onChange={(value) => setFormData({ ...formData, card_holder_name: value })}
                  placeholder="John Doe"
                  required
                />
                <Input
                  label="Expiry (MM/YY)"
                  value={formData.card_expiry}
                  onChange={(value) => setFormData({ ...formData, card_expiry: value })}
                  placeholder="12/25"
                  maxLength="5"
                  required
                />
              </>
            )}

            {formData.method_type === 'NETBANKING' && (
              <Input
                label="Bank Name"
                value={formData.bank_name}
                onChange={(value) => setFormData({ ...formData, bank_name: value })}
                placeholder="HDFC Bank"
                required
              />
            )}

            {formData.method_type === 'WALLET' && (
              <select
                value={formData.wallet_provider}
                onChange={(e) => setFormData({ ...formData, wallet_provider: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  marginBottom: '16px',
                }}
                required
              >
                <option value="">Select Wallet</option>
                <option value="Google Pay">Google Pay</option>
                <option value="Apple Pay">Apple Pay</option>
                <option value="Amazon Pay">Amazon Pay</option>
                <option value="PayTM">PayTM</option>
                <option value="PhonePe">PhonePe</option>
              </select>
            )}

            <label style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                style={{ marginRight: '8px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '14px' }}>Set as default payment method</span>
            </label>

            <button
              type="submit"
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
              }}
            >
              Save Payment Method
            </button>
          </form>
        )}

        {/* Payment Methods List */}
        <div>
          {loading ? (
            <p>Loading payment methods...</p>
          ) : paymentMethods.length === 0 ? (
            <p style={{ color: '#666', fontSize: '14px' }}>No saved payment methods. Add one to make checkout faster!</p>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {paymentMethods.map((method) => (
                <div
                  key={method.id}
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: method.is_default ? '#e7f3ff' : '#fff',
                  }}
                >
                  <div>
                    <p style={{ fontWeight: '500', marginBottom: '4px' }}>
                      {method.nickname}
                      {method.is_default && (
                        <span
                          style={{
                            marginLeft: '8px',
                            padding: '2px 8px',
                            backgroundColor: '#007bff',
                            color: 'white',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                          }}
                        >
                          DEFAULT
                        </span>
                      )}
                    </p>
                    <p style={{ fontSize: '13px', color: '#666', margin: '0' }}>
                      {method.method_type === 'UPI' && `UPI: ${method.upi_id}`}
                      {method.method_type === 'CARD' && `Card ending in ${method.card_last4} - ${method.card_holder_name}`}
                      {method.method_type === 'NETBANKING' && `${method.bank_name}`}
                      {method.method_type === 'WALLET' && `${method.wallet_provider}`}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {!method.is_default && (
                      <button
                        onClick={() => handleSetDefault(method.id)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#6c757d',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      onClick={() => handleDeletePaymentMethod(method.id)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </PageWrapper>
  )
}

