import { Link } from 'react-router-dom'

export default function Button({
  children,
  variant = 'primary',
  to,
  type = 'button',
  className = '',
  onClick,
}) {
  const classes = `btn btn-${variant} ${className}`.trim()

  if (to) {
    return (
      <Link to={to} className={classes}>
        {children}
      </Link>
    )
  }

  return (
    <button type={type} className={classes} onClick={onClick}>
      {children}
    </button>
  )
}
