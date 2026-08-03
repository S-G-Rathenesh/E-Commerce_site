export default function SkeletonProductCard() {
  return (
    <article className="product-card product-card-skeleton" aria-hidden="true">
      <div className="product-image-wrap skeleton-shimmer" />
      <div className="product-content">
        <div className="skeleton-line skeleton-line-short skeleton-shimmer" />
        <div className="skeleton-line skeleton-line-medium skeleton-shimmer" />
        <div className="skeleton-line skeleton-line-long skeleton-shimmer" />
        <div className="skeleton-line skeleton-line-medium skeleton-shimmer" />
        <div className="product-card-actions">
          <div className="skeleton-btn skeleton-shimmer" />
          <div className="skeleton-btn skeleton-shimmer" />
        </div>
      </div>
    </article>
  )
}
