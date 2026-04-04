export default function PageWrapper({ eyebrow, title, description, actions, children, className = '' }) {
  return (
    <div className={`page-shell ${className}`.trim()}>
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
    </div>
  )
}
