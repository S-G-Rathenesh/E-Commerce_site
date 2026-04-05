import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'

export default function Signup() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')

  function handleSubmit(event) {
    event.preventDefault()

    if (password !== confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }

    setMessage(`Account created for ${fullName || 'your profile'} (demo).`)
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
