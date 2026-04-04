from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title='Digital Atelier API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


class LoginRequest(BaseModel):
    email: str
    password: str


PRODUCTS = [
    {
        'id': 1,
        'name': 'Architectural Blazer',
        'category': 'Outerwear',
        'price': 450.0,
        'image': 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=80',
        'description': 'A precision-cut blazer crafted from wool blend fabric for structured layering and all-day comfort.',
    },
    {
        'id': 2,
        'name': 'Atelier Cashmere Crew',
        'category': 'Knitwear',
        'price': 295.0,
        'image': 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80',
        'description': 'Soft cashmere crew-neck with a minimal silhouette and premium finish.',
    },
    {
        'id': 3,
        'name': 'Raw Selvedge Denim',
        'category': 'Bottoms',
        'price': 180.0,
        'image': 'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80',
        'description': 'Straight-cut raw denim with a durable weave built for long-term wear.',
    },
]


@app.get('/')
def root():
    return {'service': 'Digital Atelier API', 'status': 'ok'}


@app.get('/products')
def get_products():
    return PRODUCTS


@app.get('/product/{product_id}')
def get_product(product_id: int):
    for product in PRODUCTS:
        if product['id'] == product_id:
            return product
    return {'error': 'Product not found'}


@app.post('/login')
def login(payload: LoginRequest):
    if payload.email and payload.password:
        return {'message': f'Welcome back, {payload.email}!'}
    return {'message': 'Invalid credentials'}
