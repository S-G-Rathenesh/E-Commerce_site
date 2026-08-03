import { useEffect, useState } from 'react'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const MAX_FEEDBACK_LENGTH = 300

const DONE_COPY = {
  1: { emoji: '😞', title: 'Sorry to hear that' },
  2: { emoji: '😕', title: 'Thanks for letting us know' },
  3: { emoji: '🙂', title: 'Thanks for the feedback' },
  4: { emoji: '😊', title: 'Glad it went well!' },
  5: { emoji: '🤩', title: 'Awesome, thank you!' },
}

export default function DeliveryRating({ orderId }) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [bounceStar, setBounceStar] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [submittedRating, setSubmittedRating] = useState(null)
  const [submittedFeedback, setSubmittedFeedback] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadExistingRating() {
      if (!orderId) {
        setIsLoading(false)
        return
      }

      try {
        const response = await fetch(`${API_BASE}/orders/${orderId}/delivery-rating`, {
          headers: buildAuthHeaders(),
        })

        if (!response.ok) {
          return
        }

        const data = await response.json()
        if (isMounted && data?.rating) {
          setSubmittedRating(data.rating)
          setSubmittedFeedback(data.feedback || '')
        }
      } catch {
        // Silently ignore — the widget just falls back to the rating form.
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadExistingRating()

    return () => {
      isMounted = false
    }
  }, [orderId])

  function handleStarClick(value) {
    setRating(value)
    setBounceStar(value)
    setTimeout(() => setBounceStar(0), 550)
  }

  async function handleSubmit() {
    if (!rating || isSubmitting) {
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/orders/${orderId}/delivery-rating`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({ rating, feedback: feedback.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data?.detail || 'Unable to submit your delivery rating.')
        return
      }

      setSubmittedRating(rating)
      setSubmittedFeedback(feedback.trim())
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
          <p className="dr-done-sub">You rated this delivery {submittedRating} / 5.</p>
          {submittedFeedback ? <p className="dr-done-quote">"{submittedFeedback}"</p> : null}
        </div>
      </div>
    )
  }

  const activeRating = hoverRating || rating

  return (
    <div className="dr-wrap">
      <div className="dr-header">
        <span className="dr-title">How was your delivery?</span>
        <span className="dr-hint">Tap a star to rate</span>
      </div>

      <div className="dr-stars" role="radiogroup" aria-label="Rate your delivery experience">
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
            placeholder="Anything about the delivery you'd like to share? (optional)"
            value={feedback}
            maxLength={MAX_FEEDBACK_LENGTH}
            onChange={(event) => setFeedback(event.target.value)}
          />
          <div className="dr-actions">
            <span className="dr-char-count">{feedback.length}/{MAX_FEEDBACK_LENGTH}</span>
            <button
              type="button"
              className="btn btn-primary dr-submit"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Submit rating'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="login-message">{error}</p> : null}
    </div>
  )
}
