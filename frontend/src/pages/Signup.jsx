import { useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import { findLocalAccountByEmail, setStoredUser, upsertLocalAccount } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const signupSections = [
  {
    title: 'Basic Info',
    fields: ['fullName', 'email'],
  },
  {
    title: 'Security Setup',
    fields: ['password', 'confirmPassword'],
  },
]

function isFilled(value) {
  return String(value || '').trim().length > 0
}

export default function Signup() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [activeSection, setActiveSection] = useState(0)
  const navigate = useNavigate()

  const values = {
    fullName,
    email,
    password,
    confirmPassword,
  }

  const requiredFields = useMemo(() => signupSections.flatMap((section) => section.fields), [])

  const sectionCompletion = useMemo(
    () => signupSections.map((section) => section.fields.every((fieldName) => isFilled(values[fieldName]))),
    [fullName, email, password, confirmPassword],
  )

  const completedRequiredCount = useMemo(
    () => requiredFields.filter((fieldName) => isFilled(values[fieldName])).length,
    [fullName, email, password, confirmPassword, requiredFields],
  )

  const progressPercent = Math.round((completedRequiredCount / requiredFields.length) * 100)
  const completedSections = sectionCompletion.filter(Boolean).length
  const isLastSection = activeSection === signupSections.length - 1

  function goToNextSection() {
    const currentFields = signupSections[activeSection].fields
    const missingCurrent = currentFields.filter((fieldName) => !isFilled(values[fieldName]))
    if (missingCurrent.length > 0) {
      setMessage('Please fill all required fields in this section to continue.')
      return
    }
    if (activeSection < signupSections.length - 1) {
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
      const firstMissingSectionIndex = signupSections.findIndex((section) => section.fields.includes(missing[0]))
      setActiveSection(firstMissingSectionIndex === -1 ? 0 : firstMissingSectionIndex)
      setMessage('Please fill all required details.')
      return
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match.')
      return
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
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        setMessage(data?.detail || 'Unable to create account.')
        return
      }

      if (data?.user) {
        setStoredUser(data.user)
      }

      setMessage(data.message || `Account created for ${fullName || 'your profile'}.`)
      navigate('/')
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
      })

      setStoredUser({
        full_name: localAccount.full_name,
        email: localAccount.email,
        provider: localAccount.provider,
      })
      setMessage(`Account created for ${localAccount.full_name}.`)
      navigate('/')
    }
  }

  return (
    <div className="auth-shell auth-shell-customer">
      <section className="auth-portal auth-portal-long" aria-label="Account registration portal">
        <aside className="auth-portal-hero auth-portal-hero-signup">
          <div className="auth-hero-head">
            <img className="auth-brand-logo" src="/movicloud%20logo.png" alt="Movi Fashion logo" />
            <div>
              <h3>Movi Fashion</h3>
              <p>E-Commerce Platform</p>
            </div>
          </div>

          <div className="auth-hero-copy">
            <h2>Create Your Customer Account</h2>
            <p>Register once to save favorites, track order updates, and checkout faster across devices.</p>
          </div>

          <div className="auth-hero-tags" aria-label="Registration highlights">
            <span>Fast Signup</span>
            <span>Wishlist Sync</span>
            <span>Order Alerts</span>
            <span>Secure Account</span>
          </div>

          <p className="auth-hero-foot">Simple setup with secure profile storage.</p>
        </aside>

        <section className="auth-portal-form-wrap">
          <div className="auth-portal-title-wrap">
            <p className="eyebrow">Account access</p>
            <h2>Create your account</h2>
            <p>Sign up to save your wishlist, track orders, and enjoy a faster checkout experience.</p>
          </div>

          <div className="auth-card merchant-auth-card panel-stack auth-portal-form auth-portal-form-scroll">
            <div className="merchant-progress-card">
              <div className="merchant-progress-head">
                <div>
                  <p className="eyebrow">Profile completion tracker</p>
                  <h3>{progressPercent}% complete</h3>
                </div>
                <p>{completedSections} of {signupSections.length} sections done</p>
              </div>
              <div className="merchant-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="merchant-progress-steps">
                {signupSections.map((section, index) => (
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
                    <Input
                      label="Full name"
                      type="text"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Your full name"
                      required
                    />
                    <Input
                      label="Email address"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@atelier.com"
                      required
                    />
                  </div>
                </div>
              ) : null}

              {activeSection === 1 ? (
                <div className="merchant-section-card merchant-section-open">
                  <div className="merchant-form-section">
                    <p className="eyebrow">Section 2</p>
                    <h2>Security setup</h2>
                  </div>
                  <div className="merchant-section-fields">
                    <Input
                      label="Password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Create a password"
                      required
                    />
                    <Input
                      label="Confirm password"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Repeat your password"
                      required
                    />
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
                    Sign Up
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
          <p className="merchant-cta-text">
            Want to join our last-mile fleet?{' '}
            <NavLink to="/delivery-register" className="merchant-cta-link">
              Join as a Delivery Associate
            </NavLink>
          </p>
          <p className="merchant-cta-text">
            Want to work in operations control?{' '}
            <NavLink to="/operations-register" className="merchant-cta-link">
              Join as Operations Staff
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
