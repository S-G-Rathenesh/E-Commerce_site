import { useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Input from '../components/Input'
import { findLocalAccountByEmail, upsertLocalAccount } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const deliverySections = [
  {
    title: 'Basic Info',
    fields: ['fullName', 'email', 'phoneNumber', 'pincode'],
  },
  {
    title: 'Identity & Vehicle',
    fields: ['aadhaarNumber', 'idProofFile', 'vehicleType', 'vehicleNumber', 'drivingLicenseNumber'],
  },
  {
    title: 'Availability & Security',
    fields: ['availability', 'servicePincodes', 'password', 'confirmPassword'],
  },
]

function isFilled(value) {
  if (value instanceof File) return true
  return String(value || '').trim().length > 0
}

export default function DeliveryRegister() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [pincode, setPincode] = useState('')
  const [aadhaarNumber, setAadhaarNumber] = useState('')
  const [idProofFile, setIdProofFile] = useState(null)
  const [vehicleType, setVehicleType] = useState('')
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [drivingLicenseNumber, setDrivingLicenseNumber] = useState('')
  const [availability, setAvailability] = useState('')
  const [servicePincodes, setServicePincodes] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [activeSection, setActiveSection] = useState(0)
  const navigate = useNavigate()

  const values = {
    fullName,
    email,
    phoneNumber,
    pincode,
    aadhaarNumber,
    idProofFile,
    vehicleType,
    vehicleNumber,
    drivingLicenseNumber,
    availability,
    servicePincodes,
    password,
    confirmPassword,
  }

  const requiredFields = useMemo(() => deliverySections.flatMap((section) => section.fields), [])

  const sectionCompletion = useMemo(
    () => deliverySections.map((section) => section.fields.every((fieldName) => isFilled(values[fieldName]))),
    [
      fullName,
      email,
      phoneNumber,
      pincode,
      aadhaarNumber,
      idProofFile,
      vehicleType,
      vehicleNumber,
      drivingLicenseNumber,
      availability,
      servicePincodes,
      password,
      confirmPassword,
    ],
  )

  const completedRequiredCount = useMemo(
    () => requiredFields.filter((fieldName) => isFilled(values[fieldName])).length,
    [
      fullName,
      email,
      phoneNumber,
      pincode,
      aadhaarNumber,
      idProofFile,
      vehicleType,
      vehicleNumber,
      drivingLicenseNumber,
      availability,
      servicePincodes,
      password,
      confirmPassword,
      requiredFields,
    ],
  )

  const progressPercent = Math.round((completedRequiredCount / requiredFields.length) * 100)
  const completedSections = sectionCompletion.filter(Boolean).length
  const isLastSection = activeSection === deliverySections.length - 1

  function goToNextSection() {
    const currentFields = deliverySections[activeSection].fields
    const missingCurrent = currentFields.filter((fieldName) => !isFilled(values[fieldName]))
    if (missingCurrent.length > 0) {
      setMessage('Please fill all required fields in this section to continue.')
      return
    }
    if (activeSection < deliverySections.length - 1) {
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
      const firstMissingSectionIndex = deliverySections.findIndex((section) => section.fields.includes(missing[0]))
      setActiveSection(firstMissingSectionIndex === -1 ? 0 : firstMissingSectionIndex)
      setMessage('Please fill all required details.')
      return
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }

    const normalizedPhone = phoneNumber.replace(/\D/g, '').slice(0, 10)
    const normalizedPrimaryPincode = pincode.replace(/\D/g, '').slice(0, 6)
    const normalizedAadhaar = aadhaarNumber.replace(/\D/g, '').slice(0, 12)
    const parsedServicePincodes = servicePincodes
      .split(',')
      .map((entry) => entry.replace(/\D/g, '').slice(0, 6))
      .filter(Boolean)

    if (normalizedPhone.length !== 10) {
      setMessage('Phone number must be exactly 10 digits.')
      return
    }

    if (normalizedPrimaryPincode.length !== 6) {
      setMessage('Service pincode must be exactly 6 digits.')
      return
    }

    if (normalizedAadhaar.length !== 12) {
      setMessage('Aadhaar number must be exactly 12 digits.')
      return
    }

    if (!idProofFile) {
      setMessage('ID proof upload is required.')
      return
    }

    if (!vehicleNumber.trim() || !drivingLicenseNumber.trim()) {
      setMessage('Vehicle and driving license details are required.')
      return
    }

    if (!parsedServicePincodes.length) {
      setMessage('Enter at least one service pincode.')
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
          role: 'DELIVERY_ASSOCIATE',
          phone_number: normalizedPhone,
          pincode: normalizedPrimaryPincode,
          profile_details: {
            service_pincode: normalizedPrimaryPincode,
            service_pincodes: parsedServicePincodes,
            phone_number: normalizedPhone,
            aadhaar_number: normalizedAadhaar,
            vehicle_type: vehicleType,
            vehicle_number: vehicleNumber,
            driving_license_number: drivingLicenseNumber,
            availability,
            id_proof_upload: {
              name: idProofFile.name,
              type: idProofFile.type,
              size: idProofFile.size,
            },
          },
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        setMessage(data?.detail || 'Unable to create delivery account.')
        return
      }

      setMessage(data.message || 'Your account will be activated after verification')
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
        role: 'delivery_associate',
        status: 'PENDING',
      })

      setMessage('Your account will be activated after verification')
      navigate('/login')
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-portal auth-portal-long" aria-label="Delivery account registration portal">
        <aside className="auth-portal-hero auth-portal-hero-signup">
          <div className="auth-hero-head">
            <img className="auth-brand-logo" src="/movicloud%20logo.png" alt="Movi Fashion logo" />
            <div>
              <h3>Movi Fashion</h3>
              <p>E-Commerce Platform</p>
            </div>
          </div>

          <div className="auth-hero-copy">
            <h2>Become a Delivery Associate</h2>
            <p>Register to receive last-mile assignments and update live shipment delivery statuses.</p>
          </div>

          <div className="auth-hero-tags" aria-label="Delivery onboarding highlights">
            <span>Delivery Network</span>
            <span>Assigned Orders</span>
            <span>Status Updates</span>
            <span>Secure Access</span>
          </div>

          <p className="auth-hero-foot">Quick onboarding for verified delivery partners.</p>
        </aside>

        <section className="auth-portal-form-wrap">
          <div className="auth-portal-title-wrap">
            <p className="eyebrow">Delivery onboarding</p>
            <h2>Create delivery associate account</h2>
            <p>Sign up as a delivery associate to receive assigned orders and update shipment statuses.</p>
          </div>

          <div className="auth-card merchant-auth-card panel-stack auth-portal-form auth-portal-form-scroll">

            <div className="merchant-progress-card">
              <div className="merchant-progress-head">
                <div>
                  <p className="eyebrow">Profile completion tracker</p>
                  <h3>{progressPercent}% complete</h3>
                </div>
                <p>{completedSections} of {deliverySections.length} sections done</p>
              </div>
              <div className="merchant-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="merchant-progress-steps">
                {deliverySections.map((section, index) => (
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
                      placeholder="delivery@company.com"
                      required
                    />
                    <Input
                      label="Phone number"
                      type="tel"
                      value={phoneNumber}
                      onChange={(event) => setPhoneNumber(event.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="10-digit mobile number"
                      required
                    />
                    <Input
                      label="Service pincode"
                      type="text"
                      value={pincode}
                      onChange={(event) => setPincode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6-digit pincode"
                      required
                    />
                  </div>
                </div>
              ) : null}

              {activeSection === 1 ? (
                <div className="merchant-section-card merchant-section-open">
                  <div className="merchant-form-section">
                    <p className="eyebrow">Section 2</p>
                    <h2>Identity and vehicle details</h2>
                  </div>
                  <div className="merchant-section-fields">
                    <Input
                      label="Aadhaar Number"
                      type="text"
                      value={aadhaarNumber}
                      onChange={(event) => setAadhaarNumber(event.target.value.replace(/\D/g, '').slice(0, 12))}
                      placeholder="12-digit Aadhaar number"
                      required
                    />
                    <label className="field-group">
                      <span className="field-label">ID Proof Upload</span>
                      <input
                        className="field"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={(event) => setIdProofFile(event.target.files?.[0] || null)}
                        required
                      />
                    </label>
                    <label className="field-group">
                      <span className="field-label">Vehicle Type</span>
                      <select
                        className="field"
                        value={vehicleType}
                        onChange={(event) => setVehicleType(event.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Select vehicle type
                        </option>
                        <option value="Bike">Bike</option>
                        <option value="Cycle">Cycle</option>
                        <option value="Van">Van</option>
                      </select>
                    </label>
                    <Input
                      label="Vehicle Number"
                      type="text"
                      value={vehicleNumber}
                      onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())}
                      placeholder="Vehicle registration number"
                      required
                    />
                    <Input
                      label="Driving License Number"
                      type="text"
                      value={drivingLicenseNumber}
                      onChange={(event) => setDrivingLicenseNumber(event.target.value.toUpperCase())}
                      placeholder="Driving license number"
                      required
                    />
                  </div>
                </div>
              ) : null}

              {activeSection === 2 ? (
                <div className="merchant-section-card merchant-section-open">
                  <div className="merchant-form-section">
                    <p className="eyebrow">Section 3</p>
                    <h2>Availability and security</h2>
                  </div>
                  <div className="merchant-section-fields">
                    <div className="field-group">
                      <span className="field-label">Availability</span>
                      <div className="row-gap">
                        <label>
                          <input
                            type="radio"
                            name="availability"
                            value="Full-time"
                            checked={availability === 'Full-time'}
                            onChange={(event) => setAvailability(event.target.value)}
                          />{' '}
                          Full-time
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="availability"
                            value="Part-time"
                            checked={availability === 'Part-time'}
                            onChange={(event) => setAvailability(event.target.value)}
                          />{' '}
                          Part-time
                        </label>
                      </div>
                    </div>
                    <Input
                      label="Service pincodes"
                      type="text"
                      value={servicePincodes}
                      onChange={(event) => setServicePincodes(event.target.value)}
                      placeholder="560001,560002,560003"
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
                    Register as Delivery Associate
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
