import { motion } from 'framer-motion'

export default function PageWrapper({ eyebrow, title, description, actions, children, className = '' }) {
  const MotionDiv = motion.div

  return (
    <MotionDiv
      className={`page-shell ${className}`.trim()}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {(eyebrow || title || description || actions) && (
        <header className="page-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h1 className="page-title">{title}</h1> : null}
            {description ? <p className="page-description">{description}</p> : null}
          </div>
          {actions ? <div className="page-actions">{actions}</div> : null}
        </header>
      )}
      {children}
    </MotionDiv>
  )
}
