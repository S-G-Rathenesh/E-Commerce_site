import { useEffect, useMemo, useState } from 'react'

const numberPattern = /[^\d.]/g

function parseDisplayValue(value) {
  const source = String(value || '')
  const numericPart = Number(source.replace(numberPattern, '')) || 0
  const hasCurrency = source.includes('$') || source.includes('₹') || source.toLowerCase().includes('rs')
  const hasK = source.toLowerCase().includes('k')
  const decimals = source.includes('.') ? 1 : 0
  const suffix = hasK ? 'k' : ''

  return {
    numericPart,
    hasCurrency,
    decimals,
    suffix,
  }
}

export default function AnimatedCounter({ value, duration = 460 }) {
  const [frameValue, setFrameValue] = useState(0)
  const parsed = useMemo(() => parseDisplayValue(value), [value])

  useEffect(() => {
    let rafId = 0
    const start = performance.now()

    const tick = (now) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setFrameValue(parsed.numericPart * eased)

      if (progress < 1) {
        rafId = requestAnimationFrame(tick)
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [duration, parsed.numericPart])

  const formatted = frameValue.toFixed(parsed.decimals)
  const output = `${parsed.hasCurrency ? 'Rs. ' : ''}${formatted}${parsed.suffix}`

  return <>{output}</>
}
