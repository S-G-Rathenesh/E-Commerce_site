import { useState, useRef, useEffect } from 'react'

export default function Input({ label, multiline = false, className = '', showValidationIcon = true, validationState, ...props }) {
  const inputValue = props.value ?? props.defaultValue ?? ''
  const hasValue = typeof inputValue === 'string' ? inputValue.trim().length > 0 : Boolean(inputValue)
  
  const [isValid, setIsValid] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const inputRef = useRef(null)

  // Use standard HTML5 validation to check if format is correct
  useEffect(() => {
    let valid = true
    let error = ''

    if (hasValue) {
      if (inputRef.current && !inputRef.current.checkValidity()) {
        valid = false
        error = inputRef.current.validationMessage || 'Invalid format'
      } else if (props.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputValue)) {
        valid = false
        error = 'Please enter a valid email address.'
      } else if (label && /name/i.test(label) && /\d/.test(inputValue)) {
        valid = false
        error = 'Name should not contain numbers.'
      } else if (label && /city/i.test(label) && /\d/.test(inputValue)) {
        valid = false
        error = 'City should not contain numbers.'
      } else if (label && /postal|pincode|zip/i.test(label)) {
        if (!/^\d+$/.test(inputValue)) {
          valid = false
          error = 'Postal code should contain only numbers.'
        } else if (inputValue.length < 5) {
          valid = false
          error = 'Postal code is too short.'
        }
      }
    }

    setIsValid(valid)
    setErrorMessage(error)
  }, [inputValue, props.type, props.required, props.pattern, label])

  const shouldShowValidationIcon =
    showValidationIcon &&
    !multiline &&
    props.type !== 'file' &&
    !props.disabled &&
    !props.readOnly &&
    (validationState === 'valid' || (!validationState && hasValue && isValid))

  return (
    <label className="field-group">
      {label ? <span className="field-label">{label}</span> : null}
      <div className={`field-control ${shouldShowValidationIcon ? 'field-control-with-icon' : ''}`.trim()}>
        {multiline ? (
          <textarea className={`field ${className}`.trim()} {...props} />
        ) : (
          <input ref={inputRef} className={`field ${className}`.trim()} {...props} />
        )}
        {shouldShowValidationIcon ? <span className="field-validation-icon" aria-hidden="true">✓</span> : null}
      </div>
      {!isValid && errorMessage ? (
        <span className="field-error-message" style={{ color: 'var(--accent-red, #e74c3c)', fontSize: '0.8rem', marginTop: '4px', display: 'block' }}>
          {errorMessage}
        </span>
      ) : null}
    </label>
  )
}
