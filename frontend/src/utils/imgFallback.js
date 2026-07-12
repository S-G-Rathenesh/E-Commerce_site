import { PLACEHOLDER_SVG } from './resolveImageUrl';

/**
 * onError handler for <img> tags.
 * Replaces broken images with the default placeholder SVG.
 */
export function imgFallback(event) {
  const img = event.currentTarget || event.target;

  // Prevent infinite loop if placeholder also fails
  img.onerror = null;
  img.src = PLACEHOLDER_SVG;
}

/**
 * Like imgFallback but replaces the broken image with a grey placeholder div.
 * Useful inside flex/grid layouts where the image slot must maintain its size.
 */
export function imgFallbackReplace(event) {
  const img = event.currentTarget;

  img.onerror = null;

  const placeholder = document.createElement("div");
  placeholder.className = `${img.className} img-placeholder`;
  placeholder.setAttribute("aria-hidden", "true");

  img.parentNode?.replaceChild(placeholder, img);
}