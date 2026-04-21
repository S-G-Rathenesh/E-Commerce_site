import { useMemo, useState } from 'react'
import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'
import { products } from '../data/products'
import { generateStock } from '../utils/adminUi'

const initialProducts = products.map((product) => {
  const stock = generateStock(product.id)
  return {
    ...product,
    stock,
    status: stock > 6 ? 'Active' : 'Inactive',
  }
})

export default function ManageProducts() {
  const [rows, setRows] = useState(initialProducts)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('ALL')
  const [selectedIds, setSelectedIds] = useState([])
  const [drawerProductId, setDrawerProductId] = useState('')
  const [loading] = useState(false)

  const categories = useMemo(() => ['ALL', ...new Set(rows.map((row) => row.category))], [rows])

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter((row) => {
      const searchMatch = !query || row.name.toLowerCase().includes(query)
      const categoryMatch = category === 'ALL' || row.category === category
      return searchMatch && categoryMatch
    })
  }, [category, rows, search])

  const drawerProduct = rows.find((item) => item.id === drawerProductId)

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

  const deleteRow = (id) => {
    setRows((current) => current.filter((item) => item.id !== id))
    setSelectedIds((current) => current.filter((item) => item !== id))
    if (drawerProductId === id) {
      setDrawerProductId('')
    }
  }

  const bulkUpdateStatus = (status) => {
    if (!selectedIds.length) return
    setRows((current) =>
      current.map((item) => {
        if (!selectedIds.includes(item.id)) return item
        return { ...item, status }
      }),
    )
  }

  const bulkDelete = () => {
    if (!selectedIds.length) return
    setRows((current) => current.filter((item) => !selectedIds.includes(item.id)))
    setSelectedIds([])
    setDrawerProductId('')
  }

  return (
    <PageWrapper
      className="page-merchant"
      eyebrow="Inventory"
      title="Manage products"
      description="A consistent management surface for maintaining product data inside the same design system as the storefront."
      actions={<Button>+ Add New Product</Button>}
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
          <button type="button" className="btn btn-secondary" onClick={toggleSelectAllVisible}>
            Select visible
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => bulkUpdateStatus('Active')}>
            Bulk activate
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => bulkUpdateStatus('Inactive')}>
            Bulk deactivate
          </button>
          <button type="button" className="btn btn-secondary" onClick={bulkDelete}>
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
              {visibleRows.map((product) => (
                <tr key={product.id} className="table-row-hover">
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(product.id)}
                      onChange={() => toggleSelection(product.id)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => setDrawerProductId(product.id)}
                    >
                      {product.name}
                    </button>
                  </td>
                  <td>{product.category}</td>
                  <td>Rs. {product.price.toFixed(2)}</td>
                  <td>{product.stock}</td>
                  <td>
                    <span className={product.status === 'Active' ? 'badge badge-success' : 'badge badge-danger'}>
                      {product.status}
                    </span>
                  </td>
                  <td>
                    <div className="row-gap table-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => setDrawerProductId(product.id)}>
                        Edit
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => deleteRow(product.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {drawerProduct ? (
        <aside className="product-drawer card panel panel-stack">
          <div className="section-head">
            <h2>Edit product</h2>
            <button type="button" className="btn btn-secondary" onClick={() => setDrawerProductId('')}>
              Close
            </button>
          </div>

          <label className="field-group">
            <span className="field-label">Product name</span>
            <input
              className="field"
              value={drawerProduct.name}
              onChange={(event) => {
                const value = event.target.value
                setRows((current) =>
                  current.map((item) => (item.id === drawerProduct.id ? { ...item, name: value } : item)),
                )
              }}
            />
          </label>

          <label className="field-group">
            <span className="field-label">Price</span>
            <input
              type="number"
              className="field"
              value={drawerProduct.price}
              onChange={(event) => {
                const value = Number(event.target.value || 0)
                setRows((current) =>
                  current.map((item) => (item.id === drawerProduct.id ? { ...item, price: value } : item)),
                )
              }}
            />
          </label>

          <label className="field-group">
            <span className="field-label">Stock</span>
            <input
              type="number"
              className="field"
              value={drawerProduct.stock}
              onChange={(event) => {
                const value = Number(event.target.value || 0)
                setRows((current) =>
                  current.map((item) =>
                    item.id === drawerProduct.id
                      ? { ...item, stock: value, status: value > 6 ? 'Active' : 'Inactive' }
                      : item,
                  ),
                )
              }}
            />
          </label>
        </aside>
      ) : null}
    </PageWrapper>
  )
}
