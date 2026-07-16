import { useState, useEffect } from 'react';
import './PhoneInput.css';

const COUNTRY_CODES = [
  { code: '+91', label: 'IN (+91)' },
  { code: '+1', label: 'US (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+61', label: 'AU (+61)' },
  { code: '+81', label: 'JP (+81)' },
  { code: '+49', label: 'DE (+49)' },
  { code: '+33', label: 'FR (+33)' },
  { code: '+86', label: 'CN (+86)' },
  { code: '+971', label: 'AE (+971)' },
  { code: '+65', label: 'SG (+65)' }
];

export default function PhoneInput({ label, value, onChange, required, placeholder, name, ...props }) {
  const getInitialState = () => {
    const val = (value || '').trim();
    for (const c of COUNTRY_CODES) {
      if (val.startsWith(c.code)) {
        return {
          code: c.code,
          number: val.slice(c.code.length).trim()
        };
      }
    }
    return { code: '+91', number: val };
  };

  const [state, setState] = useState(getInitialState());
  const [isValid, setIsValid] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setState(getInitialState());
  }, [value]);

  useEffect(() => {
    let valid = true;
    let error = '';

    const digitsOnly = state.number.replace(/\D/g, '');
    if (state.number.length > 0) {
      if (digitsOnly.length < 8 || digitsOnly.length > 15) {
        valid = false;
        error = 'Please enter a valid phone number.';
      }
    }

    setIsValid(valid);
    setErrorMessage(error);
  }, [state.number]);

  const handleCodeChange = (e) => {
    const newCode = e.target.value;
    setState(prev => ({ ...prev, code: newCode }));
    triggerChange(newCode, state.number);
  };

  const handleNumberChange = (e) => {
    const newNumber = e.target.value.replace(/[^\d\s-]/g, '');
    setState(prev => ({ ...prev, number: newNumber }));
    triggerChange(state.code, newNumber);
  };

  const triggerChange = (code, number) => {
    const fullNumber = number ? `${code} ${number}` : '';
    if (onChange) {
      onChange({ target: { value: fullNumber, name } });
    }
  };

  const hasValue = state.number.length > 0;
  const shouldShowValidationIcon = hasValue && isValid;

  return (
    <label className="field-group phone-input-group">
      {label && <span className="field-label">{label}{required && ' *'}</span>}
      <div className={`field-control phone-input-control ${shouldShowValidationIcon ? 'field-control-with-icon' : ''}`.trim()}>
        <select 
          className="field phone-country-select" 
          value={state.code}
          onChange={handleCodeChange}
        >
          {COUNTRY_CODES.map(c => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
        <input 
          className="field phone-number-input" 
          value={state.number}
          onChange={handleNumberChange}
          placeholder={placeholder || "Phone number"}
          required={required}
          type="tel"
          name={name}
          {...props}
        />
        {shouldShowValidationIcon ? <span className="field-validation-icon" aria-hidden="true">✓</span> : null}
      </div>
      {!isValid && errorMessage ? (
        <span className="field-error-message" style={{ color: 'var(--accent-red, #e74c3c)', fontSize: '0.8rem', marginTop: '4px', display: 'block' }}>
          {errorMessage}
        </span>
      ) : null}
    </label>
  );
}
