import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ImageUploadField from '../components/ImageUploadField'
import PageWrapper from '../components/PageWrapper'
import { buildAuthHeaders, clearStoredUser, getStoredUser, setStoredUser } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const PINCODE_REGEX = /^[1-9][0-9]{5}$/

const EMPTY_PROFILE_FORM = {
  full_name: '',
  phone_number: '',
  vehicle_type: 'BIKE',
  vehicle_number: '',
  driving_license_number: '',
  availability: 'FULL_TIME',
  profile_image_url: '',
  city: '',
  state: '',
  allow_all_india: false,
  service_pincodes: [],
}

function sanitizePincode(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 6)
}

function buildFormFromProfile(nextUser, nextProfile, currentForm = EMPTY_PROFILE_FORM) {
  return {
    ...currentForm,
    full_name: nextUser?.full_name || nextProfile?.full_name || currentForm.full_name || '',
    phone_number: nextProfile?.phone_number || nextUser?.phone_number || currentForm.phone_number || '',
    vehicle_type: nextProfile?.vehicle_type || currentForm.vehicle_type || 'BIKE',
    vehicle_number: nextProfile?.vehicle_number || currentForm.vehicle_number || '',
    driving_license_number: nextProfile?.driving_license_number || currentForm.driving_license_number || '',
    availability: nextProfile?.availability || currentForm.availability || 'FULL_TIME',
    profile_image_url: nextProfile?.profile_image_url || currentForm.profile_image_url || '',
    city: nextProfile?.city || nextUser?.city || currentForm.city || '',
    state: nextProfile?.state || nextUser?.state || currentForm.state || '',
    allow_all_india:
      Boolean(nextProfile?.allow_all_india || String(nextProfile?.service_scope || '').toUpperCase() === 'ALL_INDIA') ||
      currentForm.allow_all_india,
    service_pincodes:
      Array.isArray(nextProfile?.service_pincodes) && nextProfile.service_pincodes.length > 0
        ? nextProfile.service_pincodes
        : currentForm.service_pincodes,
  }
}

export default function DeliveryProfile() {
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [newPincode, setNewPincode] = useState('')
  const [form, setForm] = useState(EMPTY_PROFILE_FORM)

  const draftStorageKey = useMemo(() => {
    const storedUser = getStoredUser()
    const idPart = String(currentUser?.id || storedUser?.id || currentUser?.email || storedUser?.email || 'delivery').trim()
    return `delivery_profile_draft_${idPart}`
  }, [currentUser?.email, currentUser?.id])

  const profileDetails = currentUser?.profile_details || {}
  const coverageLabel = useMemo(() => {
    if (form.allow_all_india) {
      return 'All India coverage enabled'
    }
    if (form.service_pincodes.length === 0) {
      return 'Add at least one service pincode'
    }
    return `${form.service_pincodes.length} service pincodes active`
  }, [form.allow_all_india, form.service_pincodes.length])

  const refreshAccessToken = async () => {
    const user = getStoredUser()
    const refreshToken = String(user?.refresh_token || '').trim()
    if (!refreshToken) {
      return false
    }

    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      const data = await response.json()
      if (!response.ok || !data?.token) {
        return false
      }

      setStoredUser({
        ...(user || {}),
        ...(data?.user || {}),
        token: data.token,
        refresh_token: data.refresh_token || refreshToken,
      })
      setCurrentUser(getStoredUser())
      return true
    } catch {
      return false
    }
  }

  const requestWithAuth = async (url, options = {}) => {
    const headers = buildAuthHeaders(options.headers || {})
    let response = await fetch(url, { ...options, headers })
    if (response.status !== 401) {
      return response
    }

    const refreshed = await refreshAccessToken()
    if (!refreshed) {
      clearStoredUser()
      navigate('/login', { replace: true })
      throw new Error('Auth expired')
    }

    response = await fetch(url, {
      ...options,
      headers: buildAuthHeaders(options.headers || {}),
    })
    return response
  }

  const loadProfile = async () => {
    setLoading(true)
    try {
      const response = await requestWithAuth(`${API_BASE}/delivery/profile`, {
        method: 'GET',
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load your delivery profile.')
        return
      }

      const nextUser = data?.user || getStoredUser()
      const nextProfile = data?.profile_details || nextUser?.profile_details || {}
      const storedUser = getStoredUser()
      const mergedUser = {
        ...(storedUser || {}),
        ...(nextUser || {}),
        token: storedUser?.token || nextUser?.token || '',
        refresh_token: storedUser?.refresh_token || nextUser?.refresh_token || '',
      }
      setCurrentUser(mergedUser)
      setStoredUser(mergedUser)
      const rawDraft = window.localStorage.getItem(draftStorageKey)
      const draft = rawDraft ? JSON.parse(rawDraft) : null
      const nextForm = buildFormFromProfile(nextUser, nextProfile, draft || EMPTY_PROFILE_FORM)
      setForm(nextForm)
      setMessage('')
    } catch {
      const storedUser = getStoredUser() || currentUser || {}
      const storedProfile = storedUser?.profile_details || {}
      const rawDraft = window.localStorage.getItem(draftStorageKey)
      const draft = rawDraft ? JSON.parse(rawDraft) : null
      const fallbackForm = buildFormFromProfile(storedUser, storedProfile, draft || EMPTY_PROFILE_FORM)
      setForm(fallbackForm)
      setMessage('Unable to load your delivery profile from server. Showing saved local details.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const initialize = async () => {
      const stored = getStoredUser()
      if (!stored) {
        navigate('/login', { replace: true })
        return
      }
      setCurrentUser(stored)
      await loadProfile()
    }

    initialize()
  }, [navigate])

  useEffect(() => {
    if (!draftStorageKey) {
      return
    }
    window.localStorage.setItem(draftStorageKey, JSON.stringify(form))
  }, [draftStorageKey, form])

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleAddPincode = () => {
    const cleaned = sanitizePincode(newPincode)
    if (!PINCODE_REGEX.test(cleaned)) {
      setMessage('Enter a valid 6-digit pincode.')
      return
    }
    setForm((current) => {
      if (current.service_pincodes.includes(cleaned)) {
        return current
      }
      return {
        ...current,
        service_pincodes: [...current.service_pincodes, cleaned],
        allow_all_india: false,
      }
    })
    setNewPincode('')
    setMessage('')
  }

  const handleRemovePincode = (pincode) => {
    setForm((current) => ({
      ...current,
      service_pincodes: current.service_pincodes.filter((entry) => entry !== pincode),
    }))
  }

  const handleToggleAllIndia = () => {
    setForm((current) => ({
      ...current,
      allow_all_india: !current.allow_all_india,
      service_pincodes: !current.allow_all_india ? [] : current.service_pincodes,
    }))
  }

  const handleSaveProfile = async (event) => {
    event.preventDefault()
    if (imageUploading) {
      setMessage('Please wait for the image upload to finish before saving.')
      return
    }
    setSaving(true)
    setMessage('')

    try {
      const payload = {
        full_name: form.full_name,
        phone_number: form.phone_number,
        vehicle_type: form.vehicle_type,
        vehicle_number: form.vehicle_number,
        driving_license_number: form.driving_license_number,
        availability: form.availability,
        profile_image_url: form.profile_image_url,
        city: form.city,
        state: form.state,
        allow_all_india: form.allow_all_india,
        service_pincodes: form.allow_all_india ? [] : form.service_pincodes,
      }

      const response = await requestWithAuth(`${API_BASE}/delivery/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const data = await response.json()

      if (!response.ok) {
        setMessage(data?.detail || 'Unable to save your delivery profile.')
        return
      }

      if (data?.user) {
        const storedUser = getStoredUser()
        const mergedUser = {
          ...(storedUser || {}),
          ...data.user,
          token: storedUser?.token || data.user?.token || '',
          refresh_token: storedUser?.refresh_token || data.user?.refresh_token || '',
        }
        setCurrentUser(mergedUser)
        setStoredUser(mergedUser)
      }
      setForm((current) => ({
        ...current,
        service_pincodes: Array.isArray(data?.profile_details?.service_pincodes)
          ? data.profile_details.service_pincodes
          : current.service_pincodes,
        allow_all_india: Boolean(data?.profile_details?.allow_all_india || current.allow_all_india),
      }))
      window.localStorage.removeItem(draftStorageKey)
      setMessage('Delivery profile saved successfully.')
    } catch {
      setMessage('Unable to save your delivery profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageWrapper
      className="page-delivery"
      eyebrow="Delivery"
      title="Delivery profile"
      description="Manage your route coverage, vehicle details, and public profile information from one place."
    >
      <section className="panel panel-stack">
        <div className="section-head">
          <div>
            <h2>Partner identity</h2>
            <p>{profileDetails.full_name || currentUser?.full_name || 'Delivery partner account'}</p>
          </div>
          <div className="row-gap">
            <Link to="/delivery/dashboard" className="btn btn-secondary">
              Back to dashboard
            </Link>
          </div>
        </div>

        {loading ? <p>Loading delivery profile...</p> : null}
        {message ? <p className="wishlist-message">{message}</p> : null}

        <form className="admin-orders-stack" onSubmit={handleSaveProfile}>
          <div className="dashboard-grid">
            <article className="section-card panel-stack">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Profile photo</p>
                  <h3>Visible on the delivery network</h3>
                </div>
              </div>
              <ImageUploadField
                label="Profile image"
                value={form.profile_image_url}
                onChange={(nextValue) => updateField('profile_image_url', nextValue)}
                onUploadingChange={setImageUploading}
                description="Upload a profile image or paste a hosted URL."
              />
            </article>

            <article className="section-card panel-stack">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Coverage</p>
                  <h3>{coverageLabel}</h3>
                </div>
              </div>
              <label className="field-group">
                <span className="field-label">Service coverage</span>
                <button type="button" className={`btn ${form.allow_all_india ? 'btn-primary' : 'btn-secondary'}`} onClick={handleToggleAllIndia}>
                  {form.allow_all_india ? 'All India enabled' : 'Switch to All India'}
                </button>
              </label>
              <label className="field-group">
                <span className="field-label">Add service pincode</span>
                <div className="row-gap">
                  <input
                    className="field"
                    value={newPincode}
                    onChange={(event) => setNewPincode(sanitizePincode(event.target.value))}
                    placeholder="560001"
                    disabled={form.allow_all_india}
                  />
                  <button type="button" className="btn btn-secondary" onClick={handleAddPincode} disabled={form.allow_all_india}>
                    Add
                  </button>
                </div>
              </label>
              <div className="row-gap" style={{ flexWrap: 'wrap' }}>
                {form.service_pincodes.map((pincode) => (
                  <button
                    key={pincode}
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleRemovePincode(pincode)}
                  >
                    {pincode} ×
                  </button>
                ))}
              </div>
            </article>
          </div>

          <div className="dashboard-grid">
            <label className="field-group">
              <span className="field-label">Full name</span>
              <input className="field" value={form.full_name} onChange={(event) => updateField('full_name', event.target.value)} />
            </label>
            <label className="field-group">
              <span className="field-label">Phone number</span>
              <input className="field" value={form.phone_number} onChange={(event) => updateField('phone_number', event.target.value)} />
            </label>
            <label className="field-group">
              <span className="field-label">Vehicle type</span>
              <select className="field" value={form.vehicle_type} onChange={(event) => updateField('vehicle_type', event.target.value)}>
                <option value="BIKE">Bike</option>
                <option value="CYCLE">Cycle</option>
                <option value="VAN">Van</option>
              </select>
            </label>
            <label className="field-group">
              <span className="field-label">Vehicle number</span>
              <input className="field" value={form.vehicle_number} onChange={(event) => updateField('vehicle_number', event.target.value)} />
            </label>
            <label className="field-group">
              <span className="field-label">Driving license</span>
              <input className="field" value={form.driving_license_number} onChange={(event) => updateField('driving_license_number', event.target.value)} />
            </label>
            <label className="field-group">
              <span className="field-label">Availability</span>
              <select className="field" value={form.availability} onChange={(event) => updateField('availability', event.target.value)}>
                <option value="FULL_TIME">Full-time</option>
                <option value="PART_TIME">Part-time</option>
              </select>
            </label>
            <label className="field-group">
              <span className="field-label">City</span>
              <input className="field" value={form.city} onChange={(event) => updateField('city', event.target.value)} />
            </label>
            <label className="field-group">
              <span className="field-label">State</span>
              <input className="field" value={form.state} onChange={(event) => updateField('state', event.target.value)} />
            </label>
          </div>

          <div className="row-gap">
            <button type="submit" className="btn btn-primary" disabled={saving || imageUploading}>
              {imageUploading ? 'Upload in progress...' : saving ? 'Saving...' : 'Save delivery profile'}
            </button>
            <Link to="/delivery/dashboard" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </PageWrapper>
  )
}
