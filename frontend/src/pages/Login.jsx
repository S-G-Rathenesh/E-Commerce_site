import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import { setStoredUser } from '../utils/auth'
import { getSuperAdminSecretPath } from '../utils/platform'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const DEMO_LOGIN_ACCOUNTS = [
  {
    label: 'Admin',
    role: 'admin',
    email: 'admin.demo@veloura.com',
    password: 'Admin#Demo2026',
  },
  {
    label: 'Super Admin',
    role: 'super_admin',
    email: 'superadmin.demo@veloura.com',
    password: 'SuperAdmin#Demo2026',
  },
  {
    label: 'Customer',
    role: 'customer',
    email: 'customer.demo@veloura.com',
    password: 'Customer#Demo2026',
  },
  {
    label: 'Delivery',
    role: 'delivery',
    email: 'delivery.demo@veloura.com',
    password: 'Delivery#Demo2026',
  },
  {
    label: 'Operations',
    role: 'operations',
    email: 'ops.demo@veloura.com',
    password: 'Ops#Demo2026',
  },
]

function redirectPathByRole(role) {
  const nextRole = String(role || '').trim().toLowerCase()
  if (nextRole === 'super_admin' || nextRole === 'superadmin') {
    return getSuperAdminSecretPath()
  }
  if (nextRole === 'admin' || nextRole === 'merchant') {
    return '/admin'
  }
  if (nextRole === 'delivery' || nextRole === 'delivery_associate') {
    return '/delivery'
  }
  if (nextRole === 'operations' || nextRole === 'operations_staff' || nextRole === 'staff') {
    return '/operations'
  }
  return '/'
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [needsSignup, setNeedsSignup] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isAutofillAnimating, setIsAutofillAnimating] = useState(false)
  const autofillTimerRef = useRef(null)
  const navigate = useNavigate()

  useEffect(
    () => () => {
      if (autofillTimerRef.current) {
        clearTimeout(autofillTimerRef.current)
      }
    },
    [],
  )

  function getDemoAccountByRole(role) {
    const targetRole = String(role || '').trim().toLowerCase()
    return DEMO_LOGIN_ACCOUNTS.find((account) => account.role === targetRole) || null
  }

  function applyDemoCredentials(account) {
    if (!account) {
      return
    }

    setEmail(account.email)
    setPassword(account.password)
    setIsAutofillAnimating(true)

    if (autofillTimerRef.current) {
      clearTimeout(autofillTimerRef.current)
    }

    autofillTimerRef.current = setTimeout(() => {
      setIsAutofillAnimating(false)
      autofillTimerRef.current = null
    }, 700)
  }

  async function loginWithCredentials(nextEmail, nextPassword) {
    if (isLoggingIn) {
      return
    }

    setNeedsSignup(false)
    setIsLoggingIn(true)

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: nextEmail, password: nextPassword }),
      })

      const data = await response.json()

      if (!response.ok) {
        const detail = data?.detail || 'Unable to login.'
        setNeedsSignup(response.status === 404)
        setMessage(detail)
        return
      }

      if (data?.user) {
        setStoredUser({
          ...data.user,
          role: data.role || data?.user?.role || 'user',
          status: data.status || data?.user?.status || 'ACTIVE',
          token: data.token || '',
          refresh_token: data.refresh_token || '',
        })
      }

      setMessage(data.message || 'Login complete')

      const role = (data.role || 'user').toLowerCase()
      navigate(redirectPathByRole(role))
    } catch {
      setMessage('Unable to reach auth service. Please try again.')
      setNeedsSignup(false)
    } finally {
      setIsLoggingIn(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    await loginWithCredentials(email, password)
  }

  function handleDemoRoleClick(role) {
    applyDemoCredentials(getDemoAccountByRole(role))
  }

  return (
    <div className="auth-shell auth-shell-customer">
      <section className="auth-portal" aria-label="Account login portal">
        <aside className="auth-portal-hero">
          <div className="auth-hero-head">
            <img className="auth-brand-logo" src="/movicloud%20logo.png" alt="Movi Fashion logo" />
            <div>
              <h3>Movi Fashion</h3>
              <p>E-Commerce Platform</p>
            </div>
          </div>

          <div className="auth-hero-copy">
            <h2>Secure Customer Account Access</h2>
            <p>Login to manage your wishlist, track orders, and continue checkout with your saved profile.</p>
          </div>

          <div className="auth-hero-tags" aria-label="Security highlights">
            <span>Secure Login</span>
            <span>Role Based Access</span>
            <span>Order Tracking</span>
            <span>Profile Sync</span>
          </div>

          <p className="auth-hero-foot">Trusted by users across web and mobile checkout.</p>
        </aside>

        <section className="auth-portal-form-wrap">
          <div className="auth-portal-title-wrap">
            <p className="eyebrow">Login</p>
            <h2>Welcome Back</h2>
            <p>Sign in to access your Movi Fashion account dashboard.</p>
          </div>

          <div className="auth-card panel-stack auth-portal-form">
          <form onSubmit={handleSubmit} className="form-grid">
            <Input
              label="Email or username"
              type="text"
              className={isAutofillAnimating ? 'demo-autofill-flash' : ''}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              required
            />
            <Input
              label="Password"
              type="password"
              className={isAutofillAnimating ? 'demo-autofill-flash' : ''}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
            <Button type="submit" variant="primary" className="btn-wide">
              {isLoggingIn ? 'Logging in...' : 'Login'}
            </Button>
          </form>

          <div className="login-demo-accounts" aria-label="Demo testing accounts">
            <p className="eyebrow">Demo Accounts (Testing)</p>
            <div className="login-demo-controls">
              <p className="auth-switch-text">
                Quick fill:{' '}
                {DEMO_LOGIN_ACCOUNTS.map((account, index) => (
                  <span key={account.role}>
                    {index > 0 ? ' · ' : ''}
                    <button
                      type="button"
                      className="merchant-cta-link demo-role-link"
                      onClick={() => handleDemoRoleClick(account.role)}
                    >
                      {account.label}
                    </button>
                  </span>
                ))}
              </p>
            </div>
          </div>

          <p className="auth-switch-text">
            New to Movi Fashion?{' '}
            <NavLink to="/signup" className="merchant-cta-link">
              Create an account
            </NavLink>
          </p>
          {message ? <p className="login-message">{message}</p> : null}
          {needsSignup ? (
            <p className="auth-switch-text">
              No account found.{' '}
              <NavLink to="/signup" className="merchant-cta-link">
                Sign up
              </NavLink>
            </p>
          ) : null}
          </div>
        </section>
      </section>
    </div>
  )
}
