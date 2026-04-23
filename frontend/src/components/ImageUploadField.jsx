import { useEffect, useRef, useState } from 'react'
import { buildAuthHeaders } from '../utils/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const API_FALLBACK_BASE = API_BASE.includes('127.0.0.1') ? API_BASE.replace('127.0.0.1', 'localhost') : ''
const API_CANDIDATES = Array.from(new Set([API_BASE, API_FALLBACK_BASE, 'http://127.0.0.1:8000', 'http://localhost:8000'].filter(Boolean)))
const UPLOAD_TIMEOUT_MS = 20000
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function createTimeoutController(timeoutMs) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, timeoutId }
}

function resolvePreviewSource(value) {
  const nextValue = String(value || '').trim()
  if (!nextValue) {
    return ''
  }
  if (nextValue.startsWith('http://') || nextValue.startsWith('https://') || nextValue.startsWith('data:') || nextValue.startsWith('blob:')) {
    return nextValue
  }
  if (nextValue.startsWith('/')) {
    return `${API_BASE}${nextValue}`
  }
  return nextValue
}

export default function ImageUploadField({
  label,
  value,
  onChange,
  onUploadingChange,
  description = 'Drop an image or paste a direct URL.',
  placeholder = 'https://...',
  required = false,
  disabled = false,
  helperText = 'JPG, PNG, or WEBP up to 2MB.',
}) {
  const fileInputRef = useRef(null)
  const [isUploading, setIsUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')
  const [previewSource, setPreviewSource] = useState(resolvePreviewSource(value))

  useEffect(() => {
    setPreviewSource(resolvePreviewSource(value))
  }, [value])

  useEffect(() => {
    if (typeof onUploadingChange === 'function') {
      onUploadingChange(isUploading)
    }
    return () => {
      if (typeof onUploadingChange === 'function') {
        onUploadingChange(false)
      }
    }
  }, [isUploading, onUploadingChange])

  const commitValue = (nextValue) => {
    if (typeof onChange === 'function') {
      onChange(nextValue)
    }
  }

  const validateFile = (file) => {
    if (!file) {
      return 'Select an image first.'
    }
    if (!ACCEPTED_TYPES.includes(String(file.type || '').toLowerCase())) {
      return 'Only JPG, PNG, and WEBP images are supported.'
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return 'Image must be 2MB or smaller.'
    }
    return ''
  }

  const uploadFile = async (file) => {
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setError('')
    setIsUploading(true)

    const optimisticPreview = URL.createObjectURL(file)
    setPreviewSource(optimisticPreview)

    try {
      let uploadedUrl = ''
      let lastError = null

      for (const baseUrl of API_CANDIDATES) {
        const formData = new FormData()
        formData.append('file', file)

        const { controller, timeoutId } = createTimeoutController(UPLOAD_TIMEOUT_MS)
        try {
          const response = await fetch(`${baseUrl}/media/upload-image`, {
            method: 'POST',
            headers: buildAuthHeaders(),
            body: formData,
            signal: controller.signal,
          })
          const data = await response.json().catch(() => ({}))

          if (!response.ok) {
            lastError = new Error(data?.detail || 'Unable to upload image right now.')
            continue
          }

          uploadedUrl = String(data?.image_url || '').trim()
          if (!uploadedUrl) {
            lastError = new Error('Upload completed without an image URL.')
            continue
          }

          break
        } catch (requestError) {
          if (requestError?.name === 'AbortError') {
            lastError = new Error('Upload timed out. Check backend connectivity and try again.')
            continue
          }
          lastError = requestError
          continue
        } finally {
          clearTimeout(timeoutId)
        }
      }

      if (!uploadedUrl) {
        throw lastError || new Error('Unable to upload image right now.')
      }

      commitValue(uploadedUrl)
      setPreviewSource(uploadedUrl)
    } catch (uploadError) {
      setError(uploadError?.message || 'Unable to upload image right now.')
      setPreviewSource(resolvePreviewSource(value))
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    if (file) {
      void uploadFile(file)
    }
    event.target.value = ''
  }

  const handleDrop = (event) => {
    event.preventDefault()
    if (disabled || isUploading) {
      return
    }
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (file) {
      void uploadFile(file)
    }
  }

  const handleClear = () => {
    setError('')
    setPreviewSource('')
    commitValue('')
  }

  return (
    <div className="field-group image-upload-field">
      <div className="image-upload-head">
        <span className="field-label">{label}</span>
        {required ? <span className="field-valid">Required</span> : null}
      </div>
      <p className="image-upload-description">{description}</p>

      <div
        className={`image-upload-dropzone ${dragActive ? 'image-upload-dropzone-active' : ''} ${disabled ? 'image-upload-dropzone-disabled' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) {
            setDragActive(true)
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {previewSource ? (
          <img className="image-upload-preview" src={previewSource} alt={label} />
        ) : (
          <div className="image-upload-placeholder">
            <strong>No image selected</strong>
            <span>{helperText}</span>
          </div>
        )}

        <div className="image-upload-copy">
          <p>Drop a file here or browse for one. The image uploads instantly and returns a reusable URL.</p>
          <div className="row-gap image-upload-actions">
            <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={disabled || isUploading}>
              {isUploading ? 'Uploading...' : 'Browse files'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleClear} disabled={disabled || (!previewSource && !value)}>
              Clear
            </button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        className="image-upload-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        disabled={disabled || isUploading}
      />

      <input
        className="field"
        type="url"
        value={value}
        onChange={(event) => commitValue(event.target.value)}
        placeholder={placeholder}
        disabled={disabled || isUploading}
      />

      {error ? <p className="field-error">{error}</p> : null}
    </div>
  )
}
