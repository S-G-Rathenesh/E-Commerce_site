import { useEffect, useState } from 'react'
import { buildAuthHeaders } from '../utils/auth'
import { getFinalDeliveryCharge } from '../utils/shipping'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export default function DeliveryInfo({ customerPincode, orderTotal = 0, showDetails = true }) {
  const [delivery, setDelivery] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const finalDeliveryCharge = getFinalDeliveryCharge(orderTotal)

  useEffect(() => {
    if (!customerPincode) {
      setLoading(false)
      return
    }

    const checkDelivery = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(
          `${API_BASE}/check-delivery?customer_pincode=${customerPincode}&order_total=${Number(orderTotal) || 0}`,
          {
          headers: buildAuthHeaders(),
          },
        )
        const data = await response.json()

        if (!response.ok) {
          setError(data?.detail || 'Unable to check delivery.')
          setDelivery(null)
          return
        }

        setDelivery(data)
      } catch (err) {
        setError('Unable to check delivery availability.')
        setDelivery(null)
      } finally {
        setLoading(false)
      }
    }

    checkDelivery()
  }, [customerPincode, orderTotal])

  if (!customerPincode) {
    return null
  }

  if (loading) {
    return (
      <div className="delivery-info delivery-info-loading">
        Checking delivery availability...
      </div>
    )
  }

  if (error) {
    return (
      <div className="delivery-info delivery-info-error">
        ⚠ {error}
      </div>
    )
  }

  if (!delivery) {
    return null
  }

  if (!delivery.is_serviceable) {
    return (
      <div className="delivery-info delivery-info-error">
        ✗ Delivery not available for pincode {customerPincode}
      </div>
    )
  }

  return (
    <div className="delivery-info delivery-info-success">
      <div className="delivery-info-grid">
        <div>
          {showDetails && (
            <>
              <p>
                <strong>✓ {finalDeliveryCharge === 0 ? 'Delivery: FREE' : 'Delivery ₹49'}</strong>
              </p>
              <p>✓ Estimated delivery: {delivery.estimated_days}</p>
              {delivery.cod_available && (
                <p>
                  ✓ Cash on Delivery available
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
