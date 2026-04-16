import { motion } from 'framer-motion'

const defaultTransition = {
  duration: 0.38,
  ease: [0.22, 1, 0.36, 1],
}

export default function AnimatedSection({ as = 'section', children, className = '', delay = 0, ...props }) {
  const MotionTag = motion[as]

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ ...defaultTransition, delay }}
      {...props}
    >
      {children}
    </MotionTag>
  )
}
