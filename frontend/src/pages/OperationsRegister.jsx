import { useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import { findLocalAccountByEmail, upsertLocalAccount } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const operationsSections = [
  {
    title: 'Basic Info',
    fields: ['fullName', 'email', 'phoneNumber'],
  },
  {
    title: 'Operations Details',
    fields: ['employeeCode', 'department', 'city', 'state', 'pincode'],
  },
  {
    title: 'Security Setup',
    fields: ['password', 'confirmPassword'],
  },
]

function isFilled(value) {
  return String(value || '').trim().length > 0
}

export default function OperationsRegister() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [department, setDepartment] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [pincode, setPincode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [activeSection, setActiveSection] = useState(0)
  const navigate = useNavigate()

  const values = {
    fullName,
    email,
    phoneNumber,
    employeeCode,
    department,
    city,
    state,
    pincode,
    password,
    confirmPassword,
  }

  const requiredFields = useMemo(() => operationsSections.flatMap((section) => section.fields), [])

  const sectionCompletion = useMemo(
    () => operationsSections.map((section) => section.fields.every((fieldName) => isFilled(values[fieldName]))),
    [fullName, email, phoneNumber, employeeCode, department, city, state, pincode, password, confirmPassword],
  )

  const completedRequiredCount = useMemo(
    () => requiredFields.filter((fieldName) => isFilled(values[fieldName])).length,
    [fullName, email, phoneNumber, employeeCode, department, city, state, pincode, password, confirmPassword, requiredFields],
  )

  const progressPercent = Math.round((completedRequiredCount / requiredFields.length) * 100)
  const completedSections = sectionCompletion.filter(Boolean).length
  const isLastSection = activeSection === operationsSections.length - 1

  function goToNextSection() {
    const currentFields = operationsSections[activeSection].fields
    const missingCurrent = currentFields.filter((fieldName) => !isFilled(values[fieldName]))
    if (missingCurrent.length > 0) {
      setMessage('Please fill all required fields in this section to continue.')
      return
    }
    if (activeSection < operationsSections.length - 1) {
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

    const missing = requiredFields.filter((fieldName) => !isFilled(values[fieldName]))
    if (missing.length > 0) {
      const firstMissingSectionIndex = operationsSections.findIndex((section) => section.fields.includes(missing[0]))
      setActiveSection(firstMissingSectionIndex === -1 ? 0 : firstMissingSectionIndex)
      setMessage('Please fill all required details.')
      return
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }

    const normalizedPhone = phoneNumber.replace(/\D/g, '').slice(0, 10)
    const normalizedPincode = pincode.replace(/\D/g, '').slice(0, 6)

    if (normalizedPhone.length !== 10) {
      setMessage('Phone number must be exactly 10 digits.')
      return
    }

    if (normalizedPincode.length !== 6) {
      setMessage('Pincode must be exactly 6 digits.')
      return
    }

    const profileDetails = {
      employee_code: employeeCode,
      department,
    }

    try {
      const response = await fetch(`${API_BASE}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          password,
          role: 'OPERATIONS_STAFF',
          phone_number: normalizedPhone,
          state,
          pincode: normalizedPincode,
          profile_details: profileDetails,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        setMessage(data?.detail || 'Unable to create operations account.')
        return
      }

      setMessage(data.message || 'Operations staff account created and pending approval.')
      navigate('/login')
    } catch {
      const existing = findLocalAccountByEmail(email)
      if (existing) {
        setMessage('Account already exists. Please login.')
        return
      }

      const localAccount = upsertLocalAccount({
        full_name: fullName,
        email,
        password,
        provider: 'email',
        role: 'operations_staff',
        status: 'PENDING',
      })

      setMessage(`Operations account created for ${localAccount.full_name}. Account pending approval.`)
      navigate('/login')
    }
  }

  return (
    <div className="auth-shell auth-shell-operations">
      <section className="auth-portal auth-portal-long" aria-label="Operations account registration portal">
        <aside className="auth-portal-hero auth-portal-hero-signup">
          <div className="auth-hero-head">
            <img className="auth-brand-logo" src="/movicloud%20logo.png" alt="Movi Fashion logo" />
            <div>
              <h3>Movi Fashion</h3>
              <p>E-Commerce Platform</p>
            </div>
          </div>

          <div className="auth-hero-copy">
            <h2>Join the Operations Team</h2>
            <p>Manage fulfillment operations, monitor exception queues, and keep marketplace workflows smooth.</p>
          </div>

          <div className="auth-hero-tags" aria-label="Operations onboarding highlights">
            <span>Order Operations</span>
            <span>Issue Resolution</span>
            <span>Queue Monitoring</span>
            <span>Secure Access</span>
          </div>

          <p className="auth-hero-foot">Built for high-volume marketplace operations teams.</p>
        </aside>

        <section className="auth-portal-form-wrap">
          <div className="auth-portal-title-wrap">
            <p className="eyebrow">Operations onboarding</p>
            <h2>Create operations staff account</h2>
            <p>Sign up as operations staff to review order flow, exception queues, and support escalations.</p>
          </div>

          <div className="auth-card merchant-auth-card panel-stack auth-portal-form auth-portal-form-scroll">

            <div className="merchant-progress-card">
              <div className="merchant-progress-head">
                <div>
                  <p className="eyebrow">Profile completion tracker</p>
                  <h3>{progressPercent}% complete</h3>
                </div>
                <p>{completedSections} of {operationsSections.length} sections done</p>
              </div>
              <div className="merchant-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="merchant-progress-steps">
                {operationsSections.map((section, index) => (
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
              {activeSection === 0 ? (
                <div className="merchant-section-card merchant-section-open">
                  <div className="merchant-form-section">
                    <p className="eyebrow">Section 1</p>
                    <h2>Basic info</h2>
                  </div>
                  <div className="merchant-section-fields">
                    <Input label="Full name" type="text" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" required />
                    <Input label="Work email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ops@company.com" required />
                    <Input label="Phone number" type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile number" required />
                  </div>
                </div>
              ) : null}

              {activeSection === 1 ? (
                <div className="merchant-section-card merchant-section-open">
                  <div className="merchant-form-section">
                    <p className="eyebrow">Section 2</p>
                    <h2>Operations details</h2>
                  </div>
                  <div className="merchant-section-fields">
                    <Input label="Employee code" type="text" value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} placeholder="OPS-EMP-1024" required />
                    <Input label="Department" type="text" value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="Operations Control" required />
                    <Input label="City" type="text" value={city} onChange={(event) => setCity(event.target.value)} placeholder="City" required />
                    <Input label="State" type="text" value={state} onChange={(event) => setState(event.target.value)} placeholder="State" required />
                    <Input label="Pincode" type="text" value={pincode} onChange={(event) => setPincode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit pincode" required />
                  </div>
                </div>
              ) : null}

              {activeSection === 2 ? (
                <div className="merchant-section-card merchant-section-open">
                  <div className="merchant-form-section">
                    <p className="eyebrow">Section 3</p>
                    <h2>Security setup</h2>
                  </div>
                  <div className="merchant-section-fields">
                    <Input label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Create a password" required />
                    <Input label="Confirm password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" required />
                  </div>
                </div>
              ) : null}

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
                    Register as Operations Staff
                  </Button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={goToNextSection}>
                    Next
                  </button>
                )}
              </div>
            </form>

          <p className="merchant-cta-text">
            Want to sell on our platform?{' '}
            <NavLink to="/merchant-register" className="merchant-cta-link">
              Join as a Merchant
            </NavLink>
          </p>
          <p className="auth-switch-text">
            Already a member?{' '}
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
