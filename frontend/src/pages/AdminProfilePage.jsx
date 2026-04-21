import { useState } from 'react'
import PageWrapper from '../components/PageWrapper'
import { getStoredUser, buildAuthHeaders } from '../utils/auth'

const DEMO_MERCHANT_EMAIL = 'admin.demo@veloura.com'

const demoProfileDefaults = {
  storeName: 'Movi Trend Studio',
  gstNumber: '29ABCDE1234F1Z5',
  phone: '+91 98765 43210',
  accountHolder: 'Movi Trend Studio LLP',
  bankName: 'HDFC Bank',
  accountNumber: '50200012345678',
  ifscCode: 'HDFC0001234',
  logoUrl: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=400&q=80',
}

function withDemoDefaults(user, values) {
  const email = String(user?.email || '').trim().toLowerCase()
  if (email !== DEMO_MERCHANT_EMAIL) {
    return values
  }

  const merged = { ...values }
  Object.keys(merged).forEach((key) => {
    if (!String(merged[key] || '').trim()) {
      merged[key] = demoProfileDefaults[key]
    }
  })
  return merged
}

export default function AdminProfilePage() {
  const user = getStoredUser()
  const profileDetails = user?.profile_details || {}
  const bankDetails = profileDetails?.bank_details || {}

  const [formData, setFormData] = useState(withDemoDefaults(user, {
    storeName: String(profileDetails?.store_name || '').trim(),
    gstNumber: String(profileDetails?.gst_number || '').trim(),
    phone: String(user?.phone_number || '').trim(),
    accountHolder: String(bankDetails?.account_holder_name || '').trim(),
    bankName: String(bankDetails?.bank_name || '').trim(),
    accountNumber: String(bankDetails?.account_number || '').trim(),
    ifscCode: String(bankDetails?.ifsc_code || '').trim(),
    logoUrl: String(profileDetails?.logo_url || '').trim(),
  }))

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [logoPreview, setLogoPreview] = useState(profileDetails?.logo_url || null)

  const verificationStatus = String(user?.status || 'PENDING').toUpperCase() === 'ACTIVE' ? 'Verified' : 'Pending'
  const contactEmail = String(user?.email || '').trim() || 'Not provided'

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSave = async () => {
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch('/api/merchant/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders()
        },
        body: JSON.stringify({
          profile_details: {
            store_name: formData.storeName,
            gst_number: formData.gstNumber,
            logo_url: formData.logoUrl,
          },
          phone_number: formData.phone,
          bank_details: {
            account_holder_name: formData.accountHolder,
            bank_name: formData.bankName,
            account_number: formData.accountNumber,
            ifsc_code: formData.ifscCode,
          }
        })
      })

      if (response.ok) {
        setMessage('✓ Store details updated successfully')
        setTimeout(() => setMessage(''), 3000)
      } else {
        setMessage('Failed to update details')
      }
    } catch (error) {
      setMessage('Error updating details')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageWrapper
      className="page-merchant"
      eyebrow="Merchant"
      title="Merchant profile"
      description="Update your store details. App branding (Movi Fashion logo) and protected business settings are managed by the platform admin."
    >
      <div className="container admin-container">
        <section className="section card panel panel-stack">
          <div className="section-head">
            <div>
              <p className="eyebrow">Verification</p>
              <h2>Account status</h2>
            </div>
            <span className={verificationStatus === 'Verified' ? 'badge badge-success' : 'badge badge-warning'}>
              {verificationStatus}
            </span>
          </div>
        </section>

        <div className="section admin-profile-grid">
          <section className="card panel panel-stack">
            <p className="eyebrow">Store Info</p>
            <h2>Store details</h2>

            <div className="locked-branding-card">
              <div className="locked-branding-preview">
                {logoPreview ? <img src={logoPreview} alt="Shop logo preview" /> : <span>MV</span>}
                <div>
                  <p className="field-label">Platform branding</p>
                  <p>Logo and app name are managed centrally and cannot be changed here.</p>
                </div>
              </div>
            </div>

            <label className="field-group">
              <span className="field-label">Store name</span>
              <input
                className="field"
                name="storeName"
                value={formData.storeName}
                onChange={handleChange}
                placeholder="Your store name"
              />
            </label>

            <label className="field-group">
              <span className="field-label">GST</span>
              <input
                className="field"
                name="gstNumber"
                value={formData.gstNumber}
                onChange={handleChange}
                placeholder="GST number"
              />
            </label>
          </section>

          <section className="card panel panel-stack">
            <p className="eyebrow">Contact</p>
            <h2>Contact and banking</h2>

            <label className="field-group">
              <span className="field-label">Email</span>
              <input className="field" value={contactEmail} readOnly disabled />
              <small style={{ color: '#666', marginTop: '4px' }}>Email is managed by your account login</small>
            </label>

            <label className="field-group">
              <span className="field-label">Phone</span>
              <input
                className="field"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="Phone number"
              />
            </label>

            <p className="eyebrow" style={{ marginTop: '16px' }}>Banking</p>

            <label className="field-group">
              <span className="field-label">Account holder</span>
              <input
                className="field"
                name="accountHolder"
                value={formData.accountHolder}
                onChange={handleChange}
                placeholder="Account holder name"
              />
            </label>

            <label className="field-group">
              <span className="field-label">Bank name</span>
              <input
                className="field"
                name="bankName"
                value={formData.bankName}
                onChange={handleChange}
                placeholder="Bank name"
              />
            </label>

            <label className="field-group">
              <span className="field-label">Account number</span>
              <input
                className="field"
                name="accountNumber"
                value={formData.accountNumber}
                onChange={handleChange}
                placeholder="Account number"
              />
            </label>

            <label className="field-group">
              <span className="field-label">IFSC</span>
              <input
                className="field"
                name="ifscCode"
                value={formData.ifscCode}
                onChange={handleChange}
                placeholder="IFSC code"
              />
            </label>
          </section>
        </div>

        <div className="section admin-controls-row">
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save changes'}
          </button>
          {message && (
            <span style={{
              marginLeft: '12px',
              color: message.includes('✓') ? '#10b981' : '#ef4444',
              fontSize: '14px'
            }}>
              {message}
            </span>
          )}
        </div>
      </div>
    </PageWrapper>
  )
}
