import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import Button from '../components/Button'
import AdminOrdersManager from '../components/AdminOrdersManager'
import DeliveryApprovalsPanel from '../components/DeliveryApprovalsPanel'
import DeliveryCoverageSettings from '../components/DeliveryCoverageSettings'
import RevenueChart from '../components/RevenueChart'
import OrdersBarChart from '../components/OrdersBarChart'
import AnimatedCounter from '../components/AnimatedCounter'
import AnimatedSection from '../components/AnimatedSection'
import PageWrapper from '../components/PageWrapper'

const stats = [
  { label: 'Total Sales', value: 'Rs. 24,000', trend: '+12.5%' },
  { label: 'Orders', value: '1.2k', trend: '+8.2%' },
  { label: 'New Customers', value: '400', trend: '-2.4%' },
]

const dashboardSummary = {
  dashboard: {
    eyebrow: 'Admin',
    title: 'Store operations dashboard',
    description: 'A compact, grid-based admin area with matching cards, spacing, and strong visual hierarchy.',
  },
  orders: {
    eyebrow: 'Orders',
    title: 'Order management',
    description: 'Track processing states, fulfillment progress, and order volume from one place.',
  },
  customers: {
    eyebrow: 'Customers',
    title: 'Customer overview',
    description: 'See customer activity and relationship status to support retention and service quality.',
  },
  analytics: {
    eyebrow: 'Analytics',
    title: 'Sales analytics',
    description: 'Review performance trends and revenue movement across your recent selling window.',
  },
  profile: {
    eyebrow: 'Profile',
    title: 'Merchant profile',
    description: 'Manage merchant account details and keep your storefront identity up to date.',
  },
}

const topCustomers = [
  { name: 'Elena Martinez', orders: 16, spent: 'Rs. 4,290.00' },
  { name: 'Julian Smith', orders: 11, spent: 'Rs. 2,875.00' },
  { name: 'Kasper Berg', orders: 9, spent: 'Rs. 1,430.00' },
]

export default function AdminDashboard() {
  const MotionArticle = motion.article
  const { pathname, search } = useLocation()
  const searchParams = new URLSearchParams(search)
  const legacyTab = (searchParams.get('tab') || '').trim().toLowerCase()

  let currentSection = 'dashboard'
  if (pathname === '/admin/orders') currentSection = 'orders'
  else if (pathname === '/admin/customers') currentSection = 'customers'
  else if (pathname === '/admin/analytics') currentSection = 'analytics'
  else if (pathname === '/admin/profile') currentSection = 'profile'
  else if (pathname === '/admin' && legacyTab) currentSection = legacyTab

  if (!dashboardSummary[currentSection]) {
    currentSection = 'dashboard'
  }

  const page = dashboardSummary[currentSection]
  const pageActions = currentSection === 'dashboard' ? <Button to="/admin/products">Manage Products</Button> : null

  return (
    <PageWrapper
      eyebrow={page.eyebrow}
      title={page.title}
      description={page.description}
      actions={pageActions}
    >
      {currentSection === 'dashboard' ? (
        <div className="admin-layout">
          <div className="stats-grid">
            {stats.map((stat, index) => (
              <MotionArticle
                key={stat.label}
                className="panel stat-card"
                whileHover={{
                  y: -4,
                  scale: 1.03,
                  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.16)',
                }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                style={{ willChange: 'transform, opacity' }}
              >
                <p>{stat.label}</p>
                <h3 className="stat-value">
                  <AnimatedCounter value={stat.value} duration={420 + index * 40} />
                </h3>
                <span>{stat.trend}</span>
              </MotionArticle>
            ))}
          </div>

          <AnimatedSection as="section" className="panel panel-stack">
            <div className="section-head">
              <div>
                <p className="eyebrow">Performance</p>
                <h2>Revenue activity</h2>
              </div>
              <p>Last 30 days</p>
            </div>
            <RevenueChart />
            <div className="section-head" style={{ marginTop: 8 }}>
              <div>
                <h2>Orders overview</h2>
              </div>
              <p>Last 7 days</p>
            </div>
            <OrdersBarChart />
          </AnimatedSection>

          <AnimatedSection as="section" delay={0.04}>
            <AdminOrdersManager compact />
          </AnimatedSection>

          <AnimatedSection as="section" delay={0.05}>
            <DeliveryCoverageSettings />
          </AnimatedSection>
        </div>
      ) : null}

      {currentSection === 'orders' ? (
        <AnimatedSection as="section">
          <AdminOrdersManager />
        </AnimatedSection>
      ) : null}

      {currentSection === 'customers' ? (
        <div className="admin-layout">
          <AnimatedSection as="section" className="panel panel-stack">
            <div className="section-head">
              <div>
                <p className="eyebrow">Customers</p>
                <h2>Top customer activity</h2>
              </div>
              <p>Last 30 days</p>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Orders</th>
                    <th style={{ textAlign: 'right' }}>Total Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((customer) => (
                    <tr key={customer.name}>
                      <td>{customer.name}</td>
                      <td>{customer.orders}</td>
                      <td style={{ textAlign: 'right' }}>{customer.spent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AnimatedSection>

          <AnimatedSection as="section" delay={0.03}>
            <DeliveryApprovalsPanel />
          </AnimatedSection>
        </div>
      ) : null}

      {currentSection === 'analytics' ? (
        <AnimatedSection as="section" className="panel panel-stack">
          <div className="section-head">
            <div>
              <p className="eyebrow">Analytics</p>
              <h2>Revenue activity</h2>
            </div>
            <p>Last 30 days</p>
          </div>
          <RevenueChart />
          <div className="section-head" style={{ marginTop: 8 }}>
            <div>
              <h2>Orders overview</h2>
            </div>
            <p>Last 7 days</p>
          </div>
          <OrdersBarChart />
          <div className="stats-grid">
            {stats.map((stat, index) => (
              <MotionArticle
                key={stat.label}
                className="panel stat-card"
                whileHover={{
                  y: -4,
                  scale: 1.03,
                  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.16)',
                }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                style={{ willChange: 'transform, opacity' }}
              >
                <p>{stat.label}</p>
                <h3 className="stat-value">
                  <AnimatedCounter value={stat.value} duration={420 + index * 40} />
                </h3>
                <span>{stat.trend}</span>
              </MotionArticle>
            ))}
          </div>
        </AnimatedSection>
      ) : null}

      {currentSection === 'profile' ? (
        <AnimatedSection as="section" className="panel panel-stack">
          <div className="section-head">
            <div>
              <p className="eyebrow">Profile</p>
              <h2>Merchant account</h2>
            </div>
          </div>
          <p>Profile tools are ready for account settings and store details.</p>
          <div>
            <Link to="/admin" className="btn btn-link">
              Back to dashboard
            </Link>
          </div>
        </AnimatedSection>
      ) : null}
    </PageWrapper>
  )
}
