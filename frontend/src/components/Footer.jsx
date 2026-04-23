import { useEffect, useState } from 'react'
import { fetchPublicPlatformSettings, getCachedBranding, onBrandingUpdated } from '../utils/platform'

export default function Footer() {
  const [branding, setBranding] = useState(getCachedBranding())

  useEffect(() => {
    let mounted = true
    const syncBranding = async () => {
      try {
        const next = await fetchPublicPlatformSettings()
        if (!mounted) {
          return
        }
        setBranding(next)
      } catch {
        if (!mounted) {
          return
        }
        setBranding(getCachedBranding())
      }
    }

    const unsubscribe = onBrandingUpdated((event) => {
      setBranding(event?.detail || getCachedBranding())
    })

    syncBranding()

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  return (
    <footer className="footer">
      <div className="shell footer-grid">
        <section>
          <h4>{branding.platform_name} E-Commerce Platform</h4>
          <p>Modern commerce UI with editorial clarity, consistent spacing, and a polished shopping flow.</p>
        </section>
        <section>
          <h5>Shop</h5>
          <p>New Arrivals</p>
          <p>Collections</p>
          <p>Lookbook</p>
        </section>
        <section>
          <h5>Support</h5>
          <p>Shipping</p>
          <p>Returns</p>
          <p>Order Status</p>
        </section>
        <section>
          <h5>Contact</h5>
          <p>support@movifashion.com</p>
          <p>Mon - Sat, 9am - 6pm</p>
          <p>Global shipping</p>
        </section>
      </div>
      <div className="shell">
        <p className="copyright">Copyright 2026 {branding.platform_name} E-Commerce Platform. All rights reserved.</p>
      </div>
    </footer>
  )
}
