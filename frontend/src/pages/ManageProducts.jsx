import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'
import { products } from '../data/products'

export default function ManageProducts() {
  return (
    <PageWrapper
      eyebrow="Inventory"
      title="Manage products"
      description="A consistent management surface for maintaining product data inside the same design system as the storefront."
      actions={<Button>+ Add New Product</Button>}
    >
      <section className="panel panel-stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">Catalog</p>
            <h2>Current listings</h2>
          </div>
          <p>{products.length} items</p>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.category}</td>
                  <td>${product.price.toFixed(2)}</td>
                  <td>Active</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PageWrapper>
  )
}
