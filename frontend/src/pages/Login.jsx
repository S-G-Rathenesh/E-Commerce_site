import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()

    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json()
      setMessage(data.message || 'Login complete')

      const role = (data.role || 'user').toLowerCase()
      navigate(role === 'merchant' ? '/admin' : '/')
    } catch {
      setMessage('Backend unavailable, demo mode active.')

      const demoRole = email.toLowerCase().includes('merchant') ? 'merchant' : 'user'
      navigate(demoRole === 'merchant' ? '/admin' : '/')
    }
  }

  return (
    <div className="auth-shell">
      <PageWrapper
        eyebrow="Account access"
        title="Sign in to your account"
        description="A centered login form with unified spacing, card styling, and the same button/input system used across the storefront."
        className="narrow"
      >
        <section className="auth-card panel-stack">
          <div>
            <p className="eyebrow">Welcome back</p>
            <h2>Access your account</h2>
          </div>
          <form onSubmit={handleSubmit} className="form-grid">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@atelier.com"
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
              Sign In
            </Button>
          </form>
          {message ? <p className="login-message">{message}</p> : null}
        </section>
      </PageWrapper>
    </div>
  )
}
