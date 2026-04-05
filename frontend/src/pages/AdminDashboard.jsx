import { Link } from 'react-router-dom'
import Button from '../components/Button'
import PageWrapper from '../components/PageWrapper'

const stats = [
  { label: 'Total Sales', value: '$24,000', trend: '+12.5%' },
  { label: 'Orders', value: '1.2k', trend: '+8.2%' },
  { label: 'New Customers', value: '400', trend: '-2.4%' },
]

export default function AdminDashboard() {
  return (
    <PageWrapper
      eyebrow="Admin"
      title="Store operations dashboard"
      description="A compact, grid-based admin area with matching cards, spacing, and strong visual hierarchy."
      actions={<Button to="/admin/products">Manage Products</Button>}
    >
      <div className="admin-layout">
        <div className="stats-grid">
          {stats.map((stat) => (
            <article key={stat.label} className="panel stat-card">
              <p>{stat.label}</p>
              <h3 className="stat-value">{stat.value}</h3>
              <span>{stat.trend}</span>
            </article>
          ))}
        </div>

        <section className="panel panel-stack">
          <div className="section-head">
            <div>
              <p className="eyebrow">Performance</p>
              <h2>Revenue activity</h2>
            </div>
            <p>Last 30 days</p>
          </div>
          <div className="chart-grid">
            <span style={{ height: '42%' }} />
            <span style={{ height: '58%' }} />
            <span style={{ height: '47%' }} />
            <span style={{ height: '72%' }} />
            <span style={{ height: '64%' }} />
            <span style={{ height: '88%' }} />
            <span style={{ height: '55%' }} />
          </div>
        </section>

        <section className="panel panel-stack">
          <div className="section-head">
            <div>
              <p className="eyebrow">Orders</p>
              <h2>Recent transactions</h2>
            </div>
            <Link to="/admin/products" className="btn btn-link">
              View inventory
            </Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>#DA-8921</td>
                  <td>Elena Martinez</td>
                  <td>Fulfilled</td>
                  <td style={{ textAlign: 'right' }}>$450.00</td>
                </tr>
                <tr>
                  <td>#DA-8920</td>
                  <td>Julian Smith</td>
                  <td>Pending</td>
                  <td style={{ textAlign: 'right' }}>$1,280.00</td>
                </tr>
                <tr>
                  <td>#DA-8919</td>
                  <td>Kasper Berg</td>
                  <td>Fulfilled</td>
                  <td style={{ textAlign: 'right' }}>$85.00</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </PageWrapper>
  )
}
