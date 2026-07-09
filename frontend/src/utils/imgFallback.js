export function imgFallback(e) {
  e.target.onerror = null; // Prevent infinite loop if fallback also fails
  e.target.src = 'https://via.placeholder.com/300?text=Image+Not+Found';
}
