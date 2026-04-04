export default function Input({ label, multiline = false, className = '', ...props }) {
  return (
    <label className="field-group">
      {label ? <span className="field-label">{label}</span> : null}
      {multiline ? (
        <textarea className={`field ${className}`.trim()} {...props} />
      ) : (
        <input className={`field ${className}`.trim()} {...props} />
      )}
    </label>
  )
}
