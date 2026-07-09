/**
 * onError handler for <img> tags.
 * If an image fails to load (404, network error, etc.) hide it gracefully
 * rather than showing the browser's broken-image icon.
 *
 * Usage:
 *   <img src={url} alt="..." onError={imgFallback} />
 */
export function imgFallback(event) {
  const img = event.currentTarget;

  // Avoid infinite loop if the fallback src itself fails
  img.onerror = null;
  img.style.opacity = "0";
}

/**
 * Like imgFallback but replaces the broken image with a grey placeholder div.
 * Useful inside flex/grid layouts where the image slot must maintain its size.
 */
export function imgFallbackReplace(event) {
  const img = event.currentTarget;

  img.onerror = null;

  const placeholder = document.createElement("div");
  placeholder.className = img.className + " img-placeholder";
  placeholder.setAttribute("aria-hidden", "true");

  img.parentNode?.replaceChild(placeholder, img);
}