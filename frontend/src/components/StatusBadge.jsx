import { formatStatusLabel, getStatusBadgeClass } from '../utils/adminUi'

export default function StatusBadge({ status }) {
  return <span className={getStatusBadgeClass(status)}>{formatStatusLabel(status)}</span>
}
