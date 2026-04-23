import { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import { findLocalAccountByEmail, upsertLocalAccount } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const initialForm = {
  fullName: '',
  email: '',
  phoneNumber: '',
  password: '',
  legalBusinessName: '',
  storeName: '',
  businessType: '',
  yearsInBusiness: '',
  monthlyOrderVolume: '',
  sellOnAmazon: '',
  sellOnFlipkart: '',
  gstNumber: '',
  panNumber: '',
  pickupAddress: '',
  pickupCity: '',
  pickupState: '',
  pickupPincode: '',
  returnAddress: '',
  returnCity: '',
  returnState: '',
  returnPincode: '',
  addressLine: '',
  city: '',
  state: '',
  pincode: '',
  accountHolderName: '',
  bankName: '',
  accountNumber: '',
  ifscCode: '',
}

const merchantSections = [
  {
    title: 'Basic Info',
    fields: [
      { name: 'fullName', label: 'Full Name', type: 'text', placeholder: 'Your full name', required: true },
      { name: 'email', label: 'Email', type: 'email', placeholder: 'merchant@store.com', required: true },
      { name: 'phoneNumber', label: 'Phone Number', type: 'tel', placeholder: '10-digit mobile number', required: true },
      { name: 'password', label: 'Password', type: 'password', placeholder: 'Create a password', required: true },
    ],
  },
  {
    title: 'Business Details',
    fields: [
      { name: 'legalBusinessName', label: 'Legal Business Name', type: 'text', placeholder: 'Registered legal entity name', required: true },
      { name: 'storeName', label: 'Store Name', type: 'text', placeholder: 'Your store name', required: true },
      {
        name: 'businessType',
        label: 'Business Type',
        type: 'select',
        options: ['Individual', 'Proprietorship', 'Partnership', 'Private Limited', 'LLP'],
        required: true,
      },
      {
        name: 'yearsInBusiness',
        label: 'Years in Business',
        type: 'select',
        options: ['New (< 1 year)', '1-3 years', '3-5 years', '5+ years'],
        required: true,
      },
      {
        name: 'monthlyOrderVolume',
        label: 'Expected Monthly Orders',
        type: 'select',
        options: ['0-100', '101-500', '501-2000', '2000+'],
        required: true,
      },
      {
        name: 'sellOnAmazon',
        label: 'Already selling on Amazon?',
        type: 'select',
        options: ['No', 'Yes'],
        required: true,
      },
      {
        name: 'sellOnFlipkart',
        label: 'Already selling on Flipkart?',
        type: 'select',
        options: ['No', 'Yes'],
        required: true,
      },
      { name: 'gstNumber', label: 'GST Number', type: 'text', placeholder: 'GST number', required: true },
      { name: 'panNumber', label: 'PAN Number', type: 'text', placeholder: 'PAN number', required: true },
    ],
  },
  {
    title: 'Pickup & Return Address',
    fields: [
      { name: 'pickupAddress', label: 'Pickup Address', type: 'text', placeholder: 'Warehouse pickup address', required: true },
      { name: 'pickupCity', label: 'Pickup City', type: 'text', placeholder: 'Pickup city', required: true },
      { name: 'pickupState', label: 'Pickup State', type: 'text', placeholder: 'Pickup state', required: true },
      { name: 'pickupPincode', label: 'Pickup Pincode', type: 'text', placeholder: 'Pickup pincode', required: true },
      { name: 'returnAddress', label: 'Return Address', type: 'text', placeholder: 'Return processing address', required: true },
      { name: 'returnCity', label: 'Return City', type: 'text', placeholder: 'Return city', required: true },
      { name: 'returnState', label: 'Return State', type: 'text', placeholder: 'Return state', required: true },
      { name: 'returnPincode', label: 'Return Pincode', type: 'text', placeholder: 'Return pincode', required: true },
      { name: 'addressLine', label: 'Address Line', type: 'text', placeholder: 'Street, area, landmark', required: true },
      { name: 'city', label: 'City', type: 'text', placeholder: 'City', required: true },
      { name: 'state', label: 'State', type: 'text', placeholder: 'State', required: true },
      { name: 'pincode', label: 'Pincode', type: 'text', placeholder: 'Pincode', required: true },
    ],
  },
  {
    title: 'Bank Details',
    fields: [
      {
        name: 'accountHolderName',
        label: 'Account Holder Name',
        type: 'text',
        placeholder: 'Account holder name',
        required: true,
      },
      { name: 'bankName', label: 'Bank Name', type: 'text', placeholder: 'Bank name', required: true },
      { name: 'accountNumber', label: 'Account Number', type: 'text', placeholder: 'Account number', required: true },
      { name: 'ifscCode', label: 'IFSC Code', type: 'text', placeholder: 'IFSC code', required: true },
    ],
  },
]

function isFilled(value) {
  return String(value || '').trim().length > 0
}

export default function MerchantRegister() {
  const [form, setForm] = useState(initialForm)
  const [message, setMessage] = useState('')
  const [activeSection, setActiveSection] = useState(0)
  const navigate = useNavigate()

  const requiredFields = useMemo(
    () => merchantSections.flatMap((section) => section.fields.filter((field) => field.required).map((field) => field.name)),
    [],
  )

  const sectionCompletion = useMemo(
    () =>
      merchantSections.map((section) =>
        section.fields.filter((field) => field.required).every((field) => isFilled(form[field.name])),
      ),
    [form],
  )

  const completedRequiredCount = useMemo(
    () => requiredFields.filter((fieldName) => isFilled(form[fieldName])).length,
    [form, requiredFields],
  )

  const progressPercent = Math.round((completedRequiredCount / requiredFields.length) * 100)

  const completedSections = sectionCompletion.filter(Boolean).length

  function updateField(name, value) {
    setMessage('')
    setForm((current) => ({ ...current, [name]: value }))
  }

  function goToNextSection() {
    const currentFields = merchantSections[activeSection].fields
    const missingCurrent = currentFields.filter((field) => field.required && !isFilled(form[field.name]))
    if (missingCurrent.length > 0) {
      setMessage('Please fill all required fields in this section to continue.')
      return
    }

    if (activeSection < merchantSections.length - 1) {
      setActiveSection(activeSection + 1)
      setMessage('')
    }
  }

  function goToPreviousSection() {
    if (activeSection > 0) {
      setActiveSection(activeSection - 1)
      setMessage('')
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const missing = requiredFields.filter((field) => !String(form[field] || '').trim())
    if (missing.length > 0) {
      const firstMissingSectionIndex = merchantSections.findIndex((section) =>
        section.fields.some((field) => field.required && field.name === missing[0]),
      )
      setActiveSection(firstMissingSectionIndex === -1 ? 0 : firstMissingSectionIndex)
      setMessage('Please fill all required merchant details.')
      return
    }

    const profileDetails = {
      legal_business_name: form.legalBusinessName,
      store_name: form.storeName,
      business_type: form.businessType,
      years_in_business: form.yearsInBusiness,
      monthly_order_volume: form.monthlyOrderVolume,
      sell_on_amazon: form.sellOnAmazon,
      sell_on_flipkart: form.sellOnFlipkart,
      gst_number: form.gstNumber,
      pan_number: form.panNumber,
      pickup_address: {
        address_line: form.pickupAddress,
        city: form.pickupCity,
        state: form.pickupState,
        pincode: form.pickupPincode,
      },
      return_address: {
        address_line: form.returnAddress,
        city: form.returnCity,
        state: form.returnState,
        pincode: form.returnPincode,
      },
      registered_address: {
        address_line: form.addressLine,
        city: form.city,
        state: form.state,
        pincode: form.pincode,
      },
      bank_details: {
        account_holder_name: form.accountHolderName,
        bank_name: form.bankName,
        account_number: form.accountNumber,
        ifsc_code: form.ifscCode,
      },
    }

    try {
      const response = await fetch(`${API_BASE}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          full_name: form.fullName,
          email: form.email,
          password: form.password,
          role: 'ADMIN',
          phone_number: form.phoneNumber,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          profile_details: profileDetails,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to create merchant account.')
        return
      }

      setMessage(data.message || `Merchant registration submitted for ${form.storeName}.`)
      navigate('/login')
    } catch {
      const existing = findLocalAccountByEmail(form.email)
      if (existing) {
        setMessage('Account already exists. Please login.')
        return
      }

      upsertLocalAccount({
        full_name: form.fullName,
        email: form.email,
        password: form.password,
        provider: 'email',
        role: 'admin',
        status: 'PENDING',
      })

      setMessage(`Merchant registration submitted for ${form.storeName}.`)
      navigate('/login')
    }
  }

  const isLastSection = activeSection === merchantSections.length - 1

  return (
    <div className="auth-shell auth-shell-merchant">
      <section className="auth-portal auth-portal-long" aria-label="Merchant account registration portal">
        <aside className="auth-portal-hero auth-portal-hero-signup">
          <div className="auth-hero-head">
            <img className="auth-brand-logo" src="/movicloud%20logo.png" alt="Movi Fashion logo" />
            <div>
              <h3>Movi Fashion</h3>
              <p>E-Commerce Platform</p>
            </div>
          </div>

          <div className="auth-hero-copy">
            <h2>Register as a Merchant</h2>
            <p>Complete your business profile to start selling with secure payouts and marketplace support tools.</p>
          </div>

          <div className="auth-hero-tags" aria-label="Merchant onboarding highlights">
            <span>Business Verification</span>
            <span>Secure Payouts</span>
            <span>Seller Tools</span>
            <span>Marketplace Scale</span>
          </div>

          <p className="auth-hero-foot">Designed for modern multi-channel sellers.</p>
        </aside>

        <section className="auth-portal-form-wrap">
          <div className="auth-portal-title-wrap">
            <p className="eyebrow">Merchant onboarding</p>
            <h2>Register your merchant account</h2>
            <p>Complete your profile to start selling on our platform with secure payouts and business tools.</p>
          </div>

          <div className="auth-card merchant-auth-card panel-stack auth-portal-form auth-portal-form-scroll">
          <div className="merchant-progress-card">
            <div className="merchant-progress-head">
              <div>
                <p className="eyebrow">Profile completion tracker</p>
                <h3>{progressPercent}% complete</h3>
              </div>
              <p>{completedSections} of 4 sections done</p>
            </div>
            <div className="merchant-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="merchant-progress-steps">
              {merchantSections.map((section, index) => (
                <button
                  key={section.title}
                  type="button"
                  className={`merchant-step ${sectionCompletion[index] ? 'merchant-step-complete' : ''} ${index === activeSection ? 'merchant-step-active' : ''}`}
                  onClick={() => setActiveSection(index)}
                >
                  <span>{index + 1}</span>
                  <p>{section.title}</p>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="form-grid merchant-form-grid">
            {(() => {
              const section = merchantSections[activeSection]
              const sectionIndex = activeSection
              return (
                <div
                  key={section.title}
                  className={`merchant-section-card merchant-section-open ${sectionCompletion[sectionIndex] ? 'merchant-section-complete' : ''}`}
                >
                  <div className="merchant-form-section">
                    <p className="eyebrow">Section {sectionIndex + 1}</p>
                    <h2>{section.title}</h2>
                  </div>

                  <div className="merchant-section-fields">
                    {section.fields.map((field) => {
                      if (field.type === 'select') {
                        return (
                          <label key={field.name} className="field-group">
                            <span className="field-label">{field.label}</span>
                            <select
                              className="field"
                              value={form[field.name]}
                              onChange={(event) => updateField(field.name, event.target.value)}
                              required={field.required}
                            >
                              <option value="" disabled>
                                {`Select ${field.label.toLowerCase()}`}
                              </option>
                              {field.options.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                        )
                      }

                      return (
                        <Input
                          key={field.name}
                          label={field.label}
                          type={field.type}
                          value={form[field.name]}
                          onChange={(event) => updateField(field.name, event.target.value)}
                          placeholder={field.placeholder}
                          required={field.required}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            <div className="merchant-step-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={goToPreviousSection}
                disabled={activeSection === 0}
              >
                Previous
              </button>

              {isLastSection ? (
                <Button type="submit" variant="primary" className="btn-wide">
                  Register as Merchant
                </Button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={goToNextSection}>
                  Next
                </button>
              )}
            </div>
          </form>
          <p className="auth-switch-text">
            Already have account?{' '}
            <NavLink to="/login" className="merchant-cta-link">
              Login
            </NavLink>
          </p>
          {message ? <p className="login-message">{message}</p> : null}
          </div>
        </section>
      </section>
    </div>
  )
}
