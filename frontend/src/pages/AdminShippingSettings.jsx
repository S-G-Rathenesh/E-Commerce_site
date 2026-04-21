import PageWrapper from '../components/PageWrapper'
import ShippingConfiguration from '../components/ShippingConfiguration'

export default function AdminShippingSettings() {
  return (
    <PageWrapper className="page-merchant" eyebrow="Settings" title="Shipping and delivery settings" description="Configure warehouse, delivery pricing, serviceability rules, and COD settings. System auto-calculates charges and delivery time.">
      <div className="container admin-container">
        <section className="section">
          <ShippingConfiguration />
        </section>
      </div>
    </PageWrapper>
  )
}
