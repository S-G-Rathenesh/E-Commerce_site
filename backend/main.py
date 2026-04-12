import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
from pymongo.errors import PyMongoError

load_dotenv()

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


SEED_PRODUCTS = [
    {
        'id': 1,
        'name': 'Architectural Blazer',
        'section': 'women',
        'category': 'Outerwear',
        'productType': 'Blazers',
        'subType': 'Single Breasted',
        'price': 450.0,
        'image': 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=80',
        'description': 'A precision-cut blazer crafted from wool blend fabric for structured layering and all-day comfort.',
    },
    {
        'id': 2,
        'section': 'men',
        'name': 'Atelier Cashmere Crew',
        'productType': 'Sweaters',
        'subType': 'Crew Neck',
        'category': 'Knitwear',
        'price': 295.0,
        'image': 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80',
        'description': 'Soft cashmere crew-neck with a minimal silhouette and premium finish.',
    },
    {
        'id': 3,
        'name': 'Raw Selvedge Denim',
        'section': 'men',
        'category': 'Bottoms',
        'productType': 'Jeans',
        'subType': 'Straight Fit',
        'price': 180.0,
        'image': 'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80',
        'description': 'Straight-cut raw denim with a durable weave built for long-term wear.',
    },
]


OLD_DEMO_EMAILS = [
    'merchant@atelier.com',
    'user@atelier.com',
]

SEED_USERS = {
    'merchant.demo@veloura.com': {
        'full_name': 'Demo Merchant',
        'email': 'merchant.demo@veloura.com',
        'password': 'Merchant@2026',
        'provider': 'email',
        'role': 'merchant',
    },
    'user.demo@veloura.com': {
        'full_name': 'Demo User',
        'email': 'user.demo@veloura.com',
        'password': 'User@2026',
        'provider': 'email',
        'role': 'user',
    },
}

mongo_uri = os.getenv('MONGO_URI', '').strip()
mongo_db_name = os.getenv('MONGO_DB_NAME', 'ecommerce').strip() or 'ecommerce'

if not mongo_uri:
    raise RuntimeError('Missing MONGO_URI. Add it to backend/.env or environment variables before starting the API.')

mongo_client = MongoClient(mongo_uri)
database = mongo_client[mongo_db_name]
products_collection = database['products']
users_collection = database['users']


def seed_collections_if_empty():
    if products_collection.count_documents({}) == 0:
        products_collection.insert_many(SEED_PRODUCTS)

    users_collection.delete_many({'email': {'$in': OLD_DEMO_EMAILS}})

    for email, account in SEED_USERS.items():
        users_collection.update_one(
            {'email': email},
            {'$set': account},
            upsert=True,
        )


@app.on_event('startup')
def ensure_database_ready():
    try:
        mongo_client.admin.command('ping')
        seed_collections_if_empty()
    except PyMongoError as exc:
        raise RuntimeError(f'Unable to connect to MongoDB: {exc}') from exc


def serialize_product(document: dict):
    document.pop('_id', None)
    return document


def serialize_user(document: dict):
    document.pop('_id', None)
    document.pop('password', None)
    return document


@app.get('/')
def root():
    return {'service': 'Digital Atelier API', 'status': 'ok'}


@app.get('/products')
def get_products():
    products = list(products_collection.find({}, {'_id': 0}))
    return [serialize_product(product) for product in products]


@app.get('/product/{product_id}')
def get_product(product_id: int):
    product = products_collection.find_one({'id': product_id}, {'_id': 0})
    if not product:
        return {'error': 'Product not found'}
    return serialize_product(product)


@app.post('/login')
def login(payload: LoginRequest):
    email = payload.email.strip().lower()
    account = users_collection.find_one({'email': email})

    if not account:
        raise HTTPException(status_code=404, detail='Account not found. Please sign up first.')

    if account.get('provider') == 'google':
        raise HTTPException(status_code=400, detail='This account uses Google sign-in. Please continue with Google.')

    if account.get('password') != payload.password:
        raise HTTPException(status_code=401, detail='Invalid email or password.')

    return {
        'message': f"Welcome back, {account['full_name']}!",
        'role': account.get('role', 'user'),
        'user': serialize_user(account),
    }


@app.post('/signup')
def signup(payload: SignupRequest):
    email = payload.email.strip().lower()

    if users_collection.find_one({'email': email}):
        raise HTTPException(status_code=409, detail='Account already exists. Please login.')

    account = {
        'full_name': payload.full_name.strip() or 'New User',
        'email': email,
        'password': payload.password,
        'provider': 'email',
        'role': 'user',
    }
    users_collection.insert_one(account)

    return {
        'message': f"Account created for {account['full_name']}.",
        'role': account['role'],
        'user': serialize_user(account),
    }


@app.post('/auth/google')
def google_auth(payload: GoogleAuthRequest):
    email = payload.email.strip().lower()

    if not email:
        raise HTTPException(status_code=400, detail='Google email is required.')

    account = users_collection.find_one({'email': email})
    if not account:
        display_name = (payload.full_name or '').strip() or email.split('@')[0].replace('.', ' ').title()
        account = {
            'full_name': display_name,
            'email': email,
            'password': '',
            'provider': 'google',
            'role': 'user',
        }
        users_collection.insert_one(account)

    return {
        'message': f"Signed in with Google as {account['full_name']}.",
        'role': account.get('role', 'user'),
        'user': serialize_user(account),
    }
