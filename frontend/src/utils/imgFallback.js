import { PLACEHOLDER_SVG } from './resolveImageUrl'

export function imgFallback(e) {
  e.target.onerror = null; // Prevent infinite loop if fallback also fails
  e.target.src = PLACEHOLDER_SVG;
}
