import { useEffect, useState } from 'react'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const defaultSettings = {
  warehouse: {
    address: '',
    pincode: '',
    contact_number: '',
  },
  distance_pricing: {
    base_charge: 40,
    per_km_rate: 1.5,
    min_charge: 30,
    max_charge: 500,
  },
  couriers: {
    available_couriers: ['Local', 'Express', 'Premium'],
  },
  cod_rules: {
    cod_enabled: true,
    cod_limit: 100000,
    cod_extra_charge: 0,
  },
  allow_all_india: true,
  serviceable_pincodes: '',
  blocked_pincodes: '',
}

const DEMO_SHIPPING_FALLBACK = {
  warehouse: {
    address: 'No. 42, Residency Road, Bengaluru, Karnataka',
    pincode: '560001',
    contact_number: '+91 98765 43210',
  },
  distance_pricing: {
    base_charge: 49,
    per_km_rate: 1.75,
    min_charge: 39,
    max_charge: 499,
  },
  couriers: {
    available_couriers: ['Local', 'Express', 'Premium'],
  },
  cod_rules: {
    cod_enabled: true,
    cod_limit: 75000,
    cod_extra_charge: 25,
  },
  allow_all_india: true,
  serviceable_pincodes: '',
  blocked_pincodes: '682001',
}

function shouldUseDemoFallback(data) {
  const warehouse = data?.warehouse || {}
  const hasWarehouse = String(warehouse.address || '').trim() || String(warehouse.pincode || '').trim() || String(warehouse.contact_number || '').trim()
  return !hasWarehouse
}

export default function ShippingConfiguration() {
  const [settings, setSettings] = useState(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [activeTab, setActiveTab] = useState('warehouse')

  const getFriendlyError = (detail, fallbackMessage) => {
    const normalized = String(detail || '').trim().toLowerCase()
    if (normalized === 'not found') {
      return 'Shipping settings API is not available on the running backend. Restart backend server and retry.'
    }
    if (normalized === 'not authenticated') {
      return 'You are not logged in to the backend. Please sign in again.'
    }
    if (normalized === 'access denied for this role.') {
      return 'Your current account does not have permission to manage shipping settings.'
    }
    return detail || fallbackMessage
  }

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(`${API_BASE}/admin/shipping-settings`, {
          headers: buildAuthHeaders(),
        })
        const data = await response.json()
        if (!response.ok) {
          setMessage(getFriendlyError(data?.detail, 'Unable to load shipping settings.'))
          return
        }

        const nextSettings = {
          warehouse: data.warehouse || defaultSettings.warehouse,
          distance_pricing: data.distance_pricing || defaultSettings.distance_pricing,
          couriers: data.couriers || defaultSettings.couriers,
          cod_rules: data.cod_rules || defaultSettings.cod_rules,
          allow_all_india: data.allow_all_india !== false,
          serviceable_pincodes: '',
          blocked_pincodes: '',
        }

        setSettings(shouldUseDemoFallback(data) ? DEMO_SHIPPING_FALLBACK : nextSettings)
        setMessage('')
      } catch (error) {
        setMessage('Unable to load shipping settings.')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [])

  const handleWarehouseChange = (field, value) => {
    setSettings((prev) => ({
      ...prev,
      warehouse: { ...prev.warehouse, [field]: value },
    }))
  }

  const handlePricingChange = (field, value) => {
    setSettings((prev) => ({
      ...prev,
      distance_pricing: {
        ...prev.distance_pricing,
        [field]: parseFloat(value) || 0,
      },
    }))
  }

  const handleCODChange = (field, value) => {
    setSettings((prev) => ({
      ...prev,
      cod_rules: {
        ...prev.cod_rules,
        [field]: field === 'cod_enabled' ? Boolean(value === 'true') : parseFloat(value) || 0,
      },
    }))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    const payload = {
      warehouse: settings.warehouse,
      distance_pricing: settings.distance_pricing,
      couriers: settings.couriers,
      cod_rules: settings.cod_rules,
      allow_all_india: settings.allow_all_india,
      serviceable_pincodes: settings.serviceable_pincodes.split(',').filter((p) => p.trim()),
      blocked_pincodes: settings.blocked_pincodes.split(',').filter((p) => p.trim()),
    }

    try {
      const response = await fetch(`${API_BASE}/admin/shipping-settings`, {
        method: 'PUT',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      const data = await response.json()

      if (!response.ok) {
        setMessage(getFriendlyError(data?.detail, 'Unable to save shipping settings.'))
        return
      }

      setMessage('✓ Shipping settings saved successfully!')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      setMessage('Unable to save shipping settings.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <section className="panel panel-stack">Loading shipping settings...</section>
  }

  return (
    <section className="panel panel-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Logistics</p>
          <h2>Shipping Configuration</h2>
        </div>
      </div>

      <p style={{ fontSize: '14px', color: '#666', marginBottom: '20px' }}>
        Configure your warehouse, shipping rules, and delivery coverage. The storefront now uses flat shipping bands with free delivery above ₹500.
      </p>

      <form onSubmit={handleSave} className="form-grid">
        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', borderBottom: '1px solid #e5e7eb' }}>
          {['warehouse', 'pricing', 'pincodes', 'cod', 'couriers'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 16px',
                border: 'none',
                background: activeTab === tab ? '#0066ff' : 'transparent',
                color: activeTab === tab ? 'white' : '#666',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activeTab === tab ? '600' : '500',
                borderRadius: '4px 4px 0 0',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Warehouse Tab */}
        {activeTab === 'warehouse' && (
          <div style={{ paddingTop: '12px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '16px' }}>Warehouse/Pickup Location</h3>

            <label className="field-group">
              <span className="field-label">Address</span>
              <input
                className="field"
                value={settings.warehouse.address}
                onChange={(e) => handleWarehouseChange('address', e.target.value)}
                placeholder="Enter warehouse address"
              />
            </label>

            <label className="field-group">
              <span className="field-label">Pincode</span>
              <input
                className="field"
                value={settings.warehouse.pincode}
                onChange={(e) => handleWarehouseChange('pincode', e.target.value)}
                placeholder="6-digit pincode"
                maxLength="6"
              />
              <small style={{ color: '#666', marginTop: '4px' }}>Used for distance calculations</small>
            </label>

            <label className="field-group">
              <span className="field-label">Contact Number</span>
              <input
                className="field"
                value={settings.warehouse.contact_number}
                onChange={(e) => handleWarehouseChange('contact_number', e.target.value)}
                placeholder="Phone number"
              />
            </label>
          </div>
        )}

        {/* Pricing Tab */}
        {activeTab === 'pricing' && (
          <div style={{ paddingTop: '12px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '16px' }}>Shipping Pricing Overview</h3>

            <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
              The customer-facing checkout uses free delivery on orders above ₹500, then flat delivery bands based on distance.
            </p>

            <label className="field-group">
              <span className="field-label">Base Delivery Charge (₹)</span>
              <input
                className="field"
                type="number"
                value={settings.distance_pricing.base_charge}
                onChange={(e) => handlePricingChange('base_charge', e.target.value)}
                step="0.01"
                min="0"
              />
            </label>

            <label className="field-group">
              <span className="field-label">Price per KM (₹)</span>
              <input
                className="field"
                type="number"
                value={settings.distance_pricing.per_km_rate}
                onChange={(e) => handlePricingChange('per_km_rate', e.target.value)}
                step="0.01"
                min="0"
              />
            </label>

            <label className="field-group">
              <span className="field-label">Minimum Charge (₹)</span>
              <input
                className="field"
                type="number"
                value={settings.distance_pricing.min_charge}
                onChange={(e) => handlePricingChange('min_charge', e.target.value)}
                step="0.01"
                min="0"
              />
            </label>

            <label className="field-group">
              <span className="field-label">Maximum Charge (₹)</span>
              <input
                className="field"
                type="number"
                value={settings.distance_pricing.max_charge}
                onChange={(e) => handlePricingChange('max_charge', e.target.value)}
                step="0.01"
                min="0"
              />
            </label>
          </div>
        )}

        {/* Pincodes Tab */}
        {activeTab === 'pincodes' && (
          <div style={{ paddingTop: '12px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '16px' }}>Serviceability Settings</h3>

            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
              <input
                type="checkbox"
                checked={settings.allow_all_india}
                onChange={(e) => setSettings((prev) => ({ ...prev, allow_all_india: e.target.checked }))}
              />
              <span style={{ fontSize: '14px' }}>Allow delivery across all India (except blocked pincodes)</span>
            </label>

            <label className="field-group">
              <span className="field-label">Serviceable Pincodes (if not all-India)</span>
              <textarea
                className="field"
                value={settings.serviceable_pincodes}
                onChange={(e) => setSettings((prev) => ({ ...prev, serviceable_pincodes: e.target.value }))}
                placeholder="Enter pincodes separated by comma (e.g., 110001,122001,201301)"
                style={{ minHeight: '100px', fontFamily: 'monospace' }}
                disabled={settings.allow_all_india}
              />
              <small style={{ color: '#666', marginTop: '4px' }}>
                Leave empty for all-India. CSV format: pincode1,pincode2,pincode3
              </small>
            </label>

            <label className="field-group">
              <span className="field-label">Blocked Pincodes</span>
              <textarea
                className="field"
                value={settings.blocked_pincodes}
                onChange={(e) => setSettings((prev) => ({ ...prev, blocked_pincodes: e.target.value }))}
                placeholder="Pincodes where delivery not available (e.g., 123456,789012)"
                style={{ minHeight: '100px', fontFamily: 'monospace' }}
              />
              <small style={{ color: '#666', marginTop: '4px' }}>CSV format: pincode1,pincode2,pincode3</small>
            </label>
          </div>
        )}

        {/* COD Tab */}
        {activeTab === 'cod' && (
          <div style={{ paddingTop: '12px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '16px' }}>Cash on Delivery (COD) Rules</h3>

            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
              <input
                type="checkbox"
                checked={settings.cod_rules.cod_enabled}
                onChange={(e) => handleCODChange('cod_enabled', e.target.checked)}
              />
              <span style={{ fontSize: '14px' }}>Enable COD for customers</span>
            </label>

            <label className="field-group">
              <span className="field-label">COD Limit (₹) - max order value for COD</span>
              <input
                className="field"
                type="number"
                value={settings.cod_rules.cod_limit}
                onChange={(e) => handleCODChange('cod_limit', e.target.value)}
                step="100"
                min="0"
                disabled={!settings.cod_rules.cod_enabled}
              />
            </label>

            <label className="field-group">
              <span className="field-label">COD Extra Charge (₹)</span>
              <input
                className="field"
                type="number"
                value={settings.cod_rules.cod_extra_charge}
                onChange={(e) => handleCODChange('cod_extra_charge', e.target.value)}
                step="0.01"
                min="0"
                disabled={!settings.cod_rules.cod_enabled}
              />
              <small style={{ color: '#666', marginTop: '4px' }}>Added to delivery charge for COD orders</small>
            </label>
          </div>
        )}

        {/* Couriers Tab */}
        {activeTab === 'couriers' && (
          <div style={{ paddingTop: '12px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '16px' }}>Courier Partners</h3>

            <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
              Selected couriers will be available for shipment creation based on order distance.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {['Local', 'Express', 'Premium'].map((courier) => (
                <label key={courier} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={settings.couriers.available_couriers.includes(courier)}
                    onChange={(e) => {
                      setSettings((prev) => {
                        const updated = e.target.checked
                          ? [...prev.couriers.available_couriers, courier]
                          : prev.couriers.available_couriers.filter((c) => c !== courier)
                        return {
                          ...prev,
                          couriers: { ...prev.couriers, available_couriers: updated },
                        }
                      })
                    }}
                  />
                  <span style={{ fontSize: '14px' }}>{courier}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Message */}
        {message && (
          <div
            style={{
              padding: '12px',
              backgroundColor: message.includes('✓') ? '#d1fae5' : '#fee2e2',
              color: message.includes('✓') ? '#065f46' : '#991b1b',
              borderRadius: '4px',
              fontSize: '14px',
              marginTop: '16px',
            }}
          >
            {message}
          </div>
        )}

        {/* Save Button */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '10px 24px',
              backgroundColor: '#0066ff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            {saving ? 'Saving...' : 'Save Shipping Settings'}
          </button>
        </div>
      </form>
    </section>
  )
}
