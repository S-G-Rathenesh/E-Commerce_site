import PageWrapper from '../components/PageWrapper'
import AdminOrdersManager from '../components/AdminOrdersManager'

export default function AdminOrdersPage() {
  return (
    <PageWrapper className="page-admin" eyebrow="Orders" title="Order operations control center" description="Run end-to-end order workflows from filters through shipment and tracking updates.">
      <div className="container admin-container">
        <section className="section">
          <AdminOrdersManager />
        </section>
      </div>
    </PageWrapper>
  )
}
