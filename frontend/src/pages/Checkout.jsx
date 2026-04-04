import Button from '../components/Button'
import Input from '../components/Input'
import PageWrapper from '../components/PageWrapper'

export default function Checkout() {
  return (
    <PageWrapper
      eyebrow="Checkout"
      title="Secure checkout"
      description="A centered, consistent checkout experience with structured sections and one primary action style."
    >
      <div className="checkout-grid">
        <section className="panel panel-stack">
          <h2>Shipping details</h2>
          <div className="form-grid">
            <Input label="Full name" placeholder="e.g. Julianne Moore" />
            <Input label="Phone number" placeholder="+1 (555) 000-0000" />
            <Input label="City" placeholder="New York" />
            <Input label="Postal code" placeholder="10001" />
            <Input label="Street address" placeholder="Apartment, suite, unit, etc." multiline rows={4} />
          </div>
        </section>
        <aside className="panel panel-stack">
          <h2>Order summary</h2>
          <div className="summary-row">
            <p>Subtotal: $745.00</p>
            <p>Discount: -$45.00</p>
            <p>Shipping: Free</p>
            <p className="detail-price">Total: $700.00</p>
          </div>
          <Button variant="primary" className="btn-wide">
            Complete Order
          </Button>
        </aside>
      </div>
    </PageWrapper>
  )
}
