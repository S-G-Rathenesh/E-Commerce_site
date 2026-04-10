import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'
import { findLocalAccountByEmail, setStoredUser, upsertLocalAccount } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export default function Signup() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()

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
    <div className="auth-shell">
      <PageWrapper
        eyebrow="Account access"
        title="Create your account"
        description="Sign up to save your wishlist, track orders, and enjoy a faster checkout experience."
        className="narrow"
      >
        <section className="auth-card panel-stack">
          <div>
            <p className="eyebrow">Join now</p>
            <h2>Set up your profile</h2>
          </div>
          <form onSubmit={handleSubmit} className="form-grid">
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
            <Button type="submit" variant="primary" className="btn-wide">
              Sign Up
            </Button>
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
        </section>
      </PageWrapper>
    </div>
  )
}
