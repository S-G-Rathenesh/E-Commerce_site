export default function Input({ label, multiline = false, className = '', showValidationIcon = true, validationState, ...props }) {
  const inputValue = props.value ?? props.defaultValue ?? ''
  const hasValue = typeof inputValue === 'string' ? inputValue.trim().length > 0 : Boolean(inputValue)
  const shouldShowValidationIcon =
    showValidationIcon &&
    !multiline &&
    props.type !== 'file' &&
    !props.disabled &&
    !props.readOnly &&
    (validationState === 'valid' || (!validationState && hasValue))

  return (
    <label className="field-group">
      {label ? <span className="field-label">{label}</span> : null}
      <div className={`field-control ${shouldShowValidationIcon ? 'field-control-with-icon' : ''}`.trim()}>
        {multiline ? (
          <textarea className={`field ${className}`.trim()} {...props} />
        ) : (
          <input className={`field ${className}`.trim()} {...props} />
        )}
        {shouldShowValidationIcon ? <span className="field-validation-icon" aria-hidden="true">✓</span> : null}
      </div>
    </label>
  )
}
