import { useMemo, useState } from 'react'
import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'

const initialForm = {
  fullName: '',
  email: '',
  phoneNumber: '',
  password: '',
  storeName: '',
  businessType: '',
  gstNumber: '',
  panNumber: '',
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
      { name: 'storeName', label: 'Store Name', type: 'text', placeholder: 'Your store name', required: true },
      {
        name: 'businessType',
        label: 'Business Type',
        type: 'select',
        options: ['Individual', 'Company'],
        required: true,
      },
      { name: 'gstNumber', label: 'GST Number (optional)', type: 'text', placeholder: 'GST number', required: false },
      { name: 'panNumber', label: 'PAN Number', type: 'text', placeholder: 'PAN number', required: true },
    ],
  },
  {
    title: 'Address',
    fields: [
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
    setForm((current) => {
      const next = { ...current, [name]: value }
      const isCurrentSectionComplete = merchantSections[activeSection].fields
        .filter((field) => field.required)
        .every((field) => isFilled(next[field.name]))

      if (isCurrentSectionComplete && activeSection < merchantSections.length - 1) {
        setActiveSection(activeSection + 1)
      }

      return next
    })
  }

  function handleSubmit(event) {
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

    setMessage(`Merchant registration submitted for ${form.storeName} (demo).`)
  }

  return (
    <div className="auth-shell">
      <PageWrapper
        eyebrow="Merchant onboarding"
        title="Register your merchant account"
        description="Complete your profile to start selling on our platform with secure payouts and business tools."
        className="merchant-narrow"
      >
        <section className="auth-card merchant-auth-card panel-stack">
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
            {merchantSections.map((section, sectionIndex) => {
              const isOpen = sectionIndex === activeSection

              return (
                <div
                  key={section.title}
                  className={`merchant-section-card ${isOpen ? 'merchant-section-open' : ''} ${sectionCompletion[sectionIndex] ? 'merchant-section-complete' : ''}`}
                >
                  <button type="button" className="merchant-form-section" onClick={() => setActiveSection(sectionIndex)}>
                    <p className="eyebrow">Section {sectionIndex + 1}</p>
                    <h2>{section.title}</h2>
                  </button>

                  {isOpen ? (
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
                                  Select business type
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
                  ) : null}
                </div>
              )
            })}

            <Button type="submit" variant="primary" className="btn-wide">
              Register as Merchant
            </Button>
          </form>
          {message ? <p className="login-message">{message}</p> : null}
        </section>
      </PageWrapper>
    </div>
  )
}
