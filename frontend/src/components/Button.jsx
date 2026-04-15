import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

const MotionLink = motion(Link)
const buttonMotionProps = {
  whileHover: { y: -2 },
  whileTap: { scale: 0.96 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
}

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
      <MotionLink to={to} className={classes} {...buttonMotionProps}>
        {children}
      </MotionLink>
    )
  }

  return (
    <motion.button type={type} className={classes} onClick={onClick} {...buttonMotionProps}>
      {children}
    </motion.button>
  )
}
