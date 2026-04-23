import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Button from '../components/Button'
import ImageUploadField from '../components/ImageUploadField'
import PageWrapper from '../components/PageWrapper'
import {
  createMerchantProduct,
  deleteMerchantProduct,
  fetchMerchantProducts,
  updateMerchantProduct,
} from '../utils/catalog'

const emptyDrawerForm = {
  name: '',
  section: 'women',
  category: '',
  productType: '',
  subType: '',
  price: '',
  stock: '0',
  image: '',
  description: '',
}

const normalizeStock = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
}

const normalizePrice = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
}

const getProductStatus = (product) => {
  const reviewStatus = String(product.review_status || '').trim().toUpperCase()
  if (reviewStatus === 'PENDING') {
    return 'Pending Review'
  }
  if (reviewStatus === 'REJECTED') {
    return 'Rejected'
  }
  return normalizeStock(product.stock) > 0 ? 'Active' : 'Inactive'
}

const getStatusTone = (status) => {
  if (status === 'Active') return 'badge-success'
  if (status === 'Inactive') return 'badge-danger'
  if (status === 'Rejected') return 'badge-danger'
  return 'badge-info'
}

const buildDrawerForm = (product = {}) => ({
  name: product.name || '',
  section: product.section || 'women',
  category: product.category || '',
  productType: product.productType || '',
  subType: product.subType || '',
  price: String(product.price ?? ''),
  stock: String(product.stock ?? '0'),
  image: product.image || '',
  description: product.description || '',
})

const buildPayload = (form) => ({
  name: form.name.trim(),
  section: form.section.trim(),
  category: form.category.trim(),
  productType: form.productType.trim(),
  subType: form.subType.trim(),
  price: normalizePrice(form.price),
  stock: normalizeStock(form.stock),
  image: form.image.trim(),
  description: form.description.trim(),
})

export default function ManageProducts() {
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('ALL')
  const [selectedIds, setSelectedIds] = useState([])
  const [drawerMode, setDrawerMode] = useState('')
  const [drawerProductId, setDrawerProductId] = useState('')
  const [drawerForm, setDrawerForm] = useState(emptyDrawerForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)

  const refreshProducts = async () => {
    setLoading(true)
    try {
      const products = await fetchMerchantProducts()
      const normalizedRows = products.map((product) => ({
        ...product,
        stock: normalizeStock(product.stock),
      }))
      setRows(normalizedRows)
      setSelectedIds([])
    } catch {
      toast.error('Unable to load merchant products right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshProducts()
  }, [])

  const categories = useMemo(() => ['ALL', ...new Set(rows.map((row) => row.category).filter(Boolean))], [rows])

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter((row) => {
      const searchMatch = !query || row.name.toLowerCase().includes(query)
      const categoryMatch = category === 'ALL' || row.category === category
      return searchMatch && categoryMatch
    })
  }, [category, rows, search])

  const drawerProduct = rows.find((item) => item.id === drawerProductId)
  const drawerTitle = drawerMode === 'create' ? 'Add product' : 'Edit product'

  const openCreateDrawer = () => {
    setDrawerMode('create')
    setDrawerProductId('')
    setDrawerForm(emptyDrawerForm)
  }

  const openEditDrawer = (product) => {
    setDrawerMode('edit')
    setDrawerProductId(product.id)
    setDrawerForm(buildDrawerForm(product))
  }

  const closeDrawer = () => {
    setDrawerMode('')
    setDrawerProductId('')
    setDrawerForm(emptyDrawerForm)
  }

  const toggleSelection = (id) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const toggleSelectAllVisible = () => {
    const ids = visibleRows.map((item) => item.id)
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id))
    if (allSelected) {
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
      return
    }

    setSelectedIds((current) => [...new Set([...current, ...ids])])
  }

  const handleSaveProduct = async (event) => {
    event.preventDefault()
    if (imageUploading) {
      toast.error('Please wait for the image upload to finish before saving.')
      return
    }
    const payload = buildPayload(drawerForm)

    if (!payload.name || !payload.category || !payload.image || !payload.description) {
      toast.error('Complete the required product fields before saving.')
      return
    }

    setSaving(true)
    try {
      if (drawerMode === 'create') {
        await createMerchantProduct(payload)
        toast.success('Product created successfully.')
      } else {
        await updateMerchantProduct(drawerProductId, payload)
        toast.success('Product updated successfully.')
      }
      closeDrawer()
      await refreshProducts()
    } catch (error) {
      toast.error(error?.message || 'Unable to save product right now.')
    } finally {
      setSaving(false)
    }
  }

  const deleteRow = async (id) => {
    const target = rows.find((item) => item.id === id)
    const label = target?.name || 'this product'
    if (!window.confirm(`Delete ${label}?`)) {
      return
    }

    try {
      await deleteMerchantProduct(id)
      toast.success('Product deleted.')
      if (drawerProductId === id) {
        closeDrawer()
      }
      await refreshProducts()
    } catch (error) {
      toast.error(error?.message || 'Unable to delete product right now.')
    }
  }

  const bulkUpdateStock = async (nextStock) => {
    if (!selectedIds.length) {
      toast.error('Select at least one product first.')
      return
    }

    const targets = rows.filter((item) => selectedIds.includes(item.id))
    if (!targets.length) {
      return
    }

    setSaving(true)
    try {
      await Promise.all(
        targets.map((product) =>
          updateMerchantProduct(product.id, buildPayload({ ...buildDrawerForm(product), stock: String(nextStock) })),
        ),
      )
      toast.success('Selected products updated.')
      await refreshProducts()
    } catch (error) {
      toast.error(error?.message || 'Unable to update selected products right now.')
    } finally {
      setSaving(false)
    }
  }

  const bulkDelete = async () => {
    if (!selectedIds.length) {
      toast.error('Select at least one product first.')
      return
    }

    const count = selectedIds.length
    if (!window.confirm(`Delete ${count} selected product${count === 1 ? '' : 's'}?`)) {
      return
    }

    setSaving(true)
    try {
      await Promise.all(selectedIds.map((id) => deleteMerchantProduct(id)))
      toast.success('Selected products deleted.')
      closeDrawer()
      await refreshProducts()
    } catch (error) {
      toast.error(error?.message || 'Unable to delete selected products right now.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageWrapper
      className="page-merchant"
      eyebrow="Inventory"
      title="Manage products"
      description="A consistent management surface for maintaining product data inside the same design system as the storefront."
      actions={<Button onClick={openCreateDrawer}>+ Add New Product</Button>}
    >
      <section className="panel panel-stack card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Catalog</p>
            <h2>Current listings</h2>
          </div>
          <p>{visibleRows.length} items</p>
        </div>

        <div className="admin-controls-row">
          <input
            className="field"
            placeholder="Search by product name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value === 'ALL' ? 'All categories' : value}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-controls-row">
          <button type="button" className="btn btn-secondary" onClick={toggleSelectAllVisible} disabled={saving}>
            Select visible
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => bulkUpdateStock(1)} disabled={saving}>
            Bulk activate
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => bulkUpdateStock(0)} disabled={saving}>
            Bulk deactivate
          </button>
          <button type="button" className="btn btn-secondary" onClick={bulkDelete} disabled={saving}>
            Bulk delete
          </button>
        </div>

        {loading ? (
          <div className="skeleton-list">
            <div className="skeleton-line skeleton-shimmer skeleton-line-long" />
            <div className="skeleton-line skeleton-shimmer skeleton-line-long" />
            <div className="skeleton-line skeleton-shimmer skeleton-line-long" />
          </div>
        ) : null}

        {!loading && visibleRows.length === 0 ? <p className="empty-state">No products found.</p> : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((product) => {
                const status = getProductStatus(product)
                return (
                  <tr key={product.id} className="table-row-hover">
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(product.id)}
                        onChange={() => toggleSelection(product.id)}
                      />
                    </td>
                    <td>
                      <button type="button" className="btn btn-link" onClick={() => openEditDrawer(product)}>
                        {product.name}
                      </button>
                    </td>
                    <td>{product.category}</td>
                    <td>Rs. {normalizePrice(product.price).toFixed(2)}</td>
                    <td>{normalizeStock(product.stock)}</td>
                    <td>
                      <span className={`badge ${getStatusTone(status)}`}>{status}</span>
                    </td>
                    <td>
                      <div className="row-gap table-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => openEditDrawer(product)}>
                          Edit
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => deleteRow(product.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {drawerMode ? (
        <aside className="product-drawer card panel panel-stack">
          <div className="section-head">
            <div>
              <p className="eyebrow">Product</p>
              <h2>{drawerTitle}</h2>
            </div>
            <button type="button" className="btn btn-secondary" onClick={closeDrawer} disabled={saving}>
              Close
            </button>
          </div>

          {drawerMode === 'edit' && drawerProduct ? (
            <p className="empty-state" style={{ marginBottom: 0 }}>
              Current status: <strong>{getProductStatus(drawerProduct)}</strong>
            </p>
          ) : null}

          <form className="panel-stack" onSubmit={handleSaveProduct}>
            <label className="field-group">
              <span className="field-label">Product name</span>
              <input
                className="field"
                value={drawerForm.name}
                onChange={(event) => setDrawerForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>

            <label className="field-group">
              <span className="field-label">Section</span>
              <select
                className="field"
                value={drawerForm.section}
                onChange={(event) => setDrawerForm((current) => ({ ...current, section: event.target.value }))}
              >
                <option value="men">Men</option>
                <option value="women">Women</option>
                <option value="kids">Kids</option>
                <option value="unisex">Unisex</option>
              </select>
            </label>

            <label className="field-group">
              <span className="field-label">Category</span>
              <input
                className="field"
                value={drawerForm.category}
                onChange={(event) => setDrawerForm((current) => ({ ...current, category: event.target.value }))}
                required
              />
            </label>

            <label className="field-group">
              <span className="field-label">Product type</span>
              <input
                className="field"
                value={drawerForm.productType}
                onChange={(event) => setDrawerForm((current) => ({ ...current, productType: event.target.value }))}
              />
            </label>

            <label className="field-group">
              <span className="field-label">Subtype</span>
              <input
                className="field"
                value={drawerForm.subType}
                onChange={(event) => setDrawerForm((current) => ({ ...current, subType: event.target.value }))}
              />
            </label>

            <label className="field-group">
              <span className="field-label">Price</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="field"
                value={drawerForm.price}
                onChange={(event) => setDrawerForm((current) => ({ ...current, price: event.target.value }))}
                required
              />
            </label>

            <label className="field-group">
              <span className="field-label">Stock</span>
              <input
                type="number"
                min="0"
                step="1"
                className="field"
                value={drawerForm.stock}
                onChange={(event) => setDrawerForm((current) => ({ ...current, stock: event.target.value }))}
                required
              />
            </label>

            <ImageUploadField
              label="Product image"
              value={drawerForm.image}
              onChange={(nextValue) => setDrawerForm((current) => ({ ...current, image: nextValue }))}
              onUploadingChange={setImageUploading}
              placeholder="https://..."
              description="Upload the product image or paste an existing URL."
              required
            />

            <label className="field-group">
              <span className="field-label">Description</span>
              <textarea
                className="field"
                rows={4}
                value={drawerForm.description}
                onChange={(event) => setDrawerForm((current) => ({ ...current, description: event.target.value }))}
                required
              />
            </label>

            <div className="row-gap">
              <button type="submit" className="btn btn-primary" disabled={saving || imageUploading}>
                {imageUploading ? 'Upload in progress...' : saving ? 'Saving...' : drawerMode === 'create' ? 'Create product' : 'Save changes'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeDrawer} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        </aside>
      ) : null}
    </PageWrapper>
  )
}