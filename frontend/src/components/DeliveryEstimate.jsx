import { useEffect, useMemo, useRef, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const PINCODE_STORAGE_KEY = 'delivery-pincode'
const DELIVERY_CACHE_KEY = 'delivery-estimate-cache-v1'
const CACHE_TTL_MS = 1000 * 60 * 30
const INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/

const sanitizePincode = (value) => String(value || '').replace(/\D/g, '').slice(0, 6)

const readCache = () => {
  try {
    const raw = localStorage.getItem(DELIVERY_CACHE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  } catch {
    return {}
  }
  return {}
}

const writeCache = (cacheMap) => {
  try {
    localStorage.setItem(DELIVERY_CACHE_KEY, JSON.stringify(cacheMap))
  } catch {
    // Ignore storage write errors and continue with non-cached behavior.
  }
}

export default function DeliveryEstimate({ productId, currentUser }) {
  const userSavedPincode = sanitizePincode(currentUser?.pincode || '')
  const localSavedPincode = sanitizePincode(localStorage.getItem(PINCODE_STORAGE_KEY) || '')
  const initialPincode = userSavedPincode || localSavedPincode

  const [pincodeInput, setPincodeInput] = useState(initialPincode)
  const [deliveryResult, setDeliveryResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [requestError, setRequestError] = useState(null)
  const [cacheMap, setCacheMap] = useState(() => readCache())
  const activeRequestKey = useRef('')

  useEffect(() => {
    if (INDIAN_PINCODE_REGEX.test(pincodeInput)) {
      localStorage.setItem(PINCODE_STORAGE_KEY, pincodeInput)

      const storedUserRaw = localStorage.getItem('auth-user')
      if (storedUserRaw) {
        try {
          const storedUser = JSON.parse(storedUserRaw)
          if (storedUser && typeof storedUser === 'object') {
            storedUser.pincode = pincodeInput
            localStorage.setItem('auth-user', JSON.stringify(storedUser))
          }
        } catch {
          // Ignore malformed auth payload and keep local pincode only.
        }
      }
    }
  }, [pincodeInput])

  const isValidPincode = useMemo(() => INDIAN_PINCODE_REGEX.test(pincodeInput), [pincodeInput])
  const validationError = pincodeInput && !isValidPincode ? 'Please enter a valid 6-digit pincode.' : ''
  const currentRequestKey = `${productId}:${pincodeInput}`
  const effectiveDelivery =
    deliveryResult?.requestKey === currentRequestKey ? deliveryResult.data : null
  const effectiveError =
    validationError || (requestError?.requestKey === currentRequestKey ? requestError.message : '')
  const showDelivery = !validationError && Boolean(effectiveDelivery)
  const isDeliverable = showDelivery ? effectiveDelivery.delivery_available !== false : false

  useEffect(() => {
    if (!productId) {
      return
    }

    if (!pincodeInput || !isValidPincode) {
      return
    }

    const requestKey = `${productId}:${pincodeInput}`
    const cachedEntry = cacheMap[requestKey]
    if (cachedEntry && Date.now() - cachedEntry.cachedAt < CACHE_TTL_MS) {
      activeRequestKey.current = requestKey
      Promise.resolve().then(() => {
        setDeliveryResult({ requestKey, data: cachedEntry.data })
      })
      return
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      activeRequestKey.current = requestKey
      setIsLoading(true)

      fetch(`${API_BASE}/delivery/estimate?product_id=${productId}&pincode=${pincodeInput}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = await response.json()
          if (!response.ok) {
            const detail = typeof payload?.detail === 'string' ? payload.detail : 'Unable to estimate delivery right now.'
            throw new Error(detail)
          }
          return payload
        })
        .then((payload) => {
          setDeliveryResult({ requestKey, data: payload })
          setCacheMap((current) => {
            const next = {
              ...current,
              [requestKey]: {
                cachedAt: Date.now(),
                data: payload,
              },
            }
            writeCache(next)
            return next
          })
        })
        .catch((error) => {
          if (error.name !== 'AbortError') {
            setDeliveryResult(null)
            setRequestError({
              requestKey,
              message: error.message || 'Unable to estimate delivery right now.',
            })
          }
        })
        .finally(() => {
          setIsLoading(false)
        })
    }, 350)

    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [cacheMap, isValidPincode, pincodeInput, productId])

  return (
    <section className="detail-delivery-block" aria-label="Delivery estimate">
      <div className="detail-pincode-row">
        <input
          className="input detail-pincode-input"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={pincodeInput}
          onChange={(event) => setPincodeInput(sanitizePincode(event.target.value))}
          placeholder="Enter delivery pincode"
          aria-label="Enter delivery pincode"
        />
      </div>

      {isLoading ? <p className="detail-delivery-line">Checking delivery estimate...</p> : null}

      {!isLoading && showDelivery ? (
        <div className="detail-delivery-stack">
          <p className="detail-delivery-line">
            {isDeliverable ? 'Delivery available in your area' : 'Sorry, delivery not available'}
          </p>
          <p className="detail-delivery-line">📍 {effectiveDelivery.location_text || `Delivering to ${pincodeInput}`}</p>
          {isDeliverable ? <p className="detail-delivery-line">🚚 {effectiveDelivery.delivery_hint || effectiveDelivery.delivery_text}</p> : null}
          {isDeliverable ? <p className="detail-delivery-line">✔ Free Delivery</p> : null}
          {isDeliverable && effectiveDelivery.order_within_text ? <p className="detail-delivery-meta">{effectiveDelivery.order_within_text}</p> : null}
        </div>
      ) : null}

      {!isLoading && effectiveError ? <p className="wishlist-message">{effectiveError}</p> : null}
    </section>
  )
}
