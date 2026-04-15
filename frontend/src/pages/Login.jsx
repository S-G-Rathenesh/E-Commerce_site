import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import { setStoredUser } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

function redirectPathByRole(role) {
  const nextRole = String(role || '').trim().toLowerCase()
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
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()
    setNeedsSignup(false)

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
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
        })
      }

      setMessage(data.message || 'Login complete')

      const role = (data.role || 'user').toLowerCase()
      navigate(redirectPathByRole(role))
    } catch {
      setMessage('Unable to reach auth service. Please try again.')
      setNeedsSignup(false)
    }
  }

  return (
    <div className="auth-shell">
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
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
            <Button type="submit" variant="primary" className="btn-wide">
              Login
            </Button>
          </form>

          <div className="login-demo-accounts" aria-label="Demo testing accounts">
            <p className="eyebrow">Demo Accounts (Testing)</p>
            <p>
              <strong>Admin:</strong> admin.demo@veloura.com / Admin#Demo2026
            </p>
            <p>
              <strong>User:</strong> customer.demo@veloura.com / Customer#Demo2026
            </p>
            <p>
              <strong>Delivery:</strong> delivery.demo@veloura.com / Delivery#Demo2026
            </p>
            <p>
              <strong>Operations:</strong> ops.demo@veloura.com / Ops#Demo2026
            </p>
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
