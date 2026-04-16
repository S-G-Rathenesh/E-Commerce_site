import { useEffect, useState } from 'react'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export default function DeliveryApprovalsPanel() {
  const [users, setUsers] = useState([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  const loadPending = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/admin/user-approvals?status_filter=PENDING`, {
        headers: buildAuthHeaders(),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to load pending user approvals.')
        setUsers([])
        return
      }
      setUsers(Array.isArray(data?.users) ? data.users : [])
      setMessage('')
    } catch {
      setMessage('Unable to load pending user approvals.')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPending()
  }, [])

  const updateStatus = async (userId, statusValue) => {
    try {
      const response = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PUT',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ status: statusValue }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data?.detail || 'Unable to update user approval status.')
        return
      }
      setMessage(statusValue === 'ACTIVE' ? 'User approved successfully.' : 'User rejected successfully.')
      loadPending()
    } catch {
      setMessage('Unable to update user approval status.')
    }
  }

  return (
    <section className="panel panel-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Approvals</p>
          <h2>User approvals</h2>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadPending}>
          Refresh
        </button>
      </div>

      {message ? <p className="wishlist-message">{message}</p> : null}
      {loading ? <p>Loading pending approvals...</p> : null}

      {!loading && users.length === 0 ? <p>No pending users.</p> : null}

      <div className="admin-orders-stack">
        {users.map((user) => (
          <article key={user.id || user.email} className="section-card panel-stack">
            <div className="section-head">
              <div>
                <h3>{user.full_name || user.name || 'Pending User'}</h3>
                <p>{user.email}</p>
              </div>
              <p>{user.status || 'PENDING'}</p>
            </div>
            <div className="admin-orders-grid">
              <div className="field-group">
                <span className="field-label">Role</span>
                <p>{user.role || '-'}</p>
              </div>
              <div className="field-group">
                <span className="field-label">Account ID</span>
                <p>{user.id || '-'}</p>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => updateStatus(user.id, 'ACTIVE')}>
                Approve
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => updateStatus(user.id, 'BLOCKED')}>
                Reject
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
