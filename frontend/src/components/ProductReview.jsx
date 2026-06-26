import { useState } from 'react'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const MAX_REVIEW_LENGTH = 500

export default function ProductReview({ productId, orderId, onSubmitSuccess }) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

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

      setRating(0)
      setReviewText('')
      onSubmitSuccess?.()
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
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
            className={`dr-star ${activeRating >= value ? 'dr-star-on' : ''}`.trim()}
            onClick={() => setRating(value)}
            onMouseEnter={() => setHoverRating(value)}
            onMouseLeave={() => setHoverRating(0)}
          >
            {activeRating >= value ? '★' : '☆'}
          </button>
        ))}
        {rating ? <span className="dr-label">{rating} / 5</span> : null}
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
