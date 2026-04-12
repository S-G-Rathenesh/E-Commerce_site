import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'
import { findLocalAccountByEmail, setStoredUser } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

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
      const response = await fetch(`${API_BASE}/login`, {
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
        setStoredUser(data.user)
      }

      setMessage(data.message || 'Login complete')

      const role = (data.role || 'user').toLowerCase()
      navigate(role === 'merchant' ? '/admin' : '/')
    } catch {
      const localAccount = findLocalAccountByEmail(email)

      if (!localAccount) {
        setMessage('No account found. Create a new account using Sign up.')
        setNeedsSignup(true)
        return
      }

      if (localAccount.provider === 'email' && localAccount.password !== password) {
        setMessage('Invalid email or password.')
        setNeedsSignup(false)
        return
      }

      setStoredUser({
        full_name: localAccount.full_name,
        email: localAccount.email,
        provider: localAccount.provider,
        role: localAccount.role || 'user',
      })
      setMessage(`Welcome back, ${localAccount.full_name}!`)
      setNeedsSignup(false)
      const role = (localAccount.role || 'user').toLowerCase()
      navigate(role === 'merchant' ? '/admin' : '/')
    }
  }

  return (
    <div className="auth-shell">
      <PageWrapper
        eyebrow="Login"
        title="Welcome back"
        description=""
        className="narrow"
      >
        <section className="auth-card panel-stack">
          <div>
            <p className="eyebrow">Sign In</p>
            <h2>Access your account</h2>
            <p>Login to view your wishlist, orders, and personalized offers.</p>
          </div>
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
              <strong>Merchant:</strong> merchant.demo@veloura.com / Merchant@2026
            </p>
            <p>
              <strong>User:</strong> user.demo@veloura.com / User@2026
            </p>
          </div>
          <p className="auth-switch-text">
            New to Veloura?{' '}
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
        </section>
      </PageWrapper>
    </div>
  )
}
