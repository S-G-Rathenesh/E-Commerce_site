import { useEffect, useState } from 'react'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const MAX_REVIEW_LENGTH = 500

const DONE_COPY = {
  1: { emoji: '😞', title: 'Sorry to hear that' },
  2: { emoji: '😕', title: 'Thanks for letting us know' },
  3: { emoji: '🙂', title: 'Thanks for the feedback' },
  4: { emoji: '😊', title: 'Glad you liked it!' },
  5: { emoji: '🤩', title: 'Awesome, thank you!' },
}

export default function ProductReview({ productId, orderId, onSubmitSuccess }) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [bounceStar, setBounceStar] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [submittedRating, setSubmittedRating] = useState(null)
  const [submittedText, setSubmittedText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadExistingReview() {
      if (!productId || !orderId) {
        setIsLoading(false)
        return
      }

      try {
        const response = await fetch(
          `${API_BASE}/products/${productId}/reviews/mine?order_id=${encodeURIComponent(orderId)}`,
          { headers: buildAuthHeaders() }
        )

        if (!response.ok) {
          return
        }

        const data = await response.json()
        if (isMounted && data?.rating) {
          setSubmittedRating(data.rating)
          setSubmittedText(data.review_text || '')
        }
      } catch {
        // Silently ignore — the widget just falls back to the rating form.
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadExistingReview()

    return () => {
      isMounted = false
    }
  }, [productId, orderId])

  function handleStarClick(value) {
    setRating(value)
    setBounceStar(value)
    setTimeout(() => setBounceStar(0), 550)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!rating || isSubmitting) {
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/products/${productId}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({
          rating,
          review_text: reviewText.trim(),
          order_id: orderId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data?.detail || 'Unable to submit your review.')
        return
      }

      setSubmittedRating(rating)
      setSubmittedText(reviewText.trim())
      onSubmitSuccess?.()
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return null
  }

  if (submittedRating) {
    const copy = DONE_COPY[submittedRating] || DONE_COPY[5]
    return (
      <div className="dr-wrap dr-done">
        <span className="dr-done-emoji" aria-hidden="true">{copy.emoji}</span>
        <div>
          <p className="dr-done-title">{copy.title}</p>
          <p className="dr-done-sub">You rated this product {submittedRating} / 5.</p>
          {submittedText ? <p className="dr-done-quote">"{submittedText}"</p> : null}
        </div>
      </div>
    )
  }

  const activeRating = hoverRating || rating

  return (
    <form className="dr-wrap" onSubmit={handleSubmit}>
      <div className="dr-header">
        <span className="dr-title">Rate this product</span>
        <span className="dr-hint">Tap a star to rate</span>
      </div>

      <div className="dr-stars" role="radiogroup" aria-label="Rate this product">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} star${value > 1 ? 's' : ''}`}
            className={`dr-star ${activeRating >= value ? 'dr-star-on' : ''} ${bounceStar === value ? 'dr-star-bounce' : ''}`.trim()}
            onClick={() => handleStarClick(value)}
            onMouseEnter={() => setHoverRating(value)}
            onMouseLeave={() => setHoverRating(0)}
          >
            {activeRating >= value ? '★' : '☆'}
          </button>
        ))}
        {rating ? <span className={`dr-label ${bounceStar ? 'dr-label-pop' : ''}`.trim()}>{rating} / 5</span> : null}
      </div>

      {rating ? (
        <div className="dr-feedback-wrap">
          <textarea
            className="dr-textarea"
            placeholder="Share your thoughts about this product (optional)"
            value={reviewText}
            maxLength={MAX_REVIEW_LENGTH}
            onChange={(event) => setReviewText(event.target.value)}
          />
          <div className="dr-actions">
            <span className="dr-char-count">{reviewText.length}/{MAX_REVIEW_LENGTH}</span>
            <button type="submit" className="btn btn-primary dr-submit" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting...' : 'Submit review'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="login-message">{error}</p> : null}
    </form>
  )
}
