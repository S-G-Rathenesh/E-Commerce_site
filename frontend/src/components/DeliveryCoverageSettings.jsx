import { useEffect, useMemo, useState } from 'react'
import { buildAuthHeaders } from '../utils/auth'
import { INDIA_STATE_CITY_MAP, INDIA_STATES } from '../data/indiaLocations'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const defaultForm = {
  deliveryScope: 'NATIONWIDE',
  selectedStates: [],
  deliverAllCitiesInSelectedStates: false,
  cityScopedStates: [],
  selectedCities: [],
}

const toCityKey = (state, city) => `${state}::${city}`

const splitCityKey = (value) => {
  const [state, city] = String(value || '').split('::')
  return { state: state || '', city: city || '' }
}

const readMultiSelectValues = (event) =>
  Array.from(event.target.selectedOptions || []).map((option) => option.value)

export default function DeliveryCoverageSettings() {
  const [form, setForm] = useState(defaultForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const availableCities = useMemo(() => {
    const selected = form.cityScopedStates.length ? form.cityScopedStates : []
    const merged = []

    selected.forEach((stateName) => {
      const cities = INDIA_STATE_CITY_MAP[stateName] || []
      cities.forEach((cityName) => {
        merged.push({
          key: toCityKey(stateName, cityName),
          state: stateName,
          city: cityName,
        })
      })
    })

    return merged
  }, [form.cityScopedStates])

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(`${API_BASE}/admin/delivery-coverage`, {
          headers: buildAuthHeaders(),
        })
        const data = await response.json()
        if (!response.ok) {
          setMessage(data?.detail || 'Unable to load delivery coverage settings.')
          return
        }

        const scope = String(data?.delivery_scope || 'NATIONWIDE').toUpperCase()
        const states = Array.isArray(data?.states) ? data.states : []
        const cities = Array.isArray(data?.cities) ? data.cities : []
        const cityKeys = cities
          .map((entry) => toCityKey(String(entry?.state || '').trim(), String(entry?.city || '').trim()))
          .filter((value) => value !== '::')

        setForm({
          deliveryScope: scope,
          selectedStates: states,
          deliverAllCitiesInSelectedStates: Boolean(data?.deliver_all_cities_in_selected_states),
          cityScopedStates: states,
          selectedCities: cityKeys,
        })
        setMessage('')
      } catch {
        setMessage('Unable to load delivery coverage settings.')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [])

  const handleScopeChange = (scopeValue) => {
    setMessage('')
    setForm((current) => ({
      ...current,
      deliveryScope: scopeValue,
    }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    const scope = form.deliveryScope
    const cityObjects = form.selectedCities.map((value) => splitCityKey(value)).filter((entry) => entry.state && entry.city)

    const payload = {
      delivery_scope: scope,
      states: scope === 'STATE' ? form.selectedStates : scope === 'CITY' ? form.cityScopedStates : [],
      cities: scope === 'CITY' ? cityObjects : [],
      deliver_all_cities_in_selected_states:
        scope === 'STATE' ? Boolean(form.deliverAllCitiesInSelectedStates) : false,
    }

    try {
      const response = await fetch(`${API_BASE}/admin/delivery-coverage`, {
        method: 'PUT',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to save delivery coverage settings.')
        return
      }

      setMessage(data?.message || 'Delivery coverage settings saved.')
    } catch {
      setMessage('Unable to save delivery coverage settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel panel-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Delivery</p>
          <h2>Delivery Coverage Settings</h2>
        </div>
      </div>

      {loading ? <p>Loading coverage settings...</p> : null}

      {!loading ? (
        <form onSubmit={handleSave} className="form-grid">
          <div className="field-group">
            <span className="field-label">Delivery Scope</span>
            <div className="row-gap">
              <label>
                <input
                  type="radio"
                  name="delivery-scope"
                  value="NATIONWIDE"
                  checked={form.deliveryScope === 'NATIONWIDE'}
                  onChange={(event) => handleScopeChange(event.target.value)}
                />{' '}
                Nationwide
              </label>
              <label>
                <input
                  type="radio"
                  name="delivery-scope"
                  value="STATE"
                  checked={form.deliveryScope === 'STATE'}
                  onChange={(event) => handleScopeChange(event.target.value)}
                />{' '}
                State-wise
              </label>
              <label>
                <input
                  type="radio"
                  name="delivery-scope"
                  value="CITY"
                  checked={form.deliveryScope === 'CITY'}
                  onChange={(event) => handleScopeChange(event.target.value)}
                />{' '}
                City-wise
              </label>
            </div>
          </div>

          {form.deliveryScope === 'STATE' ? (
            <>
              <label className="field-group">
                <span className="field-label">Select states</span>
                <select
                  className="field"
                  multiple
                  size={8}
                  value={form.selectedStates}
                  onChange={(event) => {
                    const selectedStates = readMultiSelectValues(event)
                    setForm((current) => ({
                      ...current,
                      selectedStates,
                    }))
                  }}
                >
                  {INDIA_STATES.map((stateName) => (
                    <option key={stateName} value={stateName}>
                      {stateName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={form.deliverAllCitiesInSelectedStates}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setForm((current) => ({
                      ...current,
                      deliverAllCitiesInSelectedStates: checked,
                    }))
                  }}
                />{' '}
                Deliver to all cities in selected states
              </label>
            </>
          ) : null}

          {form.deliveryScope === 'CITY' ? (
            <>
              <label className="field-group">
                <span className="field-label">Select states</span>
                <select
                  className="field"
                  multiple
                  size={8}
                  value={form.cityScopedStates}
                  onChange={(event) => {
                    const selectedStates = readMultiSelectValues(event)
                    setForm((current) => {
                      const allowedCities = new Set(
                        selectedStates.flatMap((stateName) =>
                          (INDIA_STATE_CITY_MAP[stateName] || []).map((cityName) => toCityKey(stateName, cityName)),
                        ),
                      )
                      const selectedCities = current.selectedCities.filter((cityKey) => allowedCities.has(cityKey))
                      return {
                        ...current,
                        cityScopedStates: selectedStates,
                        selectedCities,
                      }
                    })
                  }}
                >
                  {INDIA_STATES.map((stateName) => (
                    <option key={stateName} value={stateName}>
                      {stateName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-group">
                <span className="field-label">Select cities</span>
                <select
                  className="field"
                  multiple
                  size={8}
                  value={form.selectedCities}
                  onChange={(event) => {
                    const selectedCities = readMultiSelectValues(event)
                    setForm((current) => ({
                      ...current,
                      selectedCities,
                    }))
                  }}
                >
                  {availableCities.map((cityOption) => (
                    <option key={cityOption.key} value={cityOption.key}>
                      {cityOption.city} ({cityOption.state})
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Coverage Settings'}
          </button>
        </form>
      ) : null}

      {message ? <p className="wishlist-message">{message}</p> : null}
    </section>
  )
}
