export const products = [
  {
    id: 1,
    name: 'Architectural Blazer',
    category: 'Outerwear',
    price: 450,
    image:
      'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=80',
    description:
      'A precision-cut blazer crafted from wool blend fabric for structured layering and all-day comfort.',
  },
  {
    id: 2,
    name: 'Atelier Cashmere Crew',
    category: 'Knitwear',
    price: 295,
    image:
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80',
    description:
      'Soft cashmere crew-neck with a minimal silhouette and premium finish.',
  },
  {
    id: 3,
    name: 'Raw Selvedge Denim',
    category: 'Bottoms',
    price: 180,
    image:
      'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80',
    description:
      'Straight-cut raw denim with a durable weave built for long-term wear.',
  },
  {
    id: 4,
    name: 'Observation Trench',
    category: 'Outerwear',
    price: 520,
    image:
      'https://images.unsplash.com/photo-1551232864-3f0890e580d9?auto=format&fit=crop&w=900&q=80',
    description:
      'Weather-ready trench coat with technical details and clean architectural lines.',
  },
  {
    id: 5,
    name: 'Canvas Linen Shirt',
    category: 'Shirts',
    price: 120,
    image:
      'https://images.unsplash.com/photo-1527719327859-c6ce80353573?auto=format&fit=crop&w=900&q=80',
    description:
      'Breathable linen shirt for warm days with a tailored relaxed fit.',
  },
  {
    id: 6,
    name: 'City Chelsea Boot',
    category: 'Footwear',
    price: 380,
    image:
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80',
    description:
      'Polished leather boots designed for modern city movement.',
  },
]

export function findProductById(id) {
  return products.find((product) => product.id === Number(id))
}
