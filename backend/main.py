from fastapi import FastAPI, HTTPException
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


class SignupRequest(BaseModel):
    full_name: str
    email: str
    password: str


class GoogleAuthRequest(BaseModel):
    email: str
    full_name: str | None = None


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


USERS = {
    'merchant@atelier.com': {
        'full_name': 'Demo Merchant',
        'email': 'merchant@atelier.com',
        'password': 'merchant123',
        'provider': 'email',
        'role': 'merchant',
    },
    'user@atelier.com': {
        'full_name': 'Demo User',
        'email': 'user@atelier.com',
        'password': 'user123',
        'provider': 'email',
        'role': 'user',
    },
}


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
    email = payload.email.strip().lower()
    account = USERS.get(email)

    if not account:
        raise HTTPException(status_code=404, detail='Account not found. Please sign up first.')

    if account.get('provider') == 'google':
        raise HTTPException(status_code=400, detail='This account uses Google sign-in. Please continue with Google.')

    if account.get('password') != payload.password:
        raise HTTPException(status_code=401, detail='Invalid email or password.')

    return {
        'message': f"Welcome back, {account['full_name']}!",
        'role': account.get('role', 'user'),
        'user': {
            'full_name': account['full_name'],
            'email': account['email'],
            'provider': account['provider'],
        },
    }


@app.post('/signup')
def signup(payload: SignupRequest):
    email = payload.email.strip().lower()

    if email in USERS:
        raise HTTPException(status_code=409, detail='Account already exists. Please login.')

    USERS[email] = {
        'full_name': payload.full_name.strip() or 'New User',
        'email': email,
        'password': payload.password,
        'provider': 'email',
        'role': 'user',
    }

    account = USERS[email]
    return {
        'message': f"Account created for {account['full_name']}.",
        'role': account['role'],
        'user': {
            'full_name': account['full_name'],
            'email': account['email'],
            'provider': account['provider'],
        },
    }


@app.post('/auth/google')
def google_auth(payload: GoogleAuthRequest):
    email = payload.email.strip().lower()

    if not email:
        raise HTTPException(status_code=400, detail='Google email is required.')

    account = USERS.get(email)
    if not account:
        display_name = (payload.full_name or '').strip() or email.split('@')[0].replace('.', ' ').title()
        USERS[email] = {
            'full_name': display_name,
            'email': email,
            'password': '',
            'provider': 'google',
            'role': 'user',
        }
        account = USERS[email]

    return {
        'message': f"Signed in with Google as {account['full_name']}.",
        'role': account.get('role', 'user'),
        'user': {
            'full_name': account['full_name'],
            'email': account['email'],
            'provider': 'google',
        },
    }
