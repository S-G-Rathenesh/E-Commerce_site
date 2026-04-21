import { useEffect, useState } from 'react'
import { buildAuthHeaders } from '../utils/auth'
import { getRelativeTime } from '../utils/adminUi'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export default function ReturnApprovalsPanel() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [reviewNoteByOrder, setReviewNoteByOrder] = useState({})

  const loadReturns = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/admin/returns?status_filter=RETURN_REQUESTED`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load return approvals.')
        setItems([])
        return
      }

      const nextItems = Array.isArray(data?.returns) ? data.returns : []
      setItems(nextItems)
      window.dispatchEvent(new CustomEvent('returns-changed', { detail: { count: nextItems.length } }))
      setMessage('')
    } catch {
      setMessage('Unable to load return approvals.')
      setItems([])
      window.dispatchEvent(new CustomEvent('returns-changed', { detail: { count: 0 } }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReturns()
  }, [])

  const updateDecision = async (orderId, decision) => {
    try {
      const response = await fetch(`${API_BASE}/admin/returns/${encodeURIComponent(orderId)}/decision`, {
        method: 'PUT',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          decision,
          review_note: reviewNoteByOrder[orderId] || '',
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || `Unable to ${decision === 'APPROVE' ? 'approve' : 'reject'} return.`)
        return
      }

      setMessage(data?.message || `Return request ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`)
      loadReturns()
    } catch {
      setMessage(`Unable to ${decision === 'APPROVE' ? 'approve' : 'reject'} return.`)
    }
  }

  return (
    <section className="panel panel-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Returns</p>
          <h2>Return approvals</h2>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadReturns}>
          Refresh
        </button>
      </div>

      {message ? <p className="wishlist-message">{message}</p> : null}
      {loading ? <p>Loading return requests...</p> : null}
      {!loading && items.length === 0 ? <p>No pending return approvals.</p> : null}

      <div className="admin-orders-stack">
        {items.map((item) => {
          const order = item.order || {}
          const proofImages = Array.isArray(item.proof_images) ? item.proof_images : []
          return (
            <article key={item.id || item.order_id} className="section-card panel-stack">
              <div className="section-head">
                <div>
                  <h3>{item.order_id}</h3>
                  <p>{order.customer_email || 'Unknown customer'}</p>
                  <p>Requested {getRelativeTime(item.created_at)}</p>
                </div>
                <p>{String(item.status || 'RETURN_REQUESTED').replaceAll('_', ' ')}</p>
              </div>

              <div className="admin-orders-grid">
                <div className="field-group">
                  <span className="field-label">Reason</span>
                  <p>{item.reason || 'No reason provided'}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Issue details</span>
                  <p>{item.issue_details || 'No additional details provided'}</p>
                </div>
                <div className="field-group">
                  <span className="field-label">Order value</span>
                  <p>Rs. {Number(order.total_amount || 0).toLocaleString('en-IN')}</p>
                </div>
              </div>

              {proofImages.length > 0 ? (
                <div className="field-group">
                  <span className="field-label">Proof images</span>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {proofImages.map((image, index) => (
                      <a key={`${item.order_id}-proof-${index + 1}`} href={image} target="_blank" rel="noreferrer">
                        <img
                          src={image}
                          alt={`Return proof ${index + 1}`}
                          style={{
                            width: '76px',
                            height: '76px',
                            borderRadius: '8px',
                            objectFit: 'cover',
                            border: '1px solid #d1d5db',
                          }}
                        />
                      </a>
                    ))}
                  </div>
                </div>
              ) : (
                <p>No proof images uploaded.</p>
              )}

              <label className="field-group">
                <span className="field-label">Review note</span>
                <textarea
                  className="field"
                  value={reviewNoteByOrder[item.order_id] || ''}
                  onChange={(event) =>
                    setReviewNoteByOrder((current) => ({
                      ...current,
                      [item.order_id]: event.target.value,
                    }))
                  }
                  placeholder="Add notes for approval/rejection"
                  rows={3}
                />
              </label>

              <div className="admin-controls-row">
                <button type="button" className="btn btn-primary" onClick={() => updateDecision(item.order_id, 'APPROVE')}>
                  Approve Return
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => updateDecision(item.order_id, 'REJECT')}>
                  Reject Return
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
