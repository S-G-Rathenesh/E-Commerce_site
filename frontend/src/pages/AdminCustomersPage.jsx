import { useEffect, useMemo, useState } from 'react'
import PageWrapper from '../components/PageWrapper'
import DeliveryApprovalsPanel from '../components/DeliveryApprovalsPanel'
import ReturnApprovalsPanel from '../components/ReturnApprovalsPanel'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

function getInitials(email) {
  const text = String(email || 'U').trim().toUpperCase()
  return text.slice(0, 2)
}

export default function AdminCustomersPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [segment, setSegment] = useState('ALL')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const loadOrders = async () => {
      setLoading(true)
      try {
        const response = await fetch(`${API_BASE}/admin/orders`, {
          headers: buildAuthHeaders(),
        })
        const data = await response.json()
        if (!response.ok) {
          setOrders([])
          return
        }
        setOrders(Array.isArray(data?.orders) ? data.orders : [])
      } catch {
        setOrders([])
      } finally {
        setLoading(false)
      }
    }

    loadOrders()
  }, [])

  const customers = useMemo(() => {
    const grouped = orders.reduce((accumulator, order) => {
      const email = String(order.customer_email || '').trim().toLowerCase()
      if (!email) return accumulator

      if (!accumulator[email]) {
        accumulator[email] = {
          email,
          orders: 0,
          spent: 0,
          firstOrderAt: order.created_at || null,
          lastOrderAt: order.created_at || null,
        }
      }

      const current = accumulator[email]
      current.orders += 1
      current.spent += Number(order.total_amount || 0)

      if (order.created_at && (!current.firstOrderAt || order.created_at < current.firstOrderAt)) {
        current.firstOrderAt = order.created_at
      }
      if (order.created_at && (!current.lastOrderAt || order.created_at > current.lastOrderAt)) {
        current.lastOrderAt = order.created_at
      }

      return accumulator
    }, {})

    return Object.values(grouped).sort((first, second) => second.spent - first.spent)
  }, [orders])

  const segmentedCounts = useMemo(() => {
    const newCount = customers.filter((customer) => customer.orders <= 1).length
    const returningCount = customers.filter((customer) => customer.orders > 1).length
    const highValueCount = customers.filter((customer) => customer.spent >= 10000).length
    return {
      ALL: customers.length,
      NEW: newCount,
      RETURNING: returningCount,
      HIGH_VALUE: highValueCount,
    }
  }, [customers])

  const filteredCustomers = useMemo(() => {
    const lowered = query.trim().toLowerCase()

    return customers.filter((customer) => {
      const searchMatch = !lowered || customer.email.includes(lowered)
      if (!searchMatch) return false

      if (segment === 'NEW') {
        return customer.orders <= 1
      }
      if (segment === 'RETURNING') {
        return customer.orders > 1
      }
      if (segment === 'HIGH_VALUE') {
        return customer.spent >= 10000
      }

      return true
    })
  }, [customers, query, segment])

  return (
    <PageWrapper
      className="page-admin"
      eyebrow="Customers"
      title="Customer insights"
      description="Understand customer quality, segment value cohorts, and review user approvals from one page."
    >
      <div className="container admin-container">
        <section className="section card panel panel-stack">
          <div className="dashboard-grid">
            <article className="panel stat-card card">
              <p>Total customers</p>
              <h3 className="stat-value">{customers.length}</h3>
              <span>Unique buyers</span>
            </article>
            <article className="panel stat-card card">
              <p>New customers</p>
              <h3 className="stat-value">{segmentedCounts.NEW}</h3>
              <span>First-time buyers</span>
            </article>
            <article className="panel stat-card card">
              <p>High value customers</p>
              <h3 className="stat-value">{segmentedCounts.HIGH_VALUE}</h3>
              <span>Spent Rs. 10,000+</span>
            </article>
          </div>
        </section>

        <section className="section card panel panel-stack">
          <div className="section-head">
            <div>
              <p className="eyebrow">Segments</p>
              <h2>Customer list</h2>
            </div>
          </div>

          <div className="admin-controls-row">
            <div className="tab-strip">
              {[
                { key: 'ALL', label: `All (${segmentedCounts.ALL})` },
                { key: 'NEW', label: `New (${segmentedCounts.NEW})` },
                { key: 'RETURNING', label: `Returning (${segmentedCounts.RETURNING})` },
                { key: 'HIGH_VALUE', label: `High-value (${segmentedCounts.HIGH_VALUE})` },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`tab-button ${segment === item.key ? 'tab-button-active' : ''}`}
                  onClick={() => setSegment(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <input
              className="field"
              placeholder="Search by name or email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {loading ? <p>Loading customers...</p> : null}
          {!loading && filteredCustomers.length === 0 ? <p className="empty-state">No customers found.</p> : null}

          {!loading && filteredCustomers.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Orders</th>
                    <th style={{ textAlign: 'right' }}>Total Spend</th>
                    <th>Segment</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((customer) => (
                    <tr key={customer.email}>
                      <td>
                        <div className="customer-cell">
                          <span className="avatar-pill">{getInitials(customer.email)}</span>
                          <span>{customer.email}</span>
                        </div>
                      </td>
                      <td>{customer.orders}</td>
                      <td style={{ textAlign: 'right' }}>Rs. {customer.spent.toLocaleString('en-IN')}</td>
                      <td>
                        {customer.spent >= 10000
                          ? 'High-value'
                          : customer.orders > 1
                            ? 'Returning'
                            : 'New'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="section">
          <DeliveryApprovalsPanel />
        </section>

        <section className="section">
          <ReturnApprovalsPanel />
        </section>
      </div>
    </PageWrapper>
  )
}
