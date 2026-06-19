import { useState, useEffect, useRef } from 'react'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const LABELS = ['Terrible', 'Poor', 'Okay', 'Good', 'Excellent!']
const EMOJIS = ['😞', '😕', '😐', '😊', '🤩']

const STORAGE_KEY = (orderId) => `delivery_rating_${orderId}`

function loadSaved(orderId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(orderId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function savePersist(orderId, data) {
  try {
    localStorage.setItem(STORAGE_KEY(orderId), JSON.stringify(data))
  } catch {}
}

export default function DeliveryRating({ orderId }) {
  const saved = loadSaved(orderId)
  const [hover, setHover] = useState(0)
  const [selected, setSelected] = useState(saved?.rating || 0)
  const [feedback, setFeedback] = useState(saved?.feedback || '')
  const [submitted, setSubmitted] = useState(Boolean(saved?.submitted))
  const [animating, setAnimating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const textareaRef = useRef(null)

  // Focus textarea when a star is picked
  useEffect(() => {
    if (selected > 0 && !submitted) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [selected, submitted])

  const activeRating = hover || selected

  const handleStar = (val) => {
    if (submitted) return
    setSelected(val)
    setAnimating(true)
    setTimeout(() => setAnimating(false), 600)
  }

  const handleSubmit = async () => {
    if (!selected || submitting) return
    setSubmitting(true)
    try {
      // Best-effort POST — endpoint may not exist yet, we swallow errors gracefully
      await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/rate`, {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ rating: selected, feedback: feedback.trim() }),
      })
    } catch {}
    savePersist(orderId, { rating: selected, feedback, submitted: true })
    setSubmitted(true)
    setSubmitting(false)
    setMessage('')
  }

  if (submitted) {
    return (
      <div className="dr-wrap dr-done" aria-label="Rating submitted">
        <span className="dr-done-emoji" style={{ animationName: 'dr-bounce' }}>{EMOJIS[selected - 1]}</span>
        <div>
          <p className="dr-done-title">Thanks for your feedback!</p>
          <p className="dr-done-sub">You rated this delivery <strong>{selected} / 5</strong> — {LABELS[selected - 1]}</p>
          {feedback.trim() ? <p className="dr-done-quote">"{feedback.trim()}"</p> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="dr-wrap" aria-label="Rate your delivery experience">
      <div className="dr-header">
        <span className="dr-title">How was your delivery?</span>
        {activeRating > 0 ? (
          <span className={`dr-label ${animating ? 'dr-label-pop' : ''}`}>
            {EMOJIS[activeRating - 1]}&nbsp;{LABELS[activeRating - 1]}
          </span>
        ) : (
          <span className="dr-hint">Tap a star to rate</span>
        )}
      </div>

      <div className="dr-stars" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((val) => (
          <button
            key={val}
            type="button"
            role="radio"
            aria-checked={selected === val}
            aria-label={`${val} star${val > 1 ? 's' : ''} — ${LABELS[val - 1]}`}
            className={`dr-star ${val <= activeRating ? 'dr-star-on' : ''} ${animating && val <= selected ? 'dr-star-bounce' : ''}`}
            onClick={() => handleStar(val)}
            onMouseEnter={() => setHover(val)}
            onMouseLeave={() => setHover(0)}
          >
            ★
          </button>
        ))}
      </div>

      {selected > 0 ? (
        <div className="dr-feedback-wrap">
          <textarea
            ref={textareaRef}
            className="dr-textarea field"
            placeholder="Tell us more (optional) — what went well or what could improve?"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            maxLength={300}
          />
          <div className="dr-actions">
            <span className="dr-char-count">{feedback.length}/300</span>
            <button
              type="button"
              className="btn btn-primary dr-submit"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : 'Submit Rating'}
            </button>
          </div>
        </div>
      ) : null}

      {message ? <p className="wishlist-message">{message}</p> : null}
    </div>
  )
}
