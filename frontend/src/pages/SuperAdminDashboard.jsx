import { useEffect, useState } from 'react'
import PageWrapper from '../components/PageWrapper'
import Button from '../components/Button'
import ImageUploadField from '../components/ImageUploadField'
import Input from '../components/Input'
import { buildAuthHeaders } from '../utils/auth'
import { setCachedBranding } from '../utils/platform'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

async function parseResponse(response) {
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.detail || 'Request failed')
  }
  return data
}

export default function SuperAdminDashboard() {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState(null)
  const [merchants, setMerchants] = useState([])
  const [products, setProducts] = useState([])
  const [banners, setBanners] = useState([])
  const [branding, setBranding] = useState({ platform_name: '', logo_url: '' })
  const [brandingImageUploading, setBrandingImageUploading] = useState(false)
  const [globalOffer, setGlobalOffer] = useState({
    title: '',
    description: '',
    discount_percent: 0,
    code: '',
    active: false,
  })

  const loadAll = async () => {
    setLoading(true)
    setMessage('')
    try {
      const headers = buildAuthHeaders()
      const [overviewData, merchantData, productData, bannerData, brandingData, offerData] = await Promise.all([
        fetch(`${API_BASE}/super-admin/overview`, { headers }).then(parseResponse),
        fetch(`${API_BASE}/super-admin/merchants`, { headers }).then(parseResponse),
        fetch(`${API_BASE}/super-admin/products/pending`, { headers }).then(parseResponse),
        fetch(`${API_BASE}/super-admin/banner-requests`, { headers }).then(parseResponse),
        fetch(`${API_BASE}/super-admin/platform-branding`, { headers }).then(parseResponse),
        fetch(`${API_BASE}/super-admin/offers/global`, { headers }).then(parseResponse),
      ])

      setOverview(overviewData?.analytics || null)
      setMerchants(Array.isArray(merchantData?.merchants) ? merchantData.merchants : [])
      setProducts(Array.isArray(productData?.products) ? productData.products : [])
      setBanners(Array.isArray(bannerData?.banners) ? bannerData.banners : [])
      setBranding({
        platform_name: brandingData?.branding?.platform_name || '',
        logo_url: brandingData?.branding?.logo_url || '',
      })
      setGlobalOffer({
        title: offerData?.offer?.title || '',
        description: offerData?.offer?.description || '',
        discount_percent: Number(offerData?.offer?.discount_percent || 0),
        code: offerData?.offer?.code || '',
        active: Boolean(offerData?.offer?.active),
      })
    } catch (error) {
      setMessage(error?.message || 'Failed to load super admin dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const decideMerchant = async (merchantId, merchantStatus, active) => {
    try {
      const data = await fetch(`${API_BASE}/super-admin/merchants/${merchantId}/decision`, {
        method: 'PUT',
        headers: {
          ...buildAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ merchant_status: merchantStatus, active }),
      }).then(parseResponse)
      setMessage(data?.message || 'Merchant updated.')
      await loadAll()
    } catch (error) {
      setMessage(error?.message || 'Unable to update merchant.')
    }
  }

  const decideBanner = async (bannerId, status) => {
    try {
      const data = await fetch(`${API_BASE}/super-admin/banner-requests/${bannerId}/decision`, {
        method: 'PUT',
        headers: {
          ...buildAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      }).then(parseResponse)
      setMessage(data?.message || 'Banner review updated.')
      await loadAll()
    } catch (error) {
      setMessage(error?.message || 'Unable to update banner request.')
    }
  }

  const decideProduct = async (productId, status) => {
    try {
      const data = await fetch(`${API_BASE}/super-admin/products/${productId}/decision`, {
        method: 'PUT',
        headers: {
          ...buildAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      }).then(parseResponse)
      setMessage(data?.message || 'Product review updated.')
      await loadAll()
    } catch (error) {
      setMessage(error?.message || 'Unable to update product review.')
    }
  }

  const saveBranding = async (event) => {
    event.preventDefault()
    if (brandingImageUploading) {
      setMessage('Please wait for the logo upload to finish before saving branding.')
      return
    }
    try {
      const data = await fetch(`${API_BASE}/super-admin/platform-branding`, {
        method: 'PUT',
        headers: {
          ...buildAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(branding),
      }).then(parseResponse)

      setCachedBranding({
        platform_name: data?.branding?.platform_name || branding.platform_name,
        logo_url: data?.branding?.logo_url || branding.logo_url,
      })
      setMessage(data?.message || 'Branding updated.')
      await loadAll()
    } catch (error) {
      setMessage(error?.message || 'Unable to save branding.')
    }
  }

  const saveOffer = async (event) => {
    event.preventDefault()
    try {
      const data = await fetch(`${API_BASE}/super-admin/offers/global`, {
        method: 'PUT',
        headers: {
          ...buildAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(globalOffer),
      }).then(parseResponse)
      setMessage(data?.message || 'Global offer updated.')
      await loadAll()
    } catch (error) {
      setMessage(error?.message || 'Unable to save global offer.')
    }
  }

  return (
    <PageWrapper
      className="page-admin"
      eyebrow="Super Admin"
      title="Platform Command Center"
      description="Hidden control layer for merchant approvals, banners, offers, branding, and platform analytics."
      actions={<Button onClick={loadAll}>Refresh</Button>}
    >
      <div className="admin-layout container admin-container">
        {message ? <p className="login-message">{message}</p> : null}
        {loading ? <p>Loading super admin controls...</p> : null}

        {!loading && overview ? (
          <section className="section-card panel panel-stack">
            <div className="section-head">
              <div>
                <p className="eyebrow">Platform Analytics</p>
                <h2>Network-level snapshot</h2>
              </div>
            </div>
            <div className="dashboard-grid">
              <article className="panel card"><p>Orders</p><h3>{overview.orders}</h3></article>
              <article className="panel card"><p>Users</p><h3>{overview.users}</h3></article>
              <article className="panel card"><p>Merchants</p><h3>{overview.merchants}</h3></article>
              <article className="panel card"><p>Revenue</p><h3>Rs. {Number(overview.revenue || 0).toLocaleString('en-IN')}</h3></article>
            </div>
          </section>
        ) : null}

        <section className="section-card panel panel-stack">
          <div className="section-head"><div><p className="eyebrow">Merchant Management</p><h2>Approve, reject, activate, deactivate</h2></div></div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Merchant Status</th>
                  <th>Account</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {merchants.map((merchant) => (
                  <tr key={merchant.id}>
                    <td>{merchant.full_name || merchant.name}</td>
                    <td>{merchant.email}</td>
                    <td>{merchant.merchant_status}</td>
                    <td>{merchant.status}</td>
                    <td>
                      <div className="row-gap">
                        <button type="button" className="btn btn-secondary" onClick={() => decideMerchant(merchant.id, 'APPROVED', true)}>Approve</button>
                        <button type="button" className="btn btn-secondary" onClick={() => decideMerchant(merchant.id, 'REJECTED', false)}>Reject</button>
                        <button type="button" className="btn btn-secondary" onClick={() => decideMerchant(merchant.id, merchant.merchant_status || 'APPROVED', true)}>Activate</button>
                        <button type="button" className="btn btn-secondary" onClick={() => decideMerchant(merchant.id, merchant.merchant_status || 'APPROVED', false)}>Deactivate</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section-card panel panel-stack">
          <div className="section-head"><div><p className="eyebrow">Product Governance</p><h2>Pending or rejected products</h2></div></div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Merchant</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr><td colSpan={4}>No products pending review.</td></tr>
                ) : products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{product.merchant_id || 'N/A'}</td>
                    <td>{product.review_status || 'PENDING'}</td>
                    <td>
                      <div className="row-gap">
                        <button type="button" className="btn btn-secondary" onClick={() => decideProduct(product.id, 'APPROVED')}>Approve</button>
                        <button type="button" className="btn btn-secondary" onClick={() => decideProduct(product.id, 'REJECTED')}>Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section-card panel panel-stack">
          <div className="section-head"><div><p className="eyebrow">Banner Governance</p><h2>Banner approval workflow</h2></div></div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Merchant</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {banners.length === 0 ? (
                  <tr><td colSpan={4}>No banner requests available.</td></tr>
                ) : banners.map((banner) => (
                  <tr key={banner.id}>
                    <td>{banner.title}</td>
                    <td>{banner.merchant_email}</td>
                    <td>{banner.status}</td>
                    <td>
                      <div className="row-gap">
                        <button type="button" className="btn btn-secondary" onClick={() => decideBanner(banner.id, 'APPROVED')}>Approve</button>
                        <button type="button" className="btn btn-secondary" onClick={() => decideBanner(banner.id, 'REJECTED')}>Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section-card panel panel-stack">
          <div className="section-head"><div><p className="eyebrow">Platform Branding</p><h2>Name and logo control</h2></div></div>
          <form className="form-grid" onSubmit={saveBranding}>
            <Input
              label="Platform Name"
              value={branding.platform_name}
              onChange={(event) => setBranding((current) => ({ ...current, platform_name: event.target.value }))}
              required
            />
            <ImageUploadField
              label="Platform logo"
              value={branding.logo_url}
              onChange={(nextValue) => setBranding((current) => ({ ...current, logo_url: nextValue }))}
              onUploadingChange={setBrandingImageUploading}
              description="Upload the platform logo or paste a hosted URL."
              required
            />
            <Button type="submit" disabled={brandingImageUploading}>
              {brandingImageUploading ? 'Upload in progress...' : 'Save Branding'}
            </Button>
          </form>
        </section>

        <section className="section-card panel panel-stack">
          <div className="section-head"><div><p className="eyebrow">Offers and Pricing</p><h2>Global campaign management</h2></div></div>
          <form className="form-grid" onSubmit={saveOffer}>
            <Input
              label="Campaign Title"
              value={globalOffer.title}
              onChange={(event) => setGlobalOffer((current) => ({ ...current, title: event.target.value }))}
              required
            />
            <Input
              label="Description"
              value={globalOffer.description}
              onChange={(event) => setGlobalOffer((current) => ({ ...current, description: event.target.value }))}
            />
            <Input
              label="Discount Percent"
              type="number"
              value={globalOffer.discount_percent}
              onChange={(event) =>
                setGlobalOffer((current) => ({ ...current, discount_percent: Number(event.target.value || 0) }))
              }
              min={0}
              max={90}
            />
            <Input
              label="Promo Code"
              value={globalOffer.code}
              onChange={(event) => setGlobalOffer((current) => ({ ...current, code: event.target.value }))}
            />
            <label className="field-group">
              <span className="field-label">Active Campaign</span>
              <input
                type="checkbox"
                checked={globalOffer.active}
                onChange={(event) => setGlobalOffer((current) => ({ ...current, active: event.target.checked }))}
              />
            </label>
            <Button type="submit">Save Campaign</Button>
          </form>
        </section>
      </div>
    </PageWrapper>
  )
}
