import asyncio
import base64
import os
import random
import re
from datetime import datetime, timezone, timedelta
try:
    from datetime import UTC
except ImportError:
    UTC = timezone.utc
from typing import Callable
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
import json
import mongomock
from pymongo import MongoClient
from pymongo.errors import ConfigurationError, OperationFailure, PyMongoError

load_dotenv()
app = FastAPI(title='Digital Atelier API')


# Allow frontend to communicate with FastAPI backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_ROOT = os.path.join(os.path.dirname(__file__), 'uploads')
UPLOAD_IMAGE_ROOT = os.path.join(UPLOAD_ROOT, 'images')

ALLOWED_IMAGE_CONTENT_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
}

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_ROOT = os.path.join(os.path.dirname(__file__), 'uploads')

app = FastAPI(title='Digital Atelier API')
UPLOAD_ROOT = os.path.join(os.path.dirname(__file__), 'uploads')
UPLOAD_IMAGE_ROOT = os.path.join(UPLOAD_ROOT, 'images')
ALLOWED_IMAGE_CONTENT_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}
MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024

os.makedirs(UPLOAD_IMAGE_ROOT, exist_ok=True)

_MISSING_IMAGE_PLACEHOLDER = b'''<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360" role="img" aria-label="Image unavailable">
    <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f3f4f6" />
            <stop offset="100%" stop-color="#e5e7eb" />
        </linearGradient>
    </defs>
    <rect width="480" height="360" rx="24" fill="url(#bg)" />
    <rect x="86" y="76" width="308" height="208" rx="18" fill="#ffffff" stroke="#cbd5e1" stroke-width="4" />
    <circle cx="190" cy="152" r="18" fill="#94a3b8" />
    <path d="M122 244l68-72 58 54 44-36 66 54" fill="none" stroke="#94a3b8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
    <text x="240" y="318" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#64748b">Image unavailable</text>
</svg>'''

@app.get('/uploads/images/{filename}')
async def serve_upload_image(filename: str):
    from fastapi.responses import FileResponse, Response
    safe_name = os.path.basename(filename)
    file_path = os.path.join(UPLOAD_IMAGE_ROOT, safe_name)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    image_bytes, content_type = _load_uploaded_image(safe_name)
    if image_bytes is not None:
        return Response(content=image_bytes, media_type=content_type or 'application/octet-stream', status_code=200)
    return Response(content=_MISSING_IMAGE_PLACEHOLDER, media_type='image/svg+xml', status_code=200)


@app.get('/health')
def health_check():
    health_status = {
        'ok': True,
        'database_mode': database_mode,
        'mongo_ping': False,
        'mongo_read': False,
        'mongo_write': False,
    }

    try:
        mongo_client.admin.command('ping')
        health_status['mongo_ping'] = True

        health_collection = database['_health_checks']
        probe_id = str(uuid4())
        health_collection.insert_one({'_id': probe_id, 'checked_at': now_utc(), 'kind': 'health-check'})
        health_status['mongo_write'] = True
        health_status['mongo_read'] = health_collection.find_one({'_id': probe_id}) is not None
        health_collection.delete_one({'_id': probe_id})
    except Exception as exc:
        health_status['ok'] = False
        health_status['error'] = str(exc)

    return health_status


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}
    
    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
    
    async def disconnect(self, user_id: str, websocket: WebSocket):
        if user_id in self.active_connections:
            self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
    
    async def broadcast_to_user(self, user_id: str, message: dict):
        if user_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    disconnected.append(connection)
            
            for conn in disconnected:
                await self.disconnect(user_id, conn)

manager = ConnectionManager()


@app.websocket('/ws/orders/{user_id}')
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(user_id, websocket)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'veloura-dev-secret-change-me')
JWT_ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv('JWT_ACCESS_TOKEN_EXPIRE_HOURS', '12'))
REFRESH_TOKEN_EXPIRE_HOURS = int(os.getenv('JWT_REFRESH_TOKEN_EXPIRE_HOURS', '168'))
SUPER_ADMIN_SECRET_PATH = os.getenv('SUPER_ADMIN_SECRET_PATH', '/_private/ops/super-admin-portal-x9f4q2')

PASSWORD_CONTEXT = CryptContext(schemes=['bcrypt'], deprecated='auto')
oauth2_scheme = OAuth2PasswordBearer(tokenUrl='/auth/login')

ORDER_STATUS_FLOW = [
    'PLACED',
    'CONFIRMED',
    'PACKED',
    'ACCEPTED',
    'SHIPPED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
]
SHIPMENT_STATUS_FLOW = ['CREATED', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED_AT_CITY', 'OUT_FOR_DELIVERY', 'DELIVERED']
SHIPMENT_ENTITY_STATUSES = SHIPMENT_STATUS_FLOW
DELIVERY_FINAL_STATES = {'OUT_FOR_DELIVERY', 'DELIVERED'}
ORDER_STATUS_TRANSITIONS = {
    'PLACED': {'CONFIRMED', 'REJECTED', 'CANCELLED'},
    'CONFIRMED': {'PACKED'},
    'PACKED': {'ACCEPTED'},
    'ACCEPTED': {'SHIPPED'},
    'SHIPPED': {'OUT_FOR_DELIVERY'},
    'OUT_FOR_DELIVERY': {'DELIVERED'},
}
STATUS_PERFORMER_ROLE_MAP = {
    'CONFIRMED': {'ADMIN'},
    'REJECTED': {'ADMIN'},
    'PACKED': {'ADMIN', 'OPERATIONS_STAFF'},
    'ACCEPTED': {'DELIVERY_ASSOCIATE', 'ADMIN', 'OPERATIONS_STAFF'},
    'SHIPPED': {'ADMIN', 'OPERATIONS_STAFF', 'DELIVERY_ASSOCIATE'},
    'OUT_FOR_DELIVERY': {'DELIVERY_ASSOCIATE', 'ADMIN', 'OPERATIONS_STAFF'},
    'DELIVERED': {'DELIVERY_ASSOCIATE', 'ADMIN', 'OPERATIONS_STAFF'},
    'CANCELLED': {'CUSTOMER'},
}
PAYMENT_STATUSES = {'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'}
PAYMENT_METHODS = {'COD', 'UPI', 'CARD', 'NETBANKING', 'WALLET'}
ONLINE_PAYMENT_METHODS = {'UPI', 'CARD', 'NETBANKING', 'WALLET'}
RETURN_STATUS_FLOW = ['RETURN_REQUESTED', 'PICKUP', 'RETURNED', 'REFUNDED', 'RETURN_REJECTED']
SPECIAL_ORDER_STATUSES = {'REJECTED', 'CANCELLED', 'DELIVERY_FAILED'}
MERCHANT_REVIEW_STATUSES = {'PENDING', 'APPROVED', 'REJECTED'}
BANNER_REVIEW_STATUSES = {'PENDING', 'APPROVED', 'REJECTED'}
PRODUCT_REVIEW_STATUSES = {'PENDING', 'APPROVED', 'REJECTED'}
INDIA_PINCODE_REGEX = re.compile(r'^[1-9][0-9]{5}$')
DELIVERY_SCOPE_VALUES = {'NATIONWIDE', 'STATE', 'CITY'}
DEFAULT_MAX_ORDERS_PER_SHIPMENT = 10

PINCODE_DIRECTORY = {
    '110001': {'city': 'New Delhi', 'state': 'Delhi'},
    '122001': {'city': 'Gurugram', 'state': 'Haryana'},
    '201301': {'city': 'Noida', 'state': 'Uttar Pradesh'},
    '226001': {'city': 'Lucknow', 'state': 'Uttar Pradesh'},
    '302001': {'city': 'Jaipur', 'state': 'Rajasthan'},
    '380001': {'city': 'Ahmedabad', 'state': 'Gujarat'},
    '400001': {'city': 'Mumbai', 'state': 'Maharashtra'},
    '411001': {'city': 'Pune', 'state': 'Maharashtra'},
    '500001': {'city': 'Hyderabad', 'state': 'Telangana'},
    '560001': {'city': 'Bengaluru', 'state': 'Karnataka'},
    '600001': {'city': 'Chennai', 'state': 'Tamil Nadu'},
    '641035': {'city': 'Coimbatore', 'state': 'Tamil Nadu'},
    '682001': {'city': 'Kochi', 'state': 'Kerala'},
    '700001': {'city': 'Kolkata', 'state': 'West Bengal'},
    '751001': {'city': 'Bhubaneswar', 'state': 'Odisha'},
    '781001': {'city': 'Guwahati', 'state': 'Assam'},
    '800001': {'city': 'Patna', 'state': 'Bihar'},
}

PINCODE_STATE_PREFIX = {
    '11': 'Delhi',
    '12': 'Haryana',
    '20': 'Uttar Pradesh',
    '22': 'Uttar Pradesh',
    '30': 'Rajasthan',
    '38': 'Gujarat',
    '40': 'Maharashtra',
    '41': 'Maharashtra',
    '50': 'Telangana',
    '56': 'Karnataka',
    '60': 'Tamil Nadu',
    '64': 'Tamil Nadu',
    '68': 'Kerala',
    '70': 'West Bengal',
    '75': 'Odisha',
    '78': 'Assam',
    '80': 'Bihar',
}

INDIA_STATES = [
    'Andhra Pradesh',
    'Arunachal Pradesh',
    'Assam',
    'Bihar',
    'Chhattisgarh',
    'Goa',
    'Gujarat',
    'Haryana',
    'Himachal Pradesh',
    'Jharkhand',
    'Karnataka',
    'Kerala',
    'Madhya Pradesh',
    'Maharashtra',
    'Manipur',
    'Meghalaya',
    'Mizoram',
    'Nagaland',
    'Odisha',
    'Punjab',
    'Rajasthan',
    'Sikkim',
    'Tamil Nadu',
    'Telangana',
    'Tripura',
    'Uttar Pradesh',
    'Uttarakhand',
    'West Bengal',
    'Andaman and Nicobar Islands',
    'Chandigarh',
    'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi',
    'Jammu and Kashmir',
    'Ladakh',
    'Lakshadweep',
    'Puducherry',
]

STATE_NAME_LOOKUP = {state.strip().lower(): state for state in INDIA_STATES}
PINCODE_LOCATION_CACHE: dict[str, dict] = {}


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class UserAddressUpdateRequest(BaseModel):
    fullName: str
    phone: str
    city: str
    postalCode: str
    addressLine: str


class SignupRequest(BaseModel):
    full_name: str
    email: str
    password: str
    role: str = 'user'
    phone_number: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    profile_details: dict | None = None


class GoogleAuthRequest(BaseModel):
    email: str
    full_name: str | None = None


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class AssignDeliveryRequest(BaseModel):
    delivery_partner_email: str


class ShipmentUpdateRequest(BaseModel):
    courier_name: str
    tracking_id: str
    status: str
    current_location: str


class DeliveryStatusUpdateRequest(BaseModel):
    order_id: str
    status: str
    current_location: str | None = None


class DeliveryProfileUpdateRequest(BaseModel):
    full_name: str | None = None
    phone_number: str | None = None
    vehicle_type: str | None = None
    vehicle_number: str | None = None
    driving_license_number: str | None = None
    availability: str | None = None
    profile_image_url: str | None = None
    city: str | None = None
    state: str | None = None
    service_pincodes: list[str] | str | None = None
    allow_all_india: bool = False
    is_online: bool | None = None


class OrderItemCreateRequest(BaseModel):
    product_id: int
    quantity: int
    name: str | None = None
    price: float | None = None


class CreateOrderRequest(BaseModel):
    items: list[OrderItemCreateRequest]
    pincode: str
    payment_method: str = 'COD'
    payment_details: dict | None = None
    shipping_details: dict | None = None


class UpdateOrderStatusRequest(BaseModel):
    status: str
    current_location: str | None = None


class OrderActionRequest(BaseModel):
    current_location: str | None = None
    reason: str | None = None


class OrderStatusHistoryEntry(BaseModel):
    status: str
    timestamp: str
    performed_by: str
    performer_role: str
    performer_email: str
    location: str | None = None


class OrderStatusUpdateEvent(BaseModel):
    event_type: str = "order_status_updated"
    order_id: str
    new_status: str
    previous_status: str
    timestamp: str
    performed_by: str
    performer_role: str
    performer_email: str
    location: str | None = None
    message: str | None = None


class NotificationPayload(BaseModel):
    id: str
    event_type: str
    order_id: str
    user_id: str | None
    message: str
    is_read: bool
    created_at: str
    title: str | None = None
    timestamp: str | None = None


class PaymentUpdateRequest(BaseModel):
    status: str


class ReturnUpdateRequest(BaseModel):
    status: str
    location: str | None = None


class ReturnRequestCreateRequest(BaseModel):
    reason: str | None = None
    issue_details: str | None = None
    proof_images: list[str] | None = None


class ReturnDecisionRequest(BaseModel):
    decision: str
    review_note: str | None = None


class CancelOrderRequest(BaseModel):
    reason: str | None = None


class PurgeOrdersRequest(BaseModel):
    delete_all: bool = False
    statuses: list[str] | None = None


class OrderDataCleanupRequest(BaseModel):
    mode: str = 'RESET'
    demo_only: bool = True


class CreateShipmentRequest(BaseModel):
    order_ids: list[str]
    warehouse_id: str | None = None
    status: str = 'CREATED'
    courier_name: str = 'Assigned courier'
    tracking_id: str | None = None
    assigned_delivery_id: str | None = None
    max_orders_per_shipment: int | None = None
    destination_state: str | None = None
    destination_city: str | None = None
    vehicle_type: str = 'VAN'
    shipment_notes: str | None = None


class AutoCreateShipmentRequest(BaseModel):
    max_orders_per_shipment: int | None = None


class AccountStatusUpdateRequest(BaseModel):
    status: str = 'ACTIVE'


class MerchantProfileUpdateRequest(BaseModel):
    profile_details: dict | None = None
    phone_number: str | None = None
    bank_details: dict | None = None


class DeliveryCoverageCity(BaseModel):
    state: str
    city: str


class DeliveryCoverageRequest(BaseModel):
    delivery_scope: str = 'NATIONWIDE'
    states: list[str] | None = None
    cities: list[DeliveryCoverageCity] | None = None
    deliver_all_cities_in_selected_states: bool = False

class WarehouseConfig(BaseModel):
    address: str
    pincode: str
    contact_number: str


class DistanceBasedPricing(BaseModel):
    base_charge: float
    per_km_rate: float
    min_charge: float
    max_charge: float


class CourierConfig(BaseModel):
    available_couriers: list[str] = ['Local', 'Express', 'Premium']


class CODRules(BaseModel):
    cod_enabled: bool = True
    cod_limit: float = 100000
    cod_extra_charge: float = 0


class MerchantShippingSettingsRequest(BaseModel):
    warehouse: WarehouseConfig
    distance_pricing: DistanceBasedPricing
    couriers: CourierConfig
    cod_rules: CODRules
    allow_all_india: bool = True
    serviceable_pincodes: list[str] | None = None 
    blocked_pincodes: list[str] | None = None


class SavePaymentMethodRequest(BaseModel):
    method_type: str
    nickname: str | None = None
    upi_id: str | None = None
    card_number: str | None = None
    card_holder_name: str | None = None
    card_expiry: str | None = None
    bank_name: str | None = None
    wallet_provider: str | None = None
    is_default: bool = False


class UpdatePaymentMethodRequest(BaseModel):
    nickname: str | None = None
    is_default: bool | None = None


class SuperAdminMerchantDecisionRequest(BaseModel):
    merchant_status: str
    active: bool = True


class SuperAdminProductDecisionRequest(BaseModel):
    status: str


class BannerRequestCreateRequest(BaseModel):
    title: str
    subtitle: str | None = None
    image_url: str
    target_path: str = '/products'
    offer_text: str | None = None


class SuperAdminBannerDecisionRequest(BaseModel):
    status: str
    rejection_reason: str | None = None


class PlatformBrandingUpdateRequest(BaseModel):
    platform_name: str
    logo_url: str


class GlobalOfferUpdateRequest(BaseModel):
    title: str
    description: str | None = None
    discount_percent: float
    code: str | None = None
    active: bool = True


class MerchantProductRequest(BaseModel):
    name: str
    category: str
    price: float
    image: str
    description: str
    section: str = 'women'
    productType: str = ''
    subType: str = ''
    stock: int = 0
    fabric: str | None = None
    fit_type: str | None = None
    pattern: str | None = None
    sleeve_type: str | None = None
    neck_type: str | None = None
    occasion: str | None = None
    closure_type: str | None = None
    wash_care: str | None = None
    country_of_origin: str | None = None
    brand: str | None = None
    sku: str | None = None
    weight: str | None = None
    available_sizes: list[str] | None = None
    color: str | None = None
    stock_status: str | None = None


class WishlistRequest(BaseModel):
    product_id: int


class ProductReviewRequest(BaseModel):
    rating: int
    review_text: str | None = None
    order_id: str


class DeliveryRatingRequest(BaseModel):
    rating: int 
    feedback: str | None = None


class ReturnOrderRequest(BaseModel):
    reason: str
    issue_details: str | None = None
    proof_images: list[str] | None = None


class ReturnDecisionRequest(BaseModel):
    decision: str
    review_note: str | None = None




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
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
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
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
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
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 4,
        'name': 'Satin Slip Dress',
        'section': 'women',
        'category': 'Western Wear',
        'productType': 'Dresses',
        'subType': 'Midi Dress',
        'price': 399.0,
        'image': 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80',
        'description': 'Fluid satin midi dress with a flattering drape for evening edits.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 5,
        'name': 'Floral Day Dress',
        'section': 'women',
        'category': 'Western Wear',
        'productType': 'Dresses',
        'subType': 'Fit and Flare',
        'price': 349.0,
        'image': 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=900&q=80',
        'description': 'Soft cotton day dress with floral print and comfortable movement.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 6,
        'name': 'Pastel Anarkali Set',
        'section': 'women',
        'category': 'Ethnic Wear',
        'productType': 'Kurtas and Sets',
        'subType': 'Anarkali Set',
        'price': 620.0,
        'image': 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=80',
        'description': 'Festive-ready anarkali silhouette with lightweight dupatta and lining.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 7,
        'name': 'Ribbed Bodycon Dress',
        'section': 'women',
        'category': 'Western Wear',
        'productType': 'Dresses',
        'subType': 'Bodycon',
        'price': 289.0,
        'image': 'https://images.unsplash.com/photo-1464863979621-258859e62245?auto=format&fit=crop&w=900&q=80',
        'description': 'Stretch-knit bodycon dress designed for sleek all-day styling.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 8,
        'name': 'Everyday Polo Tee',
        'section': 'men',
        'category': 'Topwear',
        'productType': 'T-Shirts',
        'subType': 'Polo',
        'price': 220.0,
        'image': 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?auto=format&fit=crop&w=900&q=80',
        'description': 'Breathable cotton polo t-shirt with a modern slim profile.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 9,
        'name': 'Tailored Chino Pants',
        'section': 'men',
        'category': 'Bottomwear',
        'productType': 'Trousers',
        'subType': 'Slim Fit',
        'price': 310.0,
        'image': 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=80',
        'description': 'Sharp chino trousers with stretch comfort for work-to-weekend wear.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 10,
        'name': 'Weekend Bomber Jacket',
        'section': 'men',
        'category': 'Topwear',
        'productType': 'Jackets',
        'subType': 'Bomber',
        'price': 540.0,
        'image': 'https://images.unsplash.com/photo-1521223890158-f9f7c3d5d504?auto=format&fit=crop&w=900&q=80',
        'description': 'Lightweight bomber jacket built for smart layering in every season.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 11,
        'name': 'Linen Kurta',
        'section': 'men',
        'category': 'Ethnic Wear',
        'productType': 'Kurtas',
        'subType': 'Straight',
        'price': 360.0,
        'image': 'https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=900&q=80',
        'description': 'Breathable linen kurta with clean placket and festive-ready fit.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 12,
        'name': 'Printed Party Dress',
        'section': 'kids',
        'category': 'Girls Clothing',
        'productType': 'Dresses',
        'subType': 'Party Dress',
        'price': 275.0,
        'image': 'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?auto=format&fit=crop&w=900&q=80',
        'description': 'Playful printed dress with soft lining and twirl-friendly volume.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 13,
        'name': 'Denim Dungaree Set',
        'section': 'kids',
        'category': 'Unisex Clothing',
        'productType': 'Sets',
        'subType': 'Dungaree Set',
        'price': 330.0,
        'image': 'https://images.unsplash.com/photo-1519340241574-2cec6aef0c01?auto=format&fit=crop&w=900&q=80',
        'description': 'Soft denim dungaree with a lightweight tee for easy everyday styling.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 14,
        'name': 'Boys Graphic Sweatshirt',
        'section': 'kids',
        'category': 'Boys Clothing',
        'productType': 'Sweatshirts',
        'subType': 'Regular Fit',
        'price': 240.0,
        'image': 'https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?auto=format&fit=crop&w=900&q=80',
        'description': 'Cozy fleece sweatshirt with playful graphic print for daily wear.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 15,
        'name': 'Girls Pleated Skirt',
        'section': 'kids',
        'category': 'Girls Clothing',
        'productType': 'Bottomwear',
        'subType': 'Pleated Skirt',
        'price': 210.0,
        'image': 'https://images.unsplash.com/photo-1514090458221-65bb69cf63e6?auto=format&fit=crop&w=900&q=80',
        'description': 'Comfort-fit pleated skirt with elastic waist and soft texture.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 16,
        'name': 'Women Shirt Dress',
        'section': 'women',
        'category': 'Western Wear',
        'productType': 'Dresses',
        'subType': 'Shirt Dress',
        'price': 430.0,
        'image': 'https://images.unsplash.com/photo-1554412933-514a83d2f3c8?auto=format&fit=crop&w=900&q=80',
        'description': 'Classic shirt dress with waist tie and structured collar detail.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 17,
        'name': 'Men Oxford Shirt',
        'section': 'men',
        'category': 'Topwear',
        'productType': 'Shirts',
        'subType': 'Casual Shirt',
        'price': 340.0,
        'image': 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=900&q=80',
        'description': 'Premium oxford weave shirt with a clean silhouette and soft finish.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 18,
        'name': 'Kids Cotton Night Suit',
        'section': 'kids',
        'category': 'Unisex Clothing',
        'productType': 'Nightwear',
        'subType': 'Two Piece Set',
        'price': 260.0,
        'image': 'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=900&q=80',
        'description': 'Soft cotton night suit designed for breathable sleep comfort.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
    },
    {
        'id': 19,
        'name': 'Testing',
        'section': 'women',
        'category': 'Testing',
        'productType': 'Testing',
        'subType': 'Testing',
        'price': 150.0,
        'image': 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80',
        'description': 'Test product for development and QA purposes.',
        'merchant_id': 'USR-DEMO-ADMIN-01',
        'review_status': 'APPROVED',
        'stock': 9,
    },
]

SEED_USERS = {
    'admin.demo@veloura.com': {
        'id': 'USR-DEMO-ADMIN-01',
        'full_name': 'Demo Admin',
        'email': 'admin.demo@veloura.com',
        'password': 'Admin#Demo2026',
        'provider': 'email',
        'role': 'ADMIN',
        'status': 'ACTIVE',
        'phone_number': '+91 98765 43210',
        'profile_details': {
            'store_name': 'Movi Trend Studio',
            'gst_number': '29ABCDE1234F1Z5',
            'logo_url': 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=400&q=80',
            'bank_details': {
                'account_holder_name': 'Movi Trend Studio LLP',
                'bank_name': 'HDFC Bank',
                'account_number': '50200012345678',
                'ifsc_code': 'HDFC0001234',
            },
        },
    },
    'superadmin.demo@veloura.com': {
        'id': 'USR-DEMO-SUPERADMIN-01',
        'full_name': 'Demo Super Admin',
        'email': 'superadmin.demo@veloura.com',
        'password': 'SuperAdmin#Demo2026',
        'provider': 'email',
        'role': 'SUPER_ADMIN',
        'status': 'ACTIVE',
        'merchant_status': 'APPROVED',
    },
    'customer.demo@veloura.com': {
        'id': 'USR-DEMO-CUSTOMER-01',
        'full_name': 'Demo Customer',
        'email': 'customer.demo@veloura.com',
        'password': 'Customer#Demo2026',
        'provider': 'email',
        'role': 'CUSTOMER',
        'status': 'ACTIVE',
    },
    'delivery.demo@veloura.com': {
        'id': 'USR-DEMO-DELIVERY-01',
        'full_name': 'Demo Delivery Partner',
        'email': 'delivery.demo@veloura.com',
        'password': 'Delivery#Demo2026',
        'provider': 'email',
        'role': 'DELIVERY_ASSOCIATE',
        'status': 'ACTIVE',
        'profile_details': {
            'phone_number': '9998887776',
            'vehicle_type': 'BIKE',
            'vehicle_number': 'KA01DEMO01',
            'driving_license_number': 'DL-DEMO-2026',
            'availability': 'FULL_TIME',
            'service_scope': 'LOCAL',
            'allow_all_india': False,
            'service_pincodes': ['560001', '560002', '560003', '560004', '560005'],
        },
    },
    'ops.demo@veloura.com': {
        'id': 'USR-DEMO-OPS-01',
        'full_name': 'Demo Operations Staff',
        'email': 'ops.demo@veloura.com',
        'password': 'Ops#Demo2026',
        'provider': 'email',
        'role': 'OPERATIONS_STAFF',
        'status': 'ACTIVE',
    },
}

SEED_MERCHANT_SHIPPING_SETTINGS = {
    'USR-DEMO-ADMIN-01': {
        'warehouse': {
            'address': 'No. 42, Residency Road, Bengaluru, Karnataka',
            'pincode': '560001',
            'contact_number': '+91 98765 43210',
        },
        'distance_pricing': {
            'base_charge': 49.0,
            'per_km_rate': 1.75,
            'min_charge': 39.0,
            'max_charge': 499.0,
        },
        'couriers': {
            'available_couriers': ['Local', 'Express', 'Premium'],
        },
        'cod_rules': {
            'cod_enabled': True,
            'cod_limit': 75000.0,
            'cod_extra_charge': 25.0,
        },
        'allow_all_india': True,
        'serviceable_pincodes': [],
        'blocked_pincodes': ['682001'],
    }
}

SEED_SHIPMENTS = [
    {
        'shipment_id': 'SHIP-1001',
        'courier_name': 'Delhivery',
        'tracking_id': 'DLV1001',
        'status': 'CREATED',
        'current_location': 'Mumbai Hub',
        'updated_at': datetime.now(UTC),
    },
    {
        'shipment_id': 'SHIP-1002',
        'courier_name': 'BlueDart',
        'tracking_id': 'BLD1002',
        'status': 'CREATED',
        'current_location': 'Bengaluru Hub',
        'updated_at': datetime.now(UTC),
    },
]

DEMO_DELIVERY_PARTNER_EMAIL = 'delivery.demo@veloura.com'
DEMO_DELIVERY_PARTNER_ID = 'USR-DEMO-DELIVERY-01'

SEED_ORDERS = [
    {
        'order_id': 'ORD-1001',
        'customer_email': 'customer.demo@veloura.com',
        'items': [{'product_id': 1, 'name': 'Architectural Blazer', 'quantity': 1, 'price': 450.0}],
        'total_amount': 450.0,
        'status': 'CONFIRMED',
        'shipment_id': None,
        'assigned_delivery_partner': None,
        'created_at': datetime.now(UTC),
        'updated_at': datetime.now(UTC),
    },
    {
        'order_id': 'ORD-1002',
        'customer_email': 'customer.demo@veloura.com',
        'items': [{'product_id': 2, 'name': 'Atelier Cashmere Crew', 'quantity': 1, 'price': 295.0}],
        'total_amount': 295.0,
        'status': 'PLACED',
        'shipment_id': None,
        'assigned_delivery_partner': None,
        'created_at': datetime.now(UTC),
        'updated_at': datetime.now(UTC),
    },
]

SEED_WAREHOUSES = [
    {
        'warehouse_id': 'WH-BLR-01',
        'product_id': 1,
        'pincode': '560001',
        'city': 'Bengaluru',
        'state': 'Karnataka',
        'express_enabled': True,
        'stock': 120,
    },
    {
        'warehouse_id': 'WH-CHN-01',
        'product_id': 1,
        'pincode': '600001',
        'city': 'Chennai',
        'state': 'Tamil Nadu',
        'express_enabled': False,
        'stock': 90,
    },
    {
        'warehouse_id': 'WH-MUM-01',
        'product_id': 2,
        'pincode': '400001',
        'city': 'Mumbai',
        'state': 'Maharashtra',
        'express_enabled': True,
        'stock': 110,
    },
    {
        'warehouse_id': 'WH-DEL-01',
        'product_id': 2,
        'pincode': '110001',
        'city': 'New Delhi',
        'state': 'Delhi',
        'express_enabled': False,
        'stock': 80,
    },
    {
        'warehouse_id': 'WH-COI-01',
        'product_id': 3,
        'pincode': '641035',
        'city': 'Coimbatore',
        'state': 'Tamil Nadu',
        'express_enabled': True,
        'stock': 95,
    },
    {
        'warehouse_id': 'WH-KOL-01',
        'product_id': 3,
        'pincode': '700001',
        'city': 'Kolkata',
        'state': 'West Bengal',
        'express_enabled': False,
        'stock': 75,
    },
]

mongo_uri = os.getenv('MONGO_URI', '').strip()
mongo_db_name = os.getenv('MONGO_DB_NAME', 'ecommerce').strip() or 'ecommerce'
mongo_enable_fallback = os.getenv('MONGO_ENABLE_FALLBACK', 'true').strip().lower() in {
    '1',
    'true',
    'yes',
    'on',
}
mongo_tls_allow_invalid_certs = os.getenv('MONGO_TLS_ALLOW_INVALID_CERTS', 'false').strip().lower() in {
    '1',
    'true',
    'yes',
    'on',
}

if not mongo_uri:
    raise RuntimeError(
        'Missing MONGO_URI. Set it in backend/.env. Example for local MongoDB: '
        'MONGO_URI=mongodb://127.0.0.1:27017'
    )

mongo_client_options = {'serverSelectionTimeoutMS': 12000}
if mongo_tls_allow_invalid_certs:
    mongo_client_options['tlsAllowInvalidCertificates'] = True

try:
    mongo_client = MongoClient(mongo_uri, **mongo_client_options)
    database = mongo_client[mongo_db_name]
except (ConfigurationError, PyMongoError) as exc:
    if not mongo_enable_fallback:
        raise
    mocked_version = str(os.getenv('MONGOMOCK_SERVER_VERSION', '5.0.5') or '').strip()
    if not re.fullmatch(r'\d+(\.\d+){1,2}', mocked_version):
        os.environ['MONGOMOCK_SERVER_VERSION'] = '5.0.5'
    os.environ['MONGODB'] = '5.0.5'
    mongomock.SERVER_VERSION = '5.0.5'
    print(f'[WARN] MongoDB client setup failed, using in-memory database: {exc}')
    mongo_client = mongomock.MongoClient()
    database = mongo_client[mongo_db_name]

products_collection = database['products']
users_collection = database['users']
orders_collection = database['orders']
order_items_collection = database['order_items']
shipments_collection = database['shipments']
shipment_items_collection = database['shipment_items']
delivery_logs_collection = database['delivery_logs']
order_status_history_collection = database['order_status_history']
shipment_events_collection = database['shipment_events']
warehouses_collection = database['warehouses']
delivery_coverage_collection = database['delivery_coverage']
payments_collection = database['payments']
returns_collection = database['returns']
notifications_collection = database['notifications']
product_reviews_collection = database['product_reviews']
delivery_ratings_collection = database['delivery_ratings']
wishlists_collection = database['wishlists']
merchant_shipping_settings_collection = database['merchant_shipping_settings']
serviceable_pincodes_collection = database['serviceable_pincodes']
blocked_pincodes_collection = database['blocked_pincodes']
pincode_distance_cache_collection = database['pincode_distance_cache']
banners_collection = database['banners']
platform_settings_collection = database['platform_settings']
global_offers_collection = database['global_offers']
uploaded_images_collection = database['uploaded_images']
database_mode = 'mongo'
shipment_simulation_started = False
shipment_simulation_task = None


def _image_content_type_from_filename(file_name: str) -> str:
    extension = os.path.splitext(file_name)[1].lstrip('.').lower()
    reverse_lookup = {value: key for key, value in ALLOWED_IMAGE_CONTENT_TYPES.items()}
    return reverse_lookup.get(extension, 'application/octet-stream')


def _store_uploaded_image(file_name: str, content_type: str, payload: bytes, uploaded_by: str | None) -> None:
    uploaded_images_collection.update_one(
        {'file_name': file_name},
        {
            '$set': {
                'file_name': file_name,
                'content_type': content_type,
                'size_bytes': len(payload),
                'data_base64': base64.b64encode(payload).decode('ascii'),
                'uploaded_by': (uploaded_by or '').strip(),
                'stored_at': now_utc(),
                'storage_kind': 'uploaded-image',
            },
        },
        upsert=True,
    )


def _load_uploaded_image(file_name: str) -> tuple[bytes | None, str | None]:
    record = uploaded_images_collection.find_one({'file_name': file_name}, {'_id': 0})
    if not record:
        return None, None

    encoded = str(record.get('data_base64') or '').strip()
    if not encoded:
        return None, str(record.get('content_type') or 'application/octet-stream')

    try:
        return base64.b64decode(encoded.encode('ascii')), str(record.get('content_type') or 'application/octet-stream')
    except Exception:
        return None, str(record.get('content_type') or 'application/octet-stream')


def sync_local_upload_images_to_database() -> None:
    for file_name in os.listdir(UPLOAD_IMAGE_ROOT):
        safe_name = os.path.basename(file_name)
        file_path = os.path.join(UPLOAD_IMAGE_ROOT, safe_name)
        if not os.path.isfile(file_path):
            continue
        with open(file_path, 'rb') as source_file:
            payload = source_file.read()
        if not payload:
            continue
        _store_uploaded_image(safe_name, _image_content_type_from_filename(safe_name), payload, 'system-sync')


def activate_in_memory_database(reason: str) -> None:
    global mongo_client
    global database
    global products_collection
    global users_collection
    global orders_collection
    global order_items_collection
    global shipments_collection
    global shipment_items_collection
    global delivery_logs_collection
    global order_status_history_collection
    global shipment_events_collection
    global warehouses_collection
    global delivery_coverage_collection
    global payments_collection
    global returns_collection
    global notifications_collection
    global wishlists_collection
    global merchant_shipping_settings_collection
    global serviceable_pincodes_collection
    global blocked_pincodes_collection
    global pincode_distance_cache_collection
    global banners_collection
    global platform_settings_collection
    global global_offers_collection
    global uploaded_images_collection
    global database_mode

    mocked_version = str(os.getenv('MONGOMOCK_SERVER_VERSION', '5.0.5') or '').strip()
    if not re.fullmatch(r'\d+(\.\d+){1,2}', mocked_version):
        os.environ['MONGOMOCK_SERVER_VERSION'] = '5.0.5'
    os.environ['MONGODB'] = '5.0.5'
    mongomock.SERVER_VERSION = '5.0.5'

    mongo_client = mongomock.MongoClient()
    database = mongo_client[mongo_db_name]
    products_collection = database['products']
    users_collection = database['users']
    orders_collection = database['orders']
    order_items_collection = database['order_items']
    shipments_collection = database['shipments']
    shipment_items_collection = database['shipment_items']
    delivery_logs_collection = database['delivery_logs']
    order_status_history_collection = database['order_status_history']
    shipment_events_collection = database['shipment_events']
    warehouses_collection = database['warehouses']
    delivery_coverage_collection = database['delivery_coverage']
    payments_collection = database['payments']
    returns_collection = database['returns']
    notifications_collection = database['notifications']
    wishlists_collection = database['wishlists']
    merchant_shipping_settings_collection = database['merchant_shipping_settings']
    serviceable_pincodes_collection = database['serviceable_pincodes']
    blocked_pincodes_collection = database['blocked_pincodes']
    pincode_distance_cache_collection = database['pincode_distance_cache']
    banners_collection = database['banners']
    platform_settings_collection = database['platform_settings']
    global_offers_collection = database['global_offers']
    uploaded_images_collection = database['uploaded_images']
    database_mode = 'in-memory-fallback'
    print(f'[WARN] Falling back to in-memory database: {reason}')


def now_utc() -> datetime:
    return datetime.now(UTC)


def normalize_role(value: str) -> str:
    role = (value or 'CUSTOMER').strip().upper()
    role_aliases = {
        'MERCHANT': 'ADMIN',
        'USER': 'CUSTOMER',
        'DELIVERY': 'DELIVERY_ASSOCIATE',
        'STAFF': 'OPERATIONS_STAFF',
        'OPERATIONS': 'OPERATIONS_STAFF',
        'SUPERADMIN': 'SUPER_ADMIN',
        'SUPER-ADMIN': 'SUPER_ADMIN',
    }
    canonical = role_aliases.get(role, role)
    if canonical in {'CUSTOMER', 'ADMIN', 'DELIVERY_ASSOCIATE', 'OPERATIONS_STAFF', 'SUPER_ADMIN'}:
        return canonical
    return 'CUSTOMER'


def normalize_account_status(value: str, fallback: str = 'ACTIVE') -> str:
    status_value = (value or fallback).strip().upper()
    if status_value in {'ACTIVE', 'PENDING', 'BLOCKED'}:
        return status_value
    return fallback


def normalize_merchant_status(value: str, fallback: str = 'PENDING') -> str:
    status_value = str(value or fallback).strip().upper()
    if status_value in MERCHANT_REVIEW_STATUSES:
        return status_value
    return fallback


def normalize_banner_status(value: str, fallback: str = 'PENDING') -> str:
    status_value = str(value or fallback).strip().upper()
    if status_value in BANNER_REVIEW_STATUSES:
        return status_value
    return fallback


def normalize_product_review_status(value: str, fallback: str = 'APPROVED') -> str:
    status_value = str(value or fallback).strip().upper()
    if status_value in PRODUCT_REVIEW_STATUSES:
        return status_value
    return fallback


def hash_password(password: str) -> str:
    return PASSWORD_CONTEXT.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return PASSWORD_CONTEXT.verify(plain, hashed)


def create_auth_token(subject_email: str, role: str, token_type: str, expires_hours: int) -> str:
    expires_at = now_utc() + timedelta(hours=expires_hours)
    payload = {
        'sub': subject_email,
        'role': normalize_role(role),
        'token_type': token_type,
        'exp': expires_at,
        'iat': now_utc(),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_access_token(subject_email: str, role: str) -> str:
    return create_auth_token(subject_email, role, token_type='access', expires_hours=ACCESS_TOKEN_EXPIRE_HOURS)


def create_refresh_token(subject_email: str, role: str) -> str:
    return create_auth_token(subject_email, role, token_type='refresh', expires_hours=REFRESH_TOKEN_EXPIRE_HOURS)


_LOCALHOST_IMAGE_RE = re.compile(r'^https?://(?:127\.0\.0\.1|localhost)(?::\d+)?(/uploads/images/.+)$', re.IGNORECASE)


def _normalize_image_url(raw: str | None) -> str:
    url = str(raw or '').strip()
    if not url:
        return url
    match = _LOCALHOST_IMAGE_RE.match(url)
    if match:
        return match.group(1)
    return url


def serialize_product(document: dict) -> dict:
    payload = enrich_product_specifications(document)
    payload.pop('_id', None)
    if 'image' in payload:
        payload['image'] = _normalize_image_url(payload.get('image'))
    if 'additional_images' in payload and isinstance(payload['additional_images'], list):
        payload['additional_images'] = [_normalize_image_url(u) for u in payload['additional_images']]
    return payload


def normalize_product_size_list(value: list[str] | str | None) -> list[str]:
    if not value:
        return []

    raw_values = value if isinstance(value, list) else re.split(r'[\s,|/]+', str(value))
    normalized_sizes: list[str] = []
    for raw_value in raw_values:
        size = str(raw_value).strip()
        if size and size not in normalized_sizes:
            normalized_sizes.append(size)
    return normalized_sizes


def infer_product_kind(product: dict) -> str:
    searchable_text = normalize_product_text(
        ' '.join(
            str(product.get(field) or '')
            for field in [
                'name',
                'description',
                'category',
                'section',
                'productType',
                'subType',
                'fabric',
                'fit_type',
                'pattern',
                'sleeve_type',
                'neck_type',
                'occasion',
                'closure_type',
                'color',
            ]
        ),
    )

    if any(keyword in searchable_text for keyword in ['shoe', 'shoes', 'sneaker', 'sneakers', 'sandal', 'sandals', 'loafer', 'boot', 'boots', 'footwear']):
        return 'shoes'
    if any(keyword in searchable_text for keyword in ['laptop', 'mobile', 'phone', 'smartphone', 'tablet', 'camera', 'television', 'tv', 'headphone', 'speaker', 'watch', 'electronics', 'electronic']):
        return 'electronics'
    return 'fashion'


def infer_product_fabric(product: dict) -> str:
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    fabric_rules = [
        (['cashmere', 'wool'], 'Wool Blend'),
        (['linen'], 'Linen'),
        (['denim'], 'Denim'),
        (['satin'], 'Satin'),
        (['silk'], 'Silk Blend'),
        (['rayon'], 'Rayon'),
        (['fleece'], 'Fleece'),
        (['polyester'], 'Polyester'),
        (['cotton'], 'Cotton'),
    ]
    for keywords, fabric in fabric_rules:
        if any(keyword in searchable_text for keyword in keywords):
            return fabric
    return 'Cotton Blend' if infer_product_kind(product) == 'fashion' else 'Standard Material'


def infer_product_fit_type(product: dict) -> str:
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    if any(keyword in searchable_text for keyword in ['bodycon', 'slim', 'tailored']):
        return 'Slim Fit'
    if any(keyword in searchable_text for keyword in ['oversized', 'relaxed', 'loose']):
        return 'Oversized'
    if any(keyword in searchable_text for keyword in ['regular', 'straight', 'classic', 'crew']):
        return 'Regular Fit'
    return 'Regular Fit'


def infer_product_pattern(product: dict) -> str:
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    if any(keyword in searchable_text for keyword in ['floral', 'printed', 'print']):
        return 'Printed'
    if any(keyword in searchable_text for keyword in ['checked', 'check', 'plaid']):
        return 'Checked'
    if any(keyword in searchable_text for keyword in ['striped', 'stripe']):
        return 'Striped'
    return 'Solid'


def infer_product_sleeve_type(product: dict) -> str:
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    if any(keyword in searchable_text for keyword in ['sleeveless', 'tank', 'camisole']):
        return 'Sleeveless'
    if any(keyword in searchable_text for keyword in ['tee', 't-shirt', 'polo', 'half sleeve', 'shirt', 'kurta']):
        return 'Half Sleeve'
    return 'Full Sleeve'


def infer_product_neck_type(product: dict) -> str:
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    if any(keyword in searchable_text for keyword in ['v neck', 'v-neck']):
        return 'V Neck'
    if any(keyword in searchable_text for keyword in ['polo', 'collar', 'shirt', 'placket']):
        return 'Collar Neck'
    if any(keyword in searchable_text for keyword in ['crew', 'round', 'sweater', 'tee']):
        return 'Round Neck'
    return 'Round Neck'


def infer_product_occasion(product: dict) -> str:
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    if any(keyword in searchable_text for keyword in ['formal', 'office', 'blazer', 'chino', 'oxford']):
        return 'Formal'
    if any(keyword in searchable_text for keyword in ['party', 'festive', 'evening']):
        return 'Party Wear'
    if any(keyword in searchable_text for keyword in ['sports', 'gym', 'training', 'active']):
        return 'Sports'
    return 'Casual'


def infer_product_closure_type(product: dict) -> str:
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    if any(keyword in searchable_text for keyword in ['zip', 'zipper']):
        return 'Zip'
    if any(keyword in searchable_text for keyword in ['button', 'shirt', 'blazer', 'kurta', 'dress']):
        return 'Button'
    return 'Pull Over'


def infer_product_wash_care(product: dict) -> str:
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    if any(keyword in searchable_text for keyword in ['satin', 'silk', 'cashmere', 'wool']):
        return 'Hand Wash'
    return 'Machine Wash'


def infer_product_color(product: dict) -> str:
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    color_rules = [
        (['blazer'], 'Black'),
        (['cashmere'], 'Ivory'),
        (['denim'], 'Indigo Blue'),
        (['satin'], 'Wine'),
        (['floral'], 'Multicolor'),
        (['anarkali'], 'Pastel Pink'),
        (['bodycon'], 'Burgundy'),
        (['polo'], 'Navy Blue'),
        (['chino'], 'Beige'),
        (['bomber'], 'Olive'),
        (['linen'], 'Sand'),
        (['party dress'], 'Pink'),
        (['dungaree'], 'Blue'),
        (['sweatshirt'], 'Grey'),
        (['skirt'], 'Black'),
        (['shirt dress'], 'Beige'),
        (['oxford shirt'], 'White'),
        (['night suit'], 'Light Blue'),
    ]
    for keywords, color in color_rules:
        if any(keyword in searchable_text for keyword in keywords):
            return color
    return 'Neutral'


def infer_product_weight(product: dict) -> str:
    kind = infer_product_kind(product)
    searchable_text = normalize_product_text(' '.join(str(product.get(field) or '') for field in ['name', 'description', 'category', 'productType', 'subType']))
    if kind == 'electronics':
        return '1.4 kg'
    if kind == 'shoes':
        return '0.9 kg'
    if any(keyword in searchable_text for keyword in ['blazer', 'jacket', 'coat', 'outerwear']):
        return '0.65 kg'
    if any(keyword in searchable_text for keyword in ['dress', 'skirt', 'night suit']):
        return '0.42 kg'
    if any(keyword in searchable_text for keyword in ['shirt', 'tee', 'kurta', 'polo', 'sweater']):
        return '0.32 kg'
    return '0.45 kg'


def infer_product_available_sizes(product: dict) -> list[str]:
    existing_sizes = normalize_product_size_list(product.get('available_sizes'))
    if existing_sizes:
        return existing_sizes

    kind = infer_product_kind(product)
    section = normalize_product_text(product.get('section'))
    if kind == 'shoes':
        return ['6', '7', '8', '9', '10']
    if section == 'kids':
        return ['2Y', '4Y', '6Y', '8Y', '10Y']
    return ['S', 'M', 'L', 'XL']


def infer_product_stock_status(product: dict) -> str:
    existing_status = str(product.get('stock_status') or '').strip()
    if existing_status:
        return existing_status

    stock_quantity = int(product.get('stock_quantity') if product.get('stock_quantity') is not None else product.get('stock') or 0)
    reserved = int(product.get('reserved_stock') or 0)
    low_threshold = int(product.get('low_stock_threshold') or 5)
    available = stock_quantity - reserved
    if available <= 0:
        return 'Out of Stock'
    if available < low_threshold:
        return 'Limited Stock'
    return 'In Stock'


def build_product_spec_defaults(product: dict) -> dict:
    brand = str(product.get('brand') or '').strip()
    sku = str(product.get('sku') or '').strip()
    country_of_origin = str(product.get('country_of_origin') or '').strip()
    weight = str(product.get('weight') or '').strip()
    if not brand:
        brand = 'Movi Tech' if infer_product_kind(product) == 'electronics' else 'Movi Fashion'
    if not sku:
        product_id = int(product.get('id') or 0)
        sku = f'MF-{product_id:04d}' if product_id else 'MF-0000'
    if not country_of_origin:
        country_of_origin = 'India'
    if not weight:
        weight = infer_product_weight(product)

    return {
        'fabric': str(product.get('fabric') or '').strip() or infer_product_fabric(product),
        'fit_type': str(product.get('fit_type') or '').strip() or infer_product_fit_type(product),
        'pattern': str(product.get('pattern') or '').strip() or infer_product_pattern(product),
        'sleeve_type': str(product.get('sleeve_type') or '').strip() or infer_product_sleeve_type(product),
        'neck_type': str(product.get('neck_type') or '').strip() or infer_product_neck_type(product),
        'occasion': str(product.get('occasion') or '').strip() or infer_product_occasion(product),
        'closure_type': str(product.get('closure_type') or '').strip() or infer_product_closure_type(product),
        'wash_care': str(product.get('wash_care') or '').strip() or infer_product_wash_care(product),
        'country_of_origin': country_of_origin,
        'brand': brand,
        'sku': sku,
        'weight': weight,
        'available_sizes': infer_product_available_sizes(product),
        'color': str(product.get('color') or '').strip() or infer_product_color(product),
        'stock_status': infer_product_stock_status(product),
        'stock_quantity': int(product.get('stock_quantity') if product.get('stock_quantity') is not None else product.get('stock') or 0),
        'reserved_stock': int(product.get('reserved_stock') or 0),
        'low_stock_threshold': int(product.get('low_stock_threshold') or 5),
        'is_active': bool(product.get('is_active') if product.get('is_active') is not None else True),
    }


def enrich_product_specifications(document: dict) -> dict:
    payload = dict(document)
    payload.pop('_id', None)

    if 'available_sizes' in payload:
        payload['available_sizes'] = normalize_product_size_list(payload.get('available_sizes')) or payload.get('available_sizes') or []

    defaults = build_product_spec_defaults(payload)
    for key, value in defaults.items():
        if payload.get(key) in (None, '', []):
            payload[key] = value

    pid = payload.get('id')
    # Calculate stock dynamically from warehouses_collection
    total_stock = 0
    if pid is not None:
        try:
            total_stock = sum(int(w.get('stock', 0) or 0) for w in warehouses_collection.find({'product_id': int(pid)}))
        except Exception:
            pass
    if total_stock == 0:
        total_stock = int(payload.get('stock') if payload.get('stock') is not None else payload.get('stock_quantity') or 0)

    payload['stock'] = total_stock
    payload['stock_quantity'] = total_stock
    payload['reserved_stock'] = int(payload.get('reserved_stock') or 0)
    payload['available_stock'] = max(0, total_stock - payload['reserved_stock'])
    payload['low_stock_threshold'] = int(payload.get('low_stock_threshold') or defaults.get('low_stock_threshold') or 5)
    payload['stock_status'] = infer_product_stock_status(payload)

    return payload


def get_approved_product_catalog() -> list[dict]:
    products = list(
        products_collection.find(
            {'review_status': 'APPROVED'},
            {'_id': 0},
        )
    )
    return products


def normalize_product_text(value: str | None) -> str:
    return re.sub(r'\s+', ' ', str(value or '').strip().lower())


def tokenize_product(product: dict) -> set[str]:
    fields = [
        product.get('name'),
        product.get('description'),
        product.get('category'),
        product.get('section'),
        product.get('productType'),
        product.get('subType'),
        product.get('fabric'),
        product.get('fit_type'),
        product.get('pattern'),
        product.get('sleeve_type'),
        product.get('neck_type'),
        product.get('occasion'),
        product.get('closure_type'),
        product.get('wash_care'),
        product.get('country_of_origin'),
        product.get('brand'),
        product.get('sku'),
        product.get('color'),
        product.get('stock_status'),
        ' '.join(normalize_product_size_list(product.get('available_sizes'))),
    ]
    tokens: set[str] = set()
    for field in fields:
        for token in re.findall(r'[a-z0-9]+', normalize_product_text(field)):
            if len(token) > 2:
                tokens.add(token)
    return tokens


def build_related_product_rating(score: float, product_id: int) -> float:
    seeded_variation = (product_id % 7) * 0.05
    rating = 4.1 + min(0.7, score / 120.0) + seeded_variation
    return round(min(4.9, rating), 1)


def score_related_product(source: dict, candidate: dict) -> float:
    score = 0.0
    source_section = normalize_product_text(source.get('section'))
    candidate_section = normalize_product_text(candidate.get('section'))
    source_category = normalize_product_text(source.get('category'))
    candidate_category = normalize_product_text(candidate.get('category'))
    source_product_type = normalize_product_text(source.get('productType'))
    candidate_product_type = normalize_product_text(candidate.get('productType'))
    source_sub_type = normalize_product_text(source.get('subType'))
    candidate_sub_type = normalize_product_text(candidate.get('subType'))

    if source_section and source_section == candidate_section:
        score += 35
    if source_category and source_category == candidate_category:
        score += 28
    if source_product_type and source_product_type == candidate_product_type:
        score += 22
    if source_sub_type and source_sub_type == candidate_sub_type:
        score += 12

    try:
        source_price = float(source.get('price') or 0)
        candidate_price = float(candidate.get('price') or 0)
        if source_price > 0 and candidate_price > 0:
            price_gap = abs(source_price - candidate_price) / max(source_price, candidate_price)
            if price_gap <= 0.12:
                score += 20
            elif price_gap <= 0.25:
                score += 12
            elif price_gap <= 0.45:
                score += 6
    except (TypeError, ValueError):
        pass

    overlap = tokenize_product(source) & tokenize_product(candidate)
    score += min(len(overlap) * 2.5, 12)

    return score


def get_related_products_for_product(product_id: int) -> list[dict]:
    catalog = get_approved_product_catalog()
    source_product = next((product for product in catalog if int(product.get('id') or 0) == int(product_id)), None)
    if not source_product:
        raise HTTPException(status_code=404, detail='Product not found')

    candidates = [product for product in catalog if int(product.get('id') or 0) != int(product_id)]
    if not candidates:
        return []

    scored_candidates = []
    for candidate in candidates:
        score = score_related_product(source_product, candidate)
        scored_candidates.append((score, candidate))

    scored_candidates.sort(key=lambda item: (item[0], -int(item[1].get('id') or 0)), reverse=True)

    related_candidates = [candidate for score, candidate in scored_candidates if score > 0]
    if not related_candidates:
        rng = random.Random(int(product_id))
        fallback_candidates = candidates[:]
        rng.shuffle(fallback_candidates)
        related_candidates = fallback_candidates

    related_products = []
    for candidate in related_candidates[:8]:
        candidate_id = int(candidate.get('id') or 0)
        base_score = next((score for score, item in scored_candidates if int(item.get('id') or 0) == candidate_id), 0.0)
        related_products.append(build_discovery_card(candidate, score=base_score, rank=len(related_products)))

    return related_products


def normalize_product_stock(value: int | float | str | None, fallback: int = 0) -> int:
    try:
        stock_value = int(float(value))
    except (TypeError, ValueError):
        stock_value = fallback
    return max(stock_value, 0)


def parse_id_list(value: str | list[str] | None) -> list[int]:
    if not value:
        return []

    raw_values = value if isinstance(value, list) else re.split(r'[\s,]+', str(value))
    parsed_ids: list[int] = []
    for raw_value in raw_values:
        try:
            candidate_id = int(str(raw_value).strip())
        except (TypeError, ValueError):
            continue
        if candidate_id > 0 and candidate_id not in parsed_ids:
            parsed_ids.append(candidate_id)
    return parsed_ids


def get_catalog_product_by_id(product_id: int) -> dict | None:
    catalog = get_approved_product_catalog()
    return next((product for product in catalog if int(product.get('id') or 0) == int(product_id)), None)


def score_similarity_product(source: dict, candidate: dict) -> float:
    score = score_related_product(source, candidate)

    source_name_tokens = tokenize_product(source)
    candidate_name_tokens = tokenize_product(candidate)
    shared_tokens = source_name_tokens & candidate_name_tokens
    score += min(len(shared_tokens) * 1.8, 10)

    try:
        source_price = float(source.get('price') or 0)
        candidate_price = float(candidate.get('price') or 0)
        if source_price > 0 and candidate_price > 0:
            midpoint = (source_price + candidate_price) / 2
            price_gap = abs(source_price - candidate_price) / midpoint if midpoint else 0
            if price_gap <= 0.18:
                score += 10
            elif price_gap <= 0.35:
                score += 5
    except (TypeError, ValueError):
        pass

    if normalize_product_text(source.get('section')) == normalize_product_text(candidate.get('section')):
        score += 8
    if normalize_product_text(source.get('category')) == normalize_product_text(candidate.get('category')):
        score += 12

    return score


def get_trending_products(exclude_ids: set[int] | None = None, limit: int = 8) -> list[dict]:
    blocked_ids = exclude_ids or set()
    catalog = get_approved_product_catalog()
    ranked = sorted(
        [product for product in catalog if int(product.get('id') or 0) not in blocked_ids],
        key=lambda product: (
            float(product.get('price') or 0),
            int(product.get('id') or 0),
        ),
        reverse=True,
    )
    return ranked[:limit]


def build_discovery_card(candidate: dict, score: float = 0.0, rank: int = 0) -> dict:
    candidate = enrich_product_specifications(candidate)
    candidate_id = int(candidate.get('id') or 0)
    candidate_price = float(candidate.get('price') or 0)
    price_multiplier = 12 if candidate_price < 500 else 9 if candidate_price < 1500 else 7 if candidate_price < 3000 else 5
    score_bonus = int(max(0, min(18, score / 8)))
    discount_percent = min(45, max(5, price_multiplier + score_bonus + (candidate_id % 5)))

    return {
        'id': candidate_id,
        'title': candidate.get('name') or candidate.get('title') or f'Product {candidate_id}',
        'image': candidate.get('image') or '',
        'price': candidate_price,
        'rating': build_related_product_rating(score, candidate_id),
        'category': candidate.get('category') or '',
        'fabric': candidate.get('fabric') or '',
        'fit_type': candidate.get('fit_type') or '',
        'brand': candidate.get('brand') or '',
        'color': candidate.get('color') or '',
        'sku': candidate.get('sku') or '',
        'stock_status': candidate.get('stock_status') or '',
        'discount_percent': discount_percent,
        'delivery_badge': 'Free Delivery' if rank % 2 == 0 or candidate_price >= 1800 else 'Fast Shipping',
    }


def rank_candidate_for_recommendation(source_products: list[dict], candidate: dict) -> float:
    if not source_products:
        return 0.0

    score = 0.0
    candidate_tokens = tokenize_product(candidate)

    for index, source_product in enumerate(source_products):
        weight = 1.0 if index == 0 else 0.8 if index < 3 else 0.65
        similarity = score_similarity_product(source_product, candidate)
        score += similarity * weight

        source_section = normalize_product_text(source_product.get('section'))
        candidate_section = normalize_product_text(candidate.get('section'))
        source_category = normalize_product_text(source_product.get('category'))
        candidate_category = normalize_product_text(candidate.get('category'))

        if source_section and source_section == candidate_section:
            score += 10 * weight
        if source_category and source_category == candidate_category:
            score += 18 * weight

        try:
            source_price = float(source_product.get('price') or 0)
            candidate_price = float(candidate.get('price') or 0)
            if source_price > 0 and candidate_price > 0:
                price_gap = abs(source_price - candidate_price) / max(source_price, candidate_price)
                if price_gap <= 0.15:
                    score += 8 * weight
                elif price_gap <= 0.3:
                    score += 4 * weight
        except (TypeError, ValueError):
            pass

        score += min(len(tokenize_product(source_product) & candidate_tokens) * 1.6, 8) * weight

    if source_products:
        top_source = source_products[0]
        source_price = float(top_source.get('price') or 0)
        candidate_price = float(candidate.get('price') or 0)
        if source_price > 0 and candidate_price > 0:
            mid_price = (source_price + candidate_price) / 2
            if mid_price and abs(source_price - candidate_price) / mid_price <= 0.2:
                score += 6

    return score


def get_recommended_products_for_product(
    product_id: int,
    cart_ids: list[int] | None = None,
    wishlist_ids: list[int] | None = None,
    viewed_ids: list[int] | None = None,
) -> list[dict]:
    catalog = get_approved_product_catalog()
    source_product = get_catalog_product_by_id(product_id)
    if not source_product:
        raise HTTPException(status_code=404, detail='Product not found')

    blocked_ids = {int(product_id)}
    seed_ids = [int(value) for value in (cart_ids or []) + (wishlist_ids or []) + (viewed_ids or []) if int(value) > 0]
    seed_ids = [value for value in seed_ids if value != int(product_id)]
    seed_products = [get_catalog_product_by_id(seed_id) for seed_id in seed_ids]
    seed_products = [product for product in seed_products if product]

    source_bundle = [source_product] + seed_products
    ranked_candidates = []
    for candidate in catalog:
        candidate_id = int(candidate.get('id') or 0)
        if candidate_id in blocked_ids:
            continue
        score = rank_candidate_for_recommendation(source_bundle, candidate)
        if score > 0:
            ranked_candidates.append((score, candidate))

    ranked_candidates.sort(key=lambda item: (item[0], -int(item[1].get('id') or 0)), reverse=True)
    if not ranked_candidates:
        ranked_candidates = [(0.0, candidate) for candidate in get_trending_products(blocked_ids, limit=8)]

    return [build_discovery_card(candidate, score=score, rank=index) for index, (score, candidate) in enumerate(ranked_candidates[:8])]


def get_frequently_bought_bundle_for_product(product_id: int) -> dict:
    source_product = get_catalog_product_by_id(product_id)
    if not source_product:
        raise HTTPException(status_code=404, detail='Product not found')

    catalog = get_approved_product_catalog()
    blocked_ids = {int(product_id)}
    preferred_categories = {
        'outerwear': ['Topwear', 'Shirts', 'Bottomwear', 'Bottoms'],
        'topwear': ['Bottomwear', 'Bottoms', 'Trousers', 'Jeans'],
        'western wear': ['Topwear', 'Bottomwear', 'Ethnic Wear'],
        'ethnic wear': ['Western Wear', 'Topwear', 'Bottomwear'],
        'bottomwear': ['Topwear', 'Shirts', 'Western Wear'],
        'bottoms': ['Topwear', 'Shirts', 'Bottomwear'],
        'knitwear': ['Bottomwear', 'Outerwear', 'Topwear'],
    }

    preferred_order = preferred_categories.get(normalize_product_text(source_product.get('category')), [])

    scored_candidates: list[tuple[float, dict]] = []
    for candidate in catalog:
        candidate_id = int(candidate.get('id') or 0)
        if candidate_id in blocked_ids:
            continue

        score = score_similarity_product(source_product, candidate)
        candidate_category = str(candidate.get('category') or '')
        candidate_section = str(candidate.get('section') or '').lower()

        if preferred_order and candidate_category in preferred_order:
            score += 24
        if normalize_product_text(source_product.get('section')) == candidate_section:
            score += 8

        try:
            source_price = float(source_product.get('price') or 0)
            candidate_price = float(candidate.get('price') or 0)
            if source_price > 0 and candidate_price > 0:
                gap = abs(source_price - candidate_price) / max(source_price, candidate_price)
                if gap <= 0.22:
                    score += 12
                elif gap <= 0.35:
                    score += 7
        except (TypeError, ValueError):
            pass

        scored_candidates.append((score, candidate))

    scored_candidates.sort(key=lambda item: (item[0], -int(item[1].get('id') or 0)), reverse=True)
    bundle_candidates = [candidate for score, candidate in scored_candidates if score > 0][:3]

    if not bundle_candidates:
        bundle_candidates = get_trending_products(blocked_ids, limit=3)

    bundle_cards = [build_discovery_card(candidate, score=score, rank=index) for index, (score, candidate) in enumerate(scored_candidates[:3])] if scored_candidates else [build_discovery_card(candidate, score=0, rank=index) for index, candidate in enumerate(bundle_candidates)]
    combined_price = float(source_product.get('price') or 0) + sum(float(candidate.get('price') or 0) for candidate in bundle_candidates)

    return {
        'product': build_discovery_card(source_product, score=100, rank=0),
        'bundle': bundle_cards,
        'bundle_total_price': round(combined_price, 2),
        'bundle_savings': round(max(0.0, combined_price * 0.08), 2),
    }


def get_recently_viewed_products(product_ids: list[int]) -> list[dict]:
    if not product_ids:
        return []

    catalog = get_approved_product_catalog()
    product_map = {int(product.get('id') or 0): product for product in catalog}
    ordered_products = []
    for product_id in product_ids:
        product = product_map.get(int(product_id))
        if product and int(product.get('id') or 0) not in [int(item.get('id') or 0) for item in ordered_products]:
            ordered_products.append(product)

    return [build_discovery_card(product, score=0, rank=index) for index, product in enumerate(ordered_products[:8])]


def get_next_product_id() -> int:
    latest_product = products_collection.find_one({}, {'id': 1}, sort=[('id', -1)])
    if not latest_product:
        return 1
    return int(latest_product.get('id') or 0) + 1


def build_merchant_product_payload(payload: MerchantProductRequest, existing: dict | None = None) -> dict:
    base = dict(existing or {})
    price_value = float(payload.price)
    stock_value = normalize_product_stock(payload.stock)

    base.update(
        {
            'name': str(payload.name).strip(),
            'section': str(payload.section or '').strip().lower() or 'women',
            'category': str(payload.category).strip(),
            'productType': str(payload.productType or '').strip(),
            'subType': str(payload.subType or '').strip(),
            'price': price_value,
            'image': str(payload.image).strip(),
            'description': str(payload.description).strip(),
            'stock': stock_value,
        },
    )

    optional_fields = [
        'fabric',
        'fit_type',
        'pattern',
        'sleeve_type',
        'neck_type',
        'occasion',
        'closure_type',
        'wash_care',
        'country_of_origin',
        'brand',
        'sku',
        'weight',
        'color',
        'stock_status',
    ]
    for field in optional_fields:
        value = getattr(payload, field)
        if value is not None and str(value).strip():
            base[field] = str(value).strip()

    if payload.available_sizes is not None:
        normalized_sizes = normalize_product_size_list(payload.available_sizes)
        if normalized_sizes:
            base['available_sizes'] = normalized_sizes

    return enrich_product_specifications(base)


def serialize_user(document: dict) -> dict:
    payload = dict(document)
    payload.pop('_id', None)
    payload.pop('password', None)
    payload.pop('password_hash', None)
    payload['id'] = payload.get('id') or payload.get('user_id') or ''
    payload['name'] = payload.get('name') or payload.get('full_name') or ''
    payload['role'] = normalize_role(payload.get('role', 'CUSTOMER'))
    payload['status'] = normalize_account_status(payload.get('status', 'ACTIVE'))
    payload['merchant_status'] = normalize_merchant_status(payload.get('merchant_status', 'PENDING'))
    if 'address' in document:
        payload['address'] = document['address']
    return payload


def serialize_shipment(document: dict | None) -> dict | None:
    if not document:
        return None
    payload = dict(document)
    payload.pop('_id', None)
    if isinstance(payload.get('updated_at'), datetime):
        payload['updated_at'] = payload['updated_at'].isoformat()
    if isinstance(payload.get('created_at'), datetime):
        payload['created_at'] = payload['created_at'].isoformat()
    return payload


def normalize_shipment_status(value: str, fallback: str = 'CREATED') -> str:
    candidate = str(value or fallback).strip().upper()
    if candidate in SHIPMENT_STATUS_FLOW:
        return candidate
    return fallback


def get_shipment_events(shipment_id: str) -> list[dict]:
    events = list(shipment_events_collection.find({'shipment_id': shipment_id}).sort('timestamp', 1))
    serialized_events = []
    for entry in events:
        payload = dict(entry)
        payload.pop('_id', None)
        if isinstance(payload.get('timestamp'), datetime):
            payload['timestamp'] = payload['timestamp'].isoformat()
        serialized_events.append(payload)
    return serialized_events


def serialize_delivery_log(document: dict) -> dict:
    payload = dict(document)
    payload.pop('_id', None)
    if isinstance(payload.get('timestamp'), datetime):
        payload['timestamp'] = payload['timestamp'].isoformat()
    return payload


def normalize_order_status(value: str, fallback: str = 'PLACED') -> str:
    candidate = (value or fallback).strip().upper()
    if candidate == 'FAILED':
        candidate = 'DELIVERY_FAILED'
    if candidate in ORDER_STATUS_FLOW or candidate in SPECIAL_ORDER_STATUSES:
        return candidate
    return fallback


def active_orders_filter(query: dict | None = None) -> dict:
    active_filter = {
        '$or': [
            {'is_deleted': {'$exists': False}},
            {'is_deleted': False},
        ]
    }
    if not query:
        return active_filter
    return {'$and': [query, active_filter]}


def normalize_shipment_entity_status(value: str, fallback: str = 'CREATED') -> str:
    candidate = (value or fallback).strip().upper()
    if candidate in SHIPMENT_ENTITY_STATUSES:
        return candidate
    return fallback


def normalize_shipment_vehicle_type(value: str, fallback: str = 'VAN') -> str:
    candidate = (value or fallback).strip().upper()
    if candidate in {'TRUCK', 'VAN', 'BIKE'}:
        return candidate
    return fallback


def get_shipment_order_ids(shipment_id: str) -> list[str]:
    shipment_items = list(shipment_items_collection.find({'shipment_id': shipment_id}, {'_id': 0, 'order_id': 1}))
    order_ids = []
    for item in shipment_items:
        order_id = str(item.get('order_id') or '').strip()
        if order_id:
            order_ids.append(order_id)
            
    if not order_ids:
        orders = list(orders_collection.find({'shipment_id': shipment_id}, {'_id': 0, 'order_id': 1}))
        for o in orders:
            order_id = str(o.get('order_id') or '').strip()
            if order_id:
                order_ids.append(order_id)
                
    return order_ids


def can_progress_order(current_status: str, next_status: str) -> bool:
    current = normalize_order_status(current_status)
    nxt = normalize_order_status(next_status)
    if current == nxt:
        return True
    if current in {'REJECTED', 'CANCELLED', 'DELIVERY_FAILED', 'DELIVERED'}:
        return False
    allowed_next = ORDER_STATUS_TRANSITIONS.get(current, set())
    return nxt in allowed_next


def append_delivery_log(order_id: str, status_value: str, updated_by: str, location: str = "", performer_role: str = "SYSTEM", performer_email: str = "system@local") -> None:
    delivery_logs_collection.insert_one(
        {
            'id': f"DLOG-{uuid4().hex[:12].upper()}",
            'order_id': order_id,
            'status': normalize_order_status(status_value),
            'updated_by': updated_by,
            'performer_role': performer_role,
            'performer_email': performer_email,
            'location': location.strip() if location else "",
            'timestamp': now_utc(),
        }
    )


def validate_order_workflow_transition(current_status: str, target_status: str) -> None:
    current = normalize_order_status(current_status)
    target = normalize_order_status(target_status)
    if current == target:
        return

    if current in {'REJECTED', 'CANCELLED', 'DELIVERY_FAILED', 'DELIVERED'}:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition order from terminal status: {current}."
        )

    allowed_next = ORDER_STATUS_TRANSITIONS.get(current, set())
    if target not in allowed_next:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid transition from {current} to {target}. Expected next status in: {', '.join(allowed_next)}."
        )


def update_status_timestamp(order_created_at, status_timestamps: dict | None, target_status: str, target_time) -> dict:
    flow = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']
    normalized_target = normalize_order_status(target_status)
    if normalized_target not in flow:
        return status_timestamps or {}

    new_ts = dict(status_timestamps or {})
    parsed_ts = {}
    for k, v in new_ts.items():
        if v:
            try:
                dt = datetime.fromisoformat(str(v))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=UTC)
                parsed_ts[k] = dt
            except Exception:
                pass

    placed_dt = parsed_ts.get('PLACED') or order_created_at
    if isinstance(placed_dt, str):
        try:
            placed_dt = datetime.fromisoformat(placed_dt)
        except Exception:
            placed_dt = now_utc()
    if placed_dt.tzinfo is None:
        placed_dt = placed_dt.replace(tzinfo=UTC)
    parsed_ts['PLACED'] = placed_dt

    target_dt = target_time
    if isinstance(target_dt, str):
        try:
            target_dt = datetime.fromisoformat(target_dt)
        except Exception:
            target_dt = now_utc()
    if target_dt.tzinfo is None:
        target_dt = target_dt.replace(tzinfo=UTC)
    parsed_ts[normalized_target] = target_dt

    target_idx = flow.index(normalized_target)

    for i in range(1, target_idx + 1):
        prev_status = flow[i-1]
        curr_status = flow[i]
        if curr_status not in parsed_ts or not parsed_ts[curr_status]:
            parsed_ts[curr_status] = parsed_ts[prev_status]

    for i in range(target_idx - 1, -1, -1):
        curr_status = flow[i]
        next_status = flow[i+1]
        if curr_status in parsed_ts and next_status in parsed_ts:
            if parsed_ts[curr_status] > parsed_ts[next_status]:
                parsed_ts[curr_status] = parsed_ts[next_status]

    for k, v in parsed_ts.items():
        new_ts[k] = v.isoformat()
    return new_ts


def calculate_tracking_progress(order: dict) -> dict:
    flow = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']
    current_status = normalize_order_status(order.get('status', 'PLACED'))
    if current_status not in flow:
        if current_status == 'CANCELLED':
            return {
                'current_step': 'CANCELLED',
                'completed_steps': ['PLACED'],
                'remaining_steps': [],
                'progress_percentage': 0
            }
        return {
            'current_step': current_status,
            'completed_steps': [],
            'remaining_steps': flow,
            'progress_percentage': 0
        }
    
    idx = flow.index(current_status)
    completed_steps = flow[:idx + 1]
    remaining_steps = flow[idx + 1:]
    progress_percentage = int(((idx + 1) / len(flow)) * 100)
    
    return {
        'current_step': current_status,
        'completed_steps': completed_steps,
        'remaining_steps': remaining_steps,
        'progress_percentage': progress_percentage
    }


def send_order_notification(order_id: str, event_type: str, message: str, user_id: str | None = None, title: str | None = None) -> None:
    create_notification(
        event_type=event_type,
        order_id=order_id,
        message=message,
        user_id=user_id,
        title=title
    )


def append_order_status_history(
    order_id: str,
    status_value: str,
    updated_by: str,
    performer_role: str = 'SYSTEM',
    performer_email: str = 'system@local',
    location: str = '',
    remarks: str = '',
) -> dict:
    normalized = normalize_order_status(status_value)
    timestamp = now_utc().isoformat()
    entry = {
        'id': f"OSH-{uuid4().hex[:12].upper()}",
        'order_id': order_id,
        'status': normalized,
        'updated_by': updated_by,
        'updated_by_role': performer_role,
        'updated_by_email': performer_email,
        'timestamp': timestamp,
        'location': location.strip() if location else '',
        'remarks': remarks.strip() if remarks else get_status_message(normalized),
    }

    order_status_history_collection.insert_one(entry)

    order = orders_collection.find_one({'order_id': order_id})
    if order:
        created_at = order.get('created_at') or now_utc()
        existing_ts = order.get('status_timestamps') or {}
        updated_ts = update_status_timestamp(created_at, existing_ts, normalized, timestamp)
    else:
        updated_ts = {normalized: timestamp}

    orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'status_timestamps': updated_ts,
                'updated_by': updated_by,
                'updated_by_role': performer_role,
                'updated_by_email': performer_email,
            },
            '$push': {'status_history': entry},
        },
    )
    return entry


def get_order_items(order_id: str) -> list[dict]:
    items = list(order_items_collection.find({'order_id': order_id}, {'_id': 0}))
    enriched_items = []
    for item in items:
        payload = dict(item)
        product = products_collection.find_one({'id': payload.get('product_id')}, {'_id': 0}) if payload.get('product_id') is not None else None
        if product:
            payload.setdefault('name', product.get('name'))
            payload.setdefault('image', product.get('image'))
            payload.setdefault('price', product.get('price'))
            payload.setdefault('category', product.get('category'))
            try:
                payload['product'] = serialize_product(product)
            except Exception:
                payload['product'] = {
                    'id': product.get('id'),
                    'name': product.get('name'),
                    'image': product.get('image'),
                    'price': product.get('price'),
                    'category': product.get('category'),
                }
        enriched_items.append(payload)
    return enriched_items


def get_tracking_logs(order_id: str) -> list[dict]:
    logs = list(delivery_logs_collection.find({'order_id': order_id}).sort('timestamp', 1))
    return [serialize_delivery_log(log) for log in logs]


def get_order_status_history(order_id: str) -> list[dict]:
    history = list(order_status_history_collection.find({'order_id': order_id}).sort('timestamp', 1))
    serialized = []
    for entry in history:
        payload = dict(entry)
        payload.pop('_id', None)
        serialized.append(payload)
    return serialized


def find_user_by_id_or_email(identifier: str) -> dict | None:
    value = str(identifier or '').strip()
    if not value:
        return None
    by_id = users_collection.find_one({'id': value})
    if by_id:
        raw_values = value if isinstance(value, list) else re.split(r'[\s,]+', str(value))
    return users_collection.find_one({'email': value.lower()})


def serialize_order(document: dict, include_shipment: bool = False) -> dict:
    payload = dict(document)
    payload.pop('_id', None)
    if isinstance(payload.get('created_at'), datetime):
        payload['created_at'] = payload['created_at'].isoformat()
    if isinstance(payload.get('updated_at'), datetime):
        payload['updated_at'] = payload['updated_at'].isoformat()
    payload['id'] = payload.get('id') or payload.get('order_id')
    payload['status'] = normalize_order_status(payload.get('status', 'PLACED'))
    payload['is_deleted'] = bool(payload.get('is_deleted', False))
    payload['status_timestamps'] = payload.get('status_timestamps') or {}
    history = get_order_status_history(payload.get('order_id', ''))
    if history:
        payload['status_history'] = history
    else:
        payload['status_history'] = payload.get('status_history') or []
    payload['assigned_delivery_id'] = payload.get('assigned_delivery_id')
    payload['items'] = get_order_items(payload.get('order_id', ''))
    payload['tracking_logs'] = get_tracking_logs(payload.get('order_id', ''))
    payload['payment'] = serialize_payment_for_order(payload.get('order_id', ''))
    payload['return_request'] = serialize_return_for_order(payload.get('order_id', ''))

    if include_shipment and payload.get('shipment_id'):
        shipment = shipments_collection.find_one({'shipment_id': payload['shipment_id']})
        payload['shipment'] = serialize_shipment(shipment)
        payload['shipment_events'] = get_shipment_events(payload['shipment_id'])
    elif payload.get('shipment_id'):
        payload['shipment_events'] = get_shipment_events(payload['shipment_id'])

    return payload


def serialize_orders_batch(orders: list[dict], include_shipment: bool = False) -> list[dict]:
    if not orders:
        return []

    order_ids = [o.get('order_id') for o in orders if o.get('order_id')]

    # 1. Fetch items and pre-fetch products
    raw_items = list(order_items_collection.find({'order_id': {'$in': order_ids}}, {'_id': 0}))
    product_ids = sorted({item.get('product_id') for item in raw_items if item.get('product_id') is not None})
    products = list(products_collection.find({'id': {'$in': product_ids}}, {'_id': 0}))
    product_map = {p.get('id'): p for p in products}

    items_by_order = {}
    for item in raw_items:
        payload = dict(item)
        product = product_map.get(payload.get('product_id'))
        if product:
            payload.setdefault('name', product.get('name'))
            payload.setdefault('image', product.get('image'))
            payload.setdefault('price', product.get('price'))
            payload.setdefault('category', product.get('category'))
            try:
                payload['product'] = serialize_product(product)
            except Exception:
                payload['product'] = {
                    'id': product.get('id'),
                    'name': product.get('name'),
                    'image': product.get('image'),
                    'price': product.get('price'),
                    'category': product.get('category'),
                }
        items_by_order.setdefault(item.get('order_id'), []).append(payload)

    # 2. Fetch order status history
    raw_history = list(order_status_history_collection.find({'order_id': {'$in': order_ids}}).sort('timestamp', 1))
    history_by_order = {}
    for entry in raw_history:
        payload = dict(entry)
        payload.pop('_id', None)
        history_by_order.setdefault(entry.get('order_id'), []).append(payload)

    # 3. Fetch tracking logs
    raw_logs = list(delivery_logs_collection.find({'order_id': {'$in': order_ids}}).sort('timestamp', 1))
    logs_by_order = {}
    for log in raw_logs:
        payload = serialize_delivery_log(log)
        logs_by_order.setdefault(log.get('order_id'), []).append(payload)

    # 4. Fetch payments
    raw_payments = list(payments_collection.find({'order_id': {'$in': order_ids}}, {'_id': 0}))
    payments_by_order = {}
    for p in raw_payments:
        payment = dict(p)
        if isinstance(payment.get('created_at'), datetime):
            payment['created_at'] = payment['created_at'].isoformat()
        if isinstance(payment.get('updated_at'), datetime):
            payment['updated_at'] = payment['updated_at'].isoformat()
        payment['status'] = normalize_payment_status(payment.get('status', 'PENDING'))
        payments_by_order[payment.get('order_id')] = payment

    # 5. Fetch return requests
    raw_returns = list(returns_collection.find({'order_id': {'$in': order_ids}}, {'_id': 0}))
    returns_by_order = {}
    for r in raw_returns:
        request = dict(r)
        if isinstance(request.get('created_at'), datetime):
            request['created_at'] = request['created_at'].isoformat()
        if isinstance(request.get('updated_at'), datetime):
            request['updated_at'] = request['updated_at'].isoformat()
        request['status'] = normalize_return_status(request.get('status', 'RETURN_REQUESTED'))
        returns_by_order[request.get('order_id')] = request

    # 6. Pre-fetch shipments & shipment events
    shipment_map = {}
    shipment_events_by_shipment = {}
    shipment_ids = [o.get('shipment_id') for o in orders if o.get('shipment_id')]
    if shipment_ids:
        if include_shipment:
            shipments = list(shipments_collection.find({'shipment_id': {'$in': shipment_ids}}))
            shipment_map = {s.get('shipment_id'): serialize_shipment(s) for s in shipments}
        events = list(shipment_events_collection.find({'shipment_id': {'$in': shipment_ids}}).sort('timestamp', 1))
        for event in events:
            payload = dict(event)
            payload.pop('_id', None)
            if isinstance(payload.get('timestamp'), datetime):
                payload['timestamp'] = payload['timestamp'].isoformat()
            shipment_events_by_shipment.setdefault(event.get('shipment_id'), []).append(payload)

    # 7. Serialize each order using pre-fetched structures
    serialized_orders = []
    for doc in orders:
        payload = dict(doc)
        payload.pop('_id', None)
        order_id = payload.get('order_id', '')

        if isinstance(payload.get('created_at'), datetime):
            payload['created_at'] = payload['created_at'].isoformat()
        if isinstance(payload.get('updated_at'), datetime):
            payload['updated_at'] = payload['updated_at'].isoformat()
        payload['id'] = payload.get('id') or order_id
        payload['status'] = normalize_order_status(payload.get('status', 'PLACED'))
        payload['is_deleted'] = bool(payload.get('is_deleted', False))
        payload['status_timestamps'] = payload.get('status_timestamps') or {}
        payload['status_history'] = history_by_order.get(order_id) or []
        payload['assigned_delivery_id'] = payload.get('assigned_delivery_id')
        payload['items'] = items_by_order.get(order_id) or []
        payload['tracking_logs'] = logs_by_order.get(order_id) or []
        payload['payment'] = payments_by_order.get(order_id)
        payload['return_request'] = returns_by_order.get(order_id)

        if include_shipment and payload.get('shipment_id'):
            sid = payload['shipment_id']
            payload['shipment'] = shipment_map.get(sid)
            payload['shipment_events'] = shipment_events_by_shipment.get(sid, [])
        elif payload.get('shipment_id'):
            sid = payload['shipment_id']
            payload['shipment_events'] = shipment_events_by_shipment.get(sid, [])
        
        serialized_orders.append(payload)

    return serialized_orders


def serialize_order_for_merchant(document: dict, merchant_product_ids: set, include_shipment: bool = False) -> dict:
    payload = serialize_order(document, include_shipment=include_shipment)
    if not payload:
        return payload
    payload['items'] = [item for item in payload.get('items', []) if item.get('product_id') in merchant_product_ids]
    merchant_total = sum(float(item.get('price') or 0) * int(item.get('quantity') or 0) for item in payload['items'])
    payload['total_amount'] = merchant_total
    payload['order_value'] = merchant_total
    return payload



def normalize_payment_status(value: str, fallback: str = 'PENDING') -> str:
    candidate = str(value or fallback).strip().upper()
    if candidate in PAYMENT_STATUSES:
        return candidate
    return fallback


def normalize_payment_method(value: str, fallback: str = 'COD') -> str:
    candidate = str(value or fallback).strip().upper()
    if candidate in PAYMENT_METHODS:
        return candidate
    return fallback


def sanitize_payment_details(method: str, details: dict | None) -> dict:
    source = details if isinstance(details, dict) else {}
    normalized_method = normalize_payment_method(method)

    if normalized_method == 'UPI':
        return {
            'upi_id': str(source.get('upi_id') or '').strip().lower(),
        }
    if normalized_method == 'CARD':
        card_number = ''.join(ch for ch in str(source.get('card_number') or '') if ch.isdigit())
        return {
            'card_last4': card_number[-4:] if len(card_number) >= 4 else '',
            'card_holder': str(source.get('card_holder') or '').strip(),
            'expiry': str(source.get('expiry') or '').strip(),
        }
    if normalized_method == 'NETBANKING':
        return {
            'bank_name': str(source.get('bank_name') or '').strip(),
        }
    if normalized_method == 'WALLET':
        return {
            'wallet_provider': str(source.get('wallet_provider') or '').strip(),
        }
    return {}


def normalize_return_status(value: str, fallback: str = 'RETURN_REQUESTED') -> str:
    candidate = str(value or fallback).strip().upper()
    if candidate in RETURN_STATUS_FLOW:
        return candidate
    return fallback


def is_valid_return_transition(current_status: str, target_status: str) -> bool:
    current = normalize_return_status(current_status)
    target = normalize_return_status(target_status)

    if current == target:
        return True

    if current == 'RETURN_REQUESTED' and target in {'PICKUP', 'RETURN_REJECTED'}:
        return True

    if current == 'PICKUP' and target == 'RETURNED':
        return True

    if current == 'RETURNED' and target == 'REFUNDED':
        return True

    return False


def build_initial_status_timestamps(initial_status: str) -> dict:
    normalized = normalize_order_status(initial_status)
    return {normalized: now_utc().isoformat()}


def append_status_timestamp(order_id: str, status_value: str, performed_by: str = "system", performer_role: str = "SYSTEM", performer_email: str = "system@local", location: str = "") -> None:
    append_order_status_history(
        order_id,
        status_value,
        performed_by,
        performer_role=performer_role,
        performer_email=performer_email,
        location=location,
    )


def create_notification(
    event_type: str, 
    order_id: str, 
    message: str, 
    user_id: str | None = None,
    title: str | None = None
) -> None:
    normalized_event = str(event_type or '').strip().upper()
    if normalized_event in {'SHIPPED', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED_AT_CITY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'}:
        notification_type = 'DELIVERY'
    elif normalized_event in {'PLACED', 'CONFIRMED', 'PACKED', 'REJECTED', 'CANCELLED', 'ORDER_PLACED'}:
        notification_type = 'ORDER_UPDATE'
    else:
        notification_type = 'GENERAL'

    notification = {
        'id': f"NOTIF-{uuid4().hex[:12].upper()}",
        'event_type': normalized_event,
        'type': notification_type,
        'order_id': order_id,
        'user_id': user_id,
        'message': message,
        'title': title or generate_notification_title(event_type),
        'is_read': False,
        'created_at': now_utc().isoformat(),
    }
    
    notifications_collection.insert_one(notification)
    
    if user_id:
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(manager.broadcast_to_user(user_id, {
                    "type": "notification",
                    "data": notification
                }))
        except:
            pass


def generate_notification_title(event_type: str) -> str:
    titles = {
        'PLACED': '📝 Order Placed',
        'CONFIRMED': '✅ Order Confirmed',
        'PACKED': '📦 Order Packed',
        'SHIPPED': '🚚 Order Shipped',
        'DISPATCHED': '🚚 Shipment Dispatched',
        'IN_TRANSIT': '📍 Shipment In Transit',
        'ARRIVED_AT_CITY': '🏙️ Shipment Reached City Hub',
        'OUT_FOR_DELIVERY': '🚚 Out for Delivery',
        'DELIVERED': '✅ Order Delivered',
        'REJECTED': '❌ Order Rejected',
        'CANCELLED': '❌ Order Cancelled',
        'DELIVERY_FAILED': '⚠️ Delivery Failed',
        'ORDER_PLACED': '📝 Order Placed',
        'PAYMENT_SUCCESS': '💳 Payment Received',
        'PAYMENT_FAILED': '💳 Payment Failed',
        'RETURN_REQUESTED': '🔄 Return Requested',
    }
    return titles.get(event_type, 'Order Update')


def serialize_payment_for_order(order_id: str) -> dict | None:
    payment = payments_collection.find_one({'order_id': order_id}, {'_id': 0})
    if not payment:
        return None
    if isinstance(payment.get('created_at'), datetime):
        payment['created_at'] = payment['created_at'].isoformat()
    if isinstance(payment.get('updated_at'), datetime):
        payment['updated_at'] = payment['updated_at'].isoformat()
    payment['status'] = normalize_payment_status(payment.get('status', 'PENDING'))
    return payment


def serialize_return_for_order(order_id: str) -> dict | None:
    request = returns_collection.find_one({'order_id': order_id}, {'_id': 0})
    if not request:
        return None
    if isinstance(request.get('created_at'), datetime):
        request['created_at'] = request['created_at'].isoformat()
    if isinstance(request.get('updated_at'), datetime):
        request['updated_at'] = request['updated_at'].isoformat()
    request['status'] = normalize_return_status(request.get('status', 'RETURN_REQUESTED'))
    return request


def set_payment_status(
    order_id: str,
    status_value: str,
    method: str | None = None,
    reason: str | None = None,
    payment_details: dict | None = None,
) -> dict:
    normalized = normalize_payment_status(status_value)
    existing = payments_collection.find_one({'order_id': order_id})
    payment_method = normalize_payment_method(method or (existing or {}).get('method') or 'COD')
    details_payload = sanitize_payment_details(payment_method, payment_details or (existing or {}).get('details'))
    payload = {
        'order_id': order_id,
        'payment_id': (existing or {}).get('payment_id') or f"PAY-{uuid4().hex[:12].upper()}",
        'method': payment_method,
        'status': normalized,
        'details': details_payload,
        'reason': str(reason or '').strip(),
        'updated_at': now_utc(),
    }
    payments_collection.update_one(
        {'order_id': order_id},
        {'$set': payload, '$setOnInsert': {'created_at': now_utc()}},
        upsert=True,
    )
    return payments_collection.find_one({'order_id': order_id}, {'_id': 0}) or payload


def sanitize_pincode(value: str) -> str:
    cleaned = ''.join(ch for ch in str(value or '').strip() if ch.isdigit())
    return cleaned[:6] if cleaned else ''


def sanitize_phone_number(value: str) -> str:
    return ''.join(ch for ch in str(value or '') if ch.isdigit())


def is_valid_indian_pincode(pincode: str) -> bool:
    return bool(INDIA_PINCODE_REGEX.match(pincode))


def parse_service_pincodes(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw_values = [str(item or '') for item in value]
    else:
        raw_values = str(value).split(',')

    cleaned = []
    seen = set()
    for entry in raw_values:
        pincode = sanitize_pincode(entry)
        if not pincode or pincode in seen:
            continue
        cleaned.append(pincode)
        seen.add(pincode)
    return cleaned


parse_serviceable_pincodes = parse_service_pincodes


def is_demo_delivery_partner_account(account: dict | None) -> bool:
    payload = account or {}
    email = str(payload.get('email') or '').strip().lower()
    user_id = str(payload.get('id') or '').strip().upper()
    return email == DEMO_DELIVERY_PARTNER_EMAIL or user_id == DEMO_DELIVERY_PARTNER_ID


def is_delivery_partner_all_india(profile: dict | None) -> bool:
    profile_details = profile or {}
    service_scope = str(profile_details.get('service_scope') or '').strip().upper()
    return bool(profile_details.get('allow_all_india')) or service_scope == 'ALL_INDIA'


def normalize_delivery_partner_profile_for_scope(profile_details: dict | None, is_demo_partner: bool) -> dict:
    normalized = normalize_delivery_profile_details(profile_details)
    if is_demo_partner:
        normalized['service_scope'] = 'ALL_INDIA'
        normalized['allow_all_india'] = True
        normalized['service_pincodes'] = []
        return normalized

    normalized['service_scope'] = 'LOCAL'
    normalized['allow_all_india'] = False
    normalized['service_pincodes'] = parse_service_pincodes(normalized.get('service_pincodes') or normalized.get('service_pincode'))
    if normalized['service_pincodes']:
        normalized['service_pincode'] = normalized['service_pincodes'][0]
    return normalized


def ensure_demo_partner_service_sync(partner: dict, destination: dict, destination_pincode: str) -> None:
    if not is_demo_delivery_partner_account(partner):
        return

    profile = normalize_delivery_partner_profile_for_scope(partner.get('profile_details') or {}, is_demo_partner=True)
    profile['city'] = normalize_city_name(destination.get('city', '')) or profile.get('city', '')
    profile['state'] = normalize_state_name(destination.get('state', '')) or profile.get('state', '')
    profile['service_pincode'] = destination_pincode or profile.get('service_pincode', '')
    users_collection.update_one(
        {'id': partner.get('id')},
        {
            '$set': {
                'city': profile.get('city', ''),
                'state': profile.get('state', ''),
                'profile_details': profile,
                'updated_at': now_utc(),
            }
        },
    )


def normalize_delivery_profile_details(profile_details: dict | None) -> dict:
    profile = dict(profile_details or {})
    service_pincodes = parse_service_pincodes(profile.get('service_pincodes') or profile.get('service_pincode'))

    if is_delivery_partner_all_india(profile):
        profile['service_scope'] = 'ALL_INDIA'
        profile['allow_all_india'] = True
        profile['service_pincodes'] = []
    else:
        profile['service_scope'] = 'LOCAL'
        profile['allow_all_india'] = False
        profile['service_pincodes'] = service_pincodes
        if service_pincodes:
            profile['service_pincode'] = service_pincodes[0]

    return profile


def normalize_state_name(value: str) -> str:
    key = str(value or '').strip().lower()
    return STATE_NAME_LOOKUP.get(key, str(value or '').strip())


def normalize_city_name(value: str) -> str:
    parts = [segment for segment in str(value or '').strip().split() if segment]
    return ' '.join(parts)


def normalize_delivery_scope(value: str) -> str:
    scope = str(value or 'NATIONWIDE').strip().upper()
    if scope in DELIVERY_SCOPE_VALUES:
        return scope
    return 'NATIONWIDE'


def normalize_delivery_coverage_payload(payload: DeliveryCoverageRequest) -> dict:
    scope = normalize_delivery_scope(payload.delivery_scope)

    states = []
    seen_states = set()
    for state in payload.states or []:
        normalized_state = normalize_state_name(state)
        if not normalized_state:
            continue
        state_key = normalized_state.lower()
        if state_key in seen_states:
            continue
        seen_states.add(state_key)
        states.append(normalized_state)

    cities = []
    seen_cities = set()
    for item in payload.cities or []:
        normalized_state = normalize_state_name(item.state)
        normalized_city = normalize_city_name(item.city)
        if not normalized_state or not normalized_city:
            continue
        city_key = (normalized_state.lower(), normalized_city.lower())
        if city_key in seen_cities:
            continue
        seen_cities.add(city_key)
        cities.append({'state': normalized_state, 'city': normalized_city})

    if scope == 'STATE' and not states:
        raise HTTPException(status_code=400, detail='Select at least one state for state-wise delivery scope.')

    if scope == 'CITY':
        if not cities:
            raise HTTPException(status_code=400, detail='Select at least one state and city for city-wise delivery scope.')

        city_states = []
        seen_city_states = set()
        for entry in cities:
            state_key = entry['state'].lower()
            if state_key in seen_city_states:
                continue
            seen_city_states.add(state_key)
            city_states.append(entry['state'])
        states = city_states

    return {
        'delivery_scope': scope,
        'states': states,
        'cities': cities,
        'deliver_all_cities_in_selected_states': bool(payload.deliver_all_cities_in_selected_states),
    }


def get_default_merchant_id() -> str | None:
    merchant = users_collection.find_one({'role': 'ADMIN'}, {'_id': 0, 'id': 1}, sort=[('created_at', 1)])
    if merchant and merchant.get('id'):
        return str(merchant['id'])
    return 'USR-DEMO-ADMIN-01'


def get_merchant_delivery_coverage(merchant_id: str | None = None) -> dict:
    requested_merchant_id = str(merchant_id or '').strip() or get_default_merchant_id()
    if not requested_merchant_id:
        return {
            'merchant_id': '',
            'delivery_scope': 'NATIONWIDE',
            'states': [],
            'cities': [],
            'deliver_all_cities_in_selected_states': False,
        }

    record = delivery_coverage_collection.find_one({'merchant_id': requested_merchant_id}, {'_id': 0})
    if not record:
        return {
            'merchant_id': requested_merchant_id,
            'delivery_scope': 'NATIONWIDE',
            'states': [],
            'cities': [],
            'deliver_all_cities_in_selected_states': False,
        }

    return {
        'merchant_id': requested_merchant_id,
        'delivery_scope': normalize_delivery_scope(record.get('delivery_scope', 'NATIONWIDE')),
        'states': [normalize_state_name(state) for state in (record.get('states') or []) if normalize_state_name(state)],
        'cities': [
            {
                'state': normalize_state_name(city_item.get('state', '')),
                'city': normalize_city_name(city_item.get('city', '')),
            }
            for city_item in (record.get('cities') or [])
            if normalize_state_name(city_item.get('state', '')) and normalize_city_name(city_item.get('city', ''))
        ],
        'deliver_all_cities_in_selected_states': bool(record.get('deliver_all_cities_in_selected_states', False)),
    }


def is_delivery_allowed_for_location(coverage: dict, location: dict) -> bool:
    scope = normalize_delivery_scope(coverage.get('delivery_scope', 'NATIONWIDE'))
    if scope == 'NATIONWIDE':
        return True

    user_state = normalize_state_name(location.get('state', ''))
    if not user_state:
        return False

    selected_states = {
        normalize_state_name(state).lower()
        for state in coverage.get('states', [])
        if normalize_state_name(state)
    }

    if scope == 'STATE':
        return user_state.lower() in selected_states

    user_city = normalize_city_name(location.get('city', ''))
    if not user_city:
        return False

    selected_city_pairs = {
        (
            normalize_state_name(city_item.get('state', '')).lower(),
            normalize_city_name(city_item.get('city', '')).lower(),
        )
        for city_item in coverage.get('cities', [])
        if normalize_state_name(city_item.get('state', '')) and normalize_city_name(city_item.get('city', ''))
    }
    return (user_state.lower(), user_city.lower()) in selected_city_pairs


def get_location_for_pincode(pincode: str) -> dict:
    cached = PINCODE_LOCATION_CACHE.get(pincode)
    if cached:
        return dict(cached)

    known = PINCODE_DIRECTORY.get(pincode)
    if known:
        location = {'pincode': pincode, **known}
        PINCODE_LOCATION_CACHE[pincode] = location
        return dict(location)

    state_name = PINCODE_STATE_PREFIX.get(pincode[:2], 'Unknown State')
    location = {'pincode': pincode, 'city': 'Unknown City', 'state': state_name}
    PINCODE_LOCATION_CACHE[pincode] = location
    return dict(location)


def delivery_bucket(user_location: dict, warehouse: dict) -> int:
    user_city = str(user_location.get('city', '')).strip()
    user_state = str(user_location.get('state', '')).strip()
    warehouse_city = str(warehouse.get('city', '')).strip()
    warehouse_state = str(warehouse.get('state', '')).strip()
    
    if user_city and warehouse_city and user_state and warehouse_state:
        if user_city == warehouse_city and user_state == warehouse_state:
            return 0
        if user_state == warehouse_state:
            return 1
    return 2


def choose_best_warehouse(product_id: int, user_location: dict) -> dict:
    candidates = list(warehouses_collection.find({'product_id': product_id}, {'_id': 0}))
    if not candidates:
        fallback = {
            'warehouse_id': f'WH-FALLBACK-{product_id}',
            'product_id': product_id,
            'pincode': '560001',
            'city': 'Bengaluru',
            'state': 'Karnataka',
            'express_enabled': False,
        }
        return fallback

    user_pincode = str(user_location.get('pincode', '560001'))[:3]
    
    ranked = sorted(
        candidates,
        key=lambda warehouse: (
            delivery_bucket(user_location, warehouse),
            abs(int(user_pincode) - int(str(warehouse.get('pincode', '560001'))[:3])),
        ),
    )
    return ranked[0]


def reduce_inventory_for_order(order_id: str, warehouse_id: str | None) -> None:
    if not warehouse_id:
        return

    items = get_order_items(order_id)
    for item in items:
        product_id = item.get('product_id')
        quantity = int(item.get('quantity', 1) or 1)
        if product_id is None or quantity <= 0:
            continue

        warehouse_entry = warehouses_collection.find_one({'warehouse_id': warehouse_id, 'product_id': product_id}, {'_id': 0, 'stock': 1})
        current_stock = int((warehouse_entry or {}).get('stock', 0) or 0)
        next_stock = max(0, current_stock - quantity)
        warehouses_collection.update_one(
            {'warehouse_id': warehouse_id, 'product_id': product_id},
            {'$set': {'stock': next_stock, 'updated_at': now_utc()}},
            upsert=True,
        )


def estimate_delivery_days(user_location: dict, warehouse: dict, express: bool = False) -> int:
    if express and bool(warehouse.get('express_enabled')):
        return 1

    bucket = delivery_bucket(user_location, warehouse)
    if bucket == 0:
        return 2
    if bucket == 1:
        return 3
    return 5


def format_delivery_date(delivery_date: datetime) -> str:
    return f"{delivery_date.strftime('%A, %b')} {delivery_date.day}"


def compute_same_day_cutoff_hours() -> int:
    now = now_utc()
    cutoff = now.replace(hour=17, minute=0, second=0, microsecond=0)
    if now >= cutoff:
        return 0
    remaining = cutoff - now
    return max(1, int(remaining.total_seconds() // 3600))


def generate_tracking_id() -> str:
    timestamp = now_utc().strftime('%Y%m%d%H%M%S')
    random_digits = f"{random.randint(100, 999)}"
    return f'TRK{timestamp}{random_digits}'


def choose_courier_name(warehouse: dict, destination: dict) -> str:
    warehouse_city = normalize_city_name(warehouse.get('city', ''))
    warehouse_state = normalize_state_name(warehouse.get('state', ''))
    destination_city = normalize_city_name(destination.get('city', ''))
    destination_state = normalize_state_name(destination.get('state', ''))

    if warehouse_city and destination_city and warehouse_city.lower() == destination_city.lower() and warehouse_state.lower() == destination_state.lower():
        return 'Local Express'
    if warehouse_state and destination_state and warehouse_state.lower() == destination_state.lower():
        return 'Regional Courier'
    return 'National Courier'


def normalize_max_orders_per_shipment(value: int | None) -> int:
    if not value or value <= 0:
        return DEFAULT_MAX_ORDERS_PER_SHIPMENT
    return max(1, min(int(value), 50))


def chunk_orders(values: list[dict], size: int) -> list[list[dict]]:
    if not values:
        return []
    return [values[index:index + size] for index in range(0, len(values), size)]


def get_order_destination_location(order: dict) -> dict:
    shipping = order.get('shipping_details') or {}
    city_from_shipping = str(shipping.get('city') or '').strip()
    state_from_shipping = str(shipping.get('state') or '').strip()
    
    if city_from_shipping and state_from_shipping:
        return {
            'city': city_from_shipping,
            'state': state_from_shipping,
            'pincode': sanitize_pincode(shipping.get('pincode') or order.get('destination_pincode', ''))
        }
    
    destination_pincode = sanitize_pincode(order.get('destination_pincode') or shipping.get('pincode') or '')
    if not is_valid_indian_pincode(destination_pincode):
        destination_pincode = '560001'
    
    location = get_location_for_pincode(destination_pincode)
    
    if city_from_shipping:
        location['city'] = city_from_shipping
    if state_from_shipping:
        location['state'] = state_from_shipping
    
    return location


def get_warehouse_location(order: dict) -> dict:
    warehouse_id = str(order.get('warehouse_id') or '').strip()
    warehouse = warehouses_collection.find_one({'warehouse_id': warehouse_id}, {'_id': 0}) if warehouse_id else None
    if warehouse:
        return {
            'warehouse_id': warehouse_id,
            'city': warehouse.get('city', ''),
            'state': warehouse.get('state', ''),
            'pincode': warehouse.get('pincode', ''),
        }

    fallback_pincode = '560001'
    fallback_location = get_location_for_pincode(fallback_pincode)
    return {
        'warehouse_id': warehouse_id or 'WH-FALLBACK',
        'city': fallback_location.get('city', ''),
        'state': fallback_location.get('state', ''),
        'pincode': fallback_pincode,
    }


def group_orders_for_shipments(orders: list[dict], max_orders_per_shipment: int) -> list[list[dict]]:
    grouped: dict[tuple[str, str, str], list[dict]] = {}
    for order in orders:
        destination = get_order_destination_location(order)
        warehouse_id = str(order.get('warehouse_id') or '').strip() or 'WH-FALLBACK'
        city_key = normalize_city_name(destination.get('city', '')).lower()
        state_key = normalize_state_name(destination.get('state', '')).lower()
        group_key = (warehouse_id, state_key, city_key)
        
        grouped.setdefault(group_key, []).append(order)

    batches: list[list[dict]] = []
    for group_orders in grouped.values():
        batches.extend(chunk_orders(group_orders, max_orders_per_shipment))
    
    return batches


def get_delivery_partner_workload() -> dict[str, int]:
    workload: dict[str, int] = {}
    active_statuses = {'PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'}
    for order in orders_collection.find({'status': {'$in': list(active_statuses)}}, {'_id': 0, 'assigned_delivery_id': 1}):
        delivery_id = str(order.get('assigned_delivery_id') or '').strip()
        if not delivery_id:
            continue
        workload[delivery_id] = workload.get(delivery_id, 0) + 1
    return workload


def score_delivery_partner(partner: dict, destination: dict, destination_pincode: str, workload_map: dict[str, int]) -> int:
    score = 0
    profile = normalize_delivery_partner_profile_for_scope(
        partner.get('profile_details') or {},
        is_demo_partner=is_demo_delivery_partner_account(partner),
    )
    is_demo_partner = is_demo_delivery_partner_account(partner)
    availability = str(profile.get('availability') or '').strip().upper().replace('-', '_')
    if availability == 'FULL_TIME':
        score += 4
    elif availability == 'PART_TIME':
        score += 2

    service_pincodes = parse_service_pincodes(profile.get('service_pincodes') or profile.get('service_pincode'))
    if is_demo_partner:
        score += 10
    else:
        if destination_pincode not in service_pincodes:
            return -10_000
        score += 8

    partner_city = normalize_city_name(profile.get('city') or partner.get('city') or '')
    partner_state = normalize_state_name(profile.get('state') or partner.get('state') or '')
    destination_city = normalize_city_name(destination.get('city', ''))
    destination_state = normalize_state_name(destination.get('state', ''))

    if partner_city and destination_city and partner_city.lower() == destination_city.lower():
        score += 3
    if partner_state and destination_state and partner_state.lower() == destination_state.lower():
        score += 2

    partner_id = str(partner.get('id') or '').strip()
    score -= workload_map.get(partner_id, 0)
    return score


def auto_assign_delivery_partner(destination: dict, destination_pincode: str) -> tuple[str | None, str | None]:
    return None, None


def build_tracking_id_for_batch(base_tracking_id: str, index: int) -> str:
    cleaned_base = str(base_tracking_id or '').strip()
    if not cleaned_base:
        return generate_tracking_id()
    if index == 0:
        return cleaned_base
    return f'{cleaned_base}{index + 1}'


def ensure_indexes() -> None:
    def create_index_safe(collection, keys, **kwargs):
        try:
            collection.create_index(keys, **kwargs)
        except OperationFailure as exc:
            if getattr(exc, 'code', None) == 86:
                return
            raise

    create_index_safe(users_collection, 'email', unique=True)
    create_index_safe(users_collection, [('role', 1), ('status', 1)])
    create_index_safe(orders_collection, 'order_id', unique=True)
    create_index_safe(orders_collection, [('user_id', 1), ('created_at', -1)])
    create_index_safe(orders_collection, [('customer_email', 1), ('created_at', -1)])
    create_index_safe(orders_collection, [('status', 1), ('updated_at', -1)])
    create_index_safe(orders_collection, [('assigned_delivery_id', 1), ('updated_at', -1)])
    create_index_safe(orders_collection, [('assigned_delivery_partner', 1), ('updated_at', -1)])
    create_index_safe(shipments_collection, 'shipment_id', unique=True)
    create_index_safe(shipments_collection, 'tracking_id', unique=True)
    create_index_safe(order_items_collection, [('order_id', 1), ('product_id', 1)])
    create_index_safe(shipment_items_collection, [('shipment_id', 1), ('order_id', 1)], unique=True)
    create_index_safe(delivery_logs_collection, [('order_id', 1), ('timestamp', 1)])
    create_index_safe(order_status_history_collection, [('order_id', 1), ('timestamp', 1)])
    create_index_safe(shipment_events_collection, [('shipment_id', 1), ('timestamp', 1)])
    create_index_safe(warehouses_collection, 'warehouse_id', unique=True)
    create_index_safe(warehouses_collection, [('product_id', 1), ('pincode', 1)])
    create_index_safe(delivery_coverage_collection, 'merchant_id', unique=True)
    create_index_safe(payments_collection, 'order_id', unique=True)
    create_index_safe(returns_collection, 'order_id', unique=True)
    create_index_safe(merchant_shipping_settings_collection, 'merchant_id', unique=True)
    create_index_safe(serviceable_pincodes_collection, [('merchant_id', 1), ('pincode', 1)], unique=True)
    create_index_safe(blocked_pincodes_collection, [('merchant_id', 1), ('pincode', 1)], unique=True)
    create_index_safe(pincode_distance_cache_collection, [('from_pincode', 1), ('to_pincode', 1)], unique=True)
    create_index_safe(notifications_collection, [('user_id', 1), ('created_at', -1)])
    create_index_safe(notifications_collection, [('order_id', 1), ('created_at', -1)])
    create_index_safe(users_collection, [('role', 1), ('merchant_status', 1), ('status', 1)])
    create_index_safe(products_collection, [('merchant_id', 1), ('review_status', 1)])
    create_index_safe(banners_collection, [('merchant_id', 1), ('status', 1), ('created_at', -1)])
    create_index_safe(platform_settings_collection, 'key', unique=True)
    create_index_safe(global_offers_collection, 'key', unique=True)


def seed_products() -> None:
    for product in SEED_PRODUCTS:
        payload = dict(product)
        product_id = int(payload.get('id') or 0)
        if not product_id:
            continue

        existing = products_collection.find_one({'id': product_id})
        if existing:
            continue 

        payload['merchant_id'] = str(payload.get('merchant_id') or 'USR-DEMO-ADMIN-01').strip() or 'USR-DEMO-ADMIN-01'
        payload['review_status'] = normalize_product_review_status(payload.get('review_status', 'APPROVED'))
        payload['created_at'] = now_utc()
        
        if 'stock' not in payload and 'stock_quantity' not in payload:
            payload['stock'] = 50 

        products_collection.insert_one(payload)


def seed_users() -> None:
    for _, account in SEED_USERS.items():
        email = account['email'].strip().lower()
        
        existing = users_collection.find_one({'email': email})
        if existing:
            continue
        
        profile_details = account.get('profile_details') if isinstance(account.get('profile_details'), dict) else {}
        bank_details = profile_details.get('bank_details') if isinstance(profile_details.get('bank_details'), dict) else {}
        user_role = normalize_role(account.get('role', 'CUSTOMER'))
        
        if user_role == 'DELIVERY_ASSOCIATE':
            user_profile = {
                'phone_number': str(profile_details.get('phone_number') or account.get('phone_number') or '').strip(),
                'vehicle_type': str(profile_details.get('vehicle_type') or '').strip().upper(),
                'vehicle_number': str(profile_details.get('vehicle_number') or '').strip().upper(),
                'driving_license_number': str(profile_details.get('driving_license_number') or '').strip().upper(),
                'availability': str(profile_details.get('availability') or 'FULL_TIME').strip().upper(),
                'service_scope': str(profile_details.get('service_scope') or 'LOCAL').strip().upper(),
                'allow_all_india': bool(profile_details.get('allow_all_india', False)),
                'service_pincodes': profile_details.get('service_pincodes') or [],
                'profile_image_url': str(profile_details.get('profile_image_url') or '').strip(),
                'city': str(profile_details.get('city') or '').strip(),
                'state': str(profile_details.get('state') or '').strip(),
                'is_online': bool(profile_details.get('is_online', True)),
            }
        else:
            user_profile = {
                'store_name': str(profile_details.get('store_name') or '').strip(),
                'gst_number': str(profile_details.get('gst_number') or '').strip(),
                'logo_url': str(profile_details.get('logo_url') or '').strip(),
                'bank_details': {
                    'account_holder_name': str(bank_details.get('account_holder_name') or '').strip(),
                    'bank_name': str(bank_details.get('bank_name') or '').strip(),
                    'account_number': str(bank_details.get('account_number') or '').strip(),
                    'ifsc_code': str(bank_details.get('ifsc_code') or '').strip(),
                },
            }
        
        user_document = {
            'id': account.get('id') or f"USR-{uuid4().hex[:10].upper()}",
            'name': account['full_name'],
            'full_name': account['full_name'],
            'email': email,
            'provider': account.get('provider', 'email'),
            'role': user_role,
            'status': normalize_account_status(account.get('status', 'ACTIVE')),
            'merchant_status': normalize_merchant_status(
                account.get('merchant_status', 'APPROVED' if user_role == 'ADMIN' else 'PENDING')
            ),
            'phone_number': str(account.get('phone_number') or profile_details.get('phone_number') or '').strip(),
            'city': str(profile_details.get('city') or '').strip(),
            'state': str(profile_details.get('state') or '').strip(),
            'is_online': bool(profile_details.get('is_online', True)) if user_role == 'DELIVERY_ASSOCIATE' else False,
            'profile_details': user_profile,
            'password_hash': hash_password(account['password']),
            'created_at': now_utc(),
            'updated_at': now_utc(),
        }
        
        users_collection.insert_one(user_document)


def seed_platform_defaults() -> None:
    now = now_utc()
    platform_settings_collection.update_one(
        {'key': 'branding'},
        {
            '$setOnInsert': {
                'key': 'branding',
                'platform_name': 'Movi Fashion',
                'logo_url': '/movicloud%20logo.png',
                'updated_at': now,
                'created_at': now,
            }
        },
        upsert=True,
    )
    global_offers_collection.update_one(
        {'key': 'global'},
        {
            '$setOnInsert': {
                'key': 'global',
                'title': 'Season Launch Offer',
                'description': 'Use launch offers selected by platform control.',
                'discount_percent': 0,
                'code': '',
                'active': False,
                'updated_at': now,
                'created_at': now,
            }
        },
        upsert=True,
    )


def backfill_merchant_statuses() -> None:
    users_collection.update_many(
        {'role': {'$in': ['ADMIN', 'MERCHANT']}, 'merchant_status': {'$exists': False}},
        {'$set': {'merchant_status': 'APPROVED', 'updated_at': now_utc()}},
    )
    users_collection.update_many(
        {'role': {'$in': ['ADMIN', 'MERCHANT']}, 'status': {'$exists': False}},
        {'$set': {'status': 'ACTIVE', 'merchant_status': 'APPROVED', 'updated_at': now_utc()}},
    )
    users_collection.update_many(
        {'role': {'$in': ['ADMIN', 'MERCHANT']}, 'status': 'PENDING'},
        {'$set': {'status': 'ACTIVE', 'merchant_status': 'APPROVED', 'updated_at': now_utc()}},
    )
    users_collection.update_many(
        {'role': {'$nin': ['ADMIN', 'MERCHANT']}, 'merchant_status': {'$exists': False}},
        {'$set': {'merchant_status': 'PENDING', 'updated_at': now_utc()}},
    )
    users_collection.update_many(
        {'role': {'$in': ['DELIVERY_ASSOCIATE', 'OPERATIONS_STAFF']}, 'status': 'PENDING'},
        {'$set': {'status': 'ACTIVE', 'updated_at': now_utc()}},
    )


def backfill_product_review_status() -> None:
    products_collection.update_many(
        {'review_status': {'$exists': False}},
        {'$set': {'review_status': 'APPROVED', 'updated_at': now_utc()}},
    )


def backfill_seed_product_stock() -> None:
    seed_product_ids = [product['id'] for product in SEED_PRODUCTS]
    
    products_collection.update_many(
        {
            'id': {'$in': seed_product_ids},
            '$or': [
                {'stock': {'$exists': False}},
                {'stock': 0},
                {'stock_quantity': {'$exists': False}},
                {'stock_quantity': 0},
            ]
        },
        {
            '$set': {
                'stock': 50,
                'stock_quantity': 50,
                'updated_at': now_utc()
            }
        }
    )


def seed_shipments() -> None:
    for shipment in SEED_SHIPMENTS:
        shipment_payload = dict(shipment)
        shipment_created_at = shipment_payload.pop('created_at', None)
        shipments_collection.update_one(
            {'shipment_id': shipment['shipment_id']},
            {'$set': shipment_payload, '$setOnInsert': {'created_at': shipment_created_at or now_utc()}},
            upsert=True,
        )


def seed_orders() -> None:
    for order in SEED_ORDERS:
        existing = orders_collection.find_one({'order_id': order['order_id']})
        if existing:
            continue 
        order_payload = dict(order)
        order_created_at = order_payload.pop('created_at', None)
        order_payload['created_at'] = order_created_at or now_utc()
        order_payload['is_deleted'] = False
        orders_collection.insert_one(order_payload)


def backfill_order_items_and_logs() -> None:
    projection = {
        '_id': 1,
        'order_id': 1,
        'items': 1,
        'status': 1,
        'created_at': 1,
        'customer_email': 1,
        'user_id': 1,
    }
    for order in orders_collection.find({}, projection):
        order_id = order.get('order_id')
        if not order_id:
            continue

        if order_items_collection.count_documents({'order_id': order_id}) == 0:
            for item in order.get('items', []):
                order_items_collection.insert_one(
                    {
                        'id': f"OI-{uuid4().hex[:12].upper()}",
                        'order_id': order_id,
                        'product_id': item.get('product_id'),
                        'quantity': int(item.get('quantity', 1) or 1),
                    }
                )

        if delivery_logs_collection.count_documents({'order_id': order_id}) == 0:
            delivery_logs_collection.insert_one(
                {
                    'id': f"DLOG-{uuid4().hex[:12].upper()}",
                    'order_id': order_id,
                    'status': normalize_order_status(order.get('status', 'PLACED')),
                    'updated_by': order.get('user_id') or order.get('customer_email') or 'system-seed',
                    'location': 'Order system',
                    'timestamp': order.get('created_at') or now_utc(),
                }
            )


def backfill_orders_workflow_state() -> None:
    projection = {'_id': 1, 'order_id': 1, 'status': 1, 'payment_method': 1, 'status_timestamps': 1, 'created_at': 1, 'updated_at': 1}
    for order in orders_collection.find({}, projection):
        order_id = order.get('order_id')
        if not order_id:
            continue

        update_fields = {}
        current_status = order.get('status') or 'PLACED'
        created_at = order.get('created_at') or order.get('updated_at') or now_utc()
        
        existing_timestamps = order.get('status_timestamps') or {}
        updated_ts = update_status_timestamp(created_at, existing_timestamps, current_status, order.get('updated_at') or now_utc())
        update_fields['status_timestamps'] = updated_ts

        if not order.get('status'):
            update_fields['status'] = normalize_order_status(current_status)

        if not order.get('payment_method'):
            update_fields['payment_method'] = normalize_payment_method('COD')

        if update_fields:
            update_fields['updated_at'] = now_utc()
            orders_collection.update_one(
                {'_id': order['_id']},
                {'$set': update_fields}
            )

        if payments_collection.count_documents({'order_id': order_id}) == 0:
            payment_method = normalize_payment_method(order.get('payment_method') or 'COD')
            initial_payment_status = 'PENDING' if payment_method == 'COD' else 'SUCCESS'
            set_payment_status(order_id, initial_payment_status, method=payment_method)


def backfill_demo_seed_tracking_state() -> None:
    demo_order_state_map = {
        'ORD-1001': 'CONFIRMED',
        'ORD-1002': 'PLACED',
    }

    for order_id, target_status in demo_order_state_map.items():
        order = orders_collection.find_one({'order_id': order_id})
        if not order:
            continue

        history_count = order_status_history_collection.count_documents({'order_id': order_id})
        updated_by = order.get('updated_by', '')
        
        if history_count > 1 or (updated_by and updated_by not in ['system-seed', 'seed-backfill', 'system']):
            continue 

        created_at = order.get('created_at') or now_utc()
        orders_collection.update_one(
            {'order_id': order_id},
            {
                '$set': {
                    'status': target_status,
                    'shipment_id': None,
                    'assigned_delivery_partner': None,
                    'assigned_delivery_id': None,
                    'status_timestamps': {target_status: created_at.isoformat() if isinstance(created_at, datetime) else now_utc().isoformat()},
                    'updated_at': now_utc(),
                    'updated_by': 'seed-backfill',
                    'updated_by_role': 'SYSTEM',
                    'updated_by_email': 'system@local',
                }
            },
        )
        order_status_history_collection.delete_many({'order_id': order_id})
        delivery_logs_collection.delete_many({'order_id': order_id})
        append_order_status_history(
            order_id,
            target_status,
            'seed-backfill',
            performer_role='SYSTEM',
            performer_email='system@local',
            location='Seed baseline state',
        )
        append_delivery_log(
            order_id,
            target_status,
            'seed-backfill',
            location='Seed baseline state',
            performer_role='SYSTEM',
            performer_email='system@local',
        )

    shipments_collection.update_many(
        {'shipment_id': {'$in': ['SHIP-1001', 'SHIP-1002']}},
        {
            '$set': {
                'status': 'CREATED',
                'updated_at': now_utc(),
            }
        },
    )
    shipment_items_collection.delete_many({'order_id': {'$in': list(demo_order_state_map.keys())}})


def seed_warehouses() -> None:
    for warehouse in SEED_WAREHOUSES:
        warehouses_collection.update_one(
            {'warehouse_id': warehouse['warehouse_id']},
            {'$set': warehouse, '$setOnInsert': {'created_at': now_utc()}},
            upsert=True,
        )


def backfill_product_warehouses() -> None:
    for warehouse in SEED_WAREHOUSES:
        products_collection.update_one(
            {'id': warehouse['product_id']},
            {
                '$set': {
                    'warehouse': {
                        'warehouse_id': warehouse['warehouse_id'],
                        'pincode': warehouse['pincode'],
                        'city': warehouse['city'],
                        'state': warehouse['state'],
                    }
                }
            },
        )


def backfill_product_merchant_ids() -> None:
    default_merchant_id = get_default_merchant_id()
    if not default_merchant_id:
        return

    products_collection.update_many(
        {
            '$or': [
                {'merchant_id': {'$exists': False}},
                {'merchant_id': None},
                {'merchant_id': ''},
            ]
        },
        {'$set': {'merchant_id': default_merchant_id}},
    )


def get_active_registered_merchant_ids() -> list[str]:
    merchants = users_collection.find(
        {'role': {'$in': ['ADMIN', 'MERCHANT']}, 'status': 'ACTIVE', 'merchant_status': 'APPROVED'},
        {'_id': 0, 'id': 1},
    )
    merchant_ids = []
    for merchant in merchants:
        merchant_id = str(merchant.get('id') or '').strip()
        if merchant_id:
            merchant_ids.append(merchant_id)
    return merchant_ids


def backfill_nationwide_delivery_coverage() -> None:
    admin_accounts = list(users_collection.find({'role': 'ADMIN'}, {'_id': 0, 'id': 1}))
    if not admin_accounts:
        return

    now = now_utc()
    for account in admin_accounts:
        merchant_id = str(account.get('id') or '').strip()
        if not merchant_id:
            continue

        delivery_coverage_collection.update_one(
            {'merchant_id': merchant_id},
            {
                '$set': {
                    'merchant_id': merchant_id,
                    'delivery_scope': 'NATIONWIDE',
                    'states': [],
                    'cities': [],
                    'deliver_all_cities_in_selected_states': False,
                    'updated_at': now,
                },
                '$setOnInsert': {'created_at': now},
            },
            upsert=True,
        )


def seed_demo_merchant_shipping_settings() -> None:
    now = now_utc()
    for merchant_id, settings in SEED_MERCHANT_SHIPPING_SETTINGS.items():
        normalized_merchant_id = str(merchant_id or '').strip()
        if not normalized_merchant_id:
            continue

        # Always overwrite or insert the demo settings on startup to ensure a working default.

        merchant_shipping_settings_collection.update_one(
            {'merchant_id': normalized_merchant_id},
            {
                '$set': {
                    'merchant_id': normalized_merchant_id,
                    'warehouse': settings.get('warehouse') or {},
                    'distance_pricing': settings.get('distance_pricing') or {},
                    'couriers': settings.get('couriers') or {'available_couriers': ['Local', 'Express', 'Premium']},
                    'cod_rules': settings.get('cod_rules') or {'cod_enabled': True, 'cod_limit': 100000, 'cod_extra_charge': 0},
                    'allow_all_india': bool(settings.get('allow_all_india', True)),
                    'updated_at': now,
                },
                '$setOnInsert': {'created_at': now},
            },
            upsert=True,
        )

        serviceable = parse_service_pincodes(settings.get('serviceable_pincodes') or [])
        blocked = parse_service_pincodes(settings.get('blocked_pincodes') or [])

        serviceable_pincodes_collection.delete_many({'merchant_id': normalized_merchant_id})
        blocked_pincodes_collection.delete_many({'merchant_id': normalized_merchant_id})

        if serviceable:
            serviceable_pincodes_collection.insert_many(
                [{'merchant_id': normalized_merchant_id, 'pincode': pin, 'created_at': now} for pin in serviceable]
            )
        if blocked:
            blocked_pincodes_collection.insert_many(
                [{'merchant_id': normalized_merchant_id, 'pincode': pin, 'created_at': now} for pin in blocked]
            )


def backfill_user_auth_shape() -> None:
    projection = {'_id': 1, 'id': 1, 'role': 1, 'status': 1, 'merchant_status': 1, 'full_name': 1, 'name': 1}
    for account in users_collection.find({}, projection):
        role = normalize_role(account.get('role', 'CUSTOMER'))
        users_collection.update_one(
            {'_id': account['_id']},
            {
                '$set': {
                    'id': account.get('id') or f"USR-{uuid4().hex[:10].upper()}",
                    'role': role,
                    'status': normalize_account_status(account.get('status', 'ACTIVE')),
                    'merchant_status': normalize_merchant_status(
                        account.get('merchant_status', 'APPROVED' if role == 'ADMIN' else 'PENDING')
                    ),
                    'name': account.get('name') or account.get('full_name') or 'User',
                    'updated_at': now_utc(),
                }
            },
        )


def seed_collections() -> None:
    seed_platform_defaults()
    seed_demo_merchant_shipping_settings()
    backfill_merchant_statuses()
    backfill_product_merchant_ids()
    backfill_product_review_status()
    backfill_product_warehouses()
    backfill_user_auth_shape()
    backfill_nationwide_delivery_coverage()
    backfill_order_items_and_logs()
    backfill_orders_workflow_state()
    backfill_demo_seed_tracking_state()


PINCODE_DISTANCE_CACHE = {} 


def calculate_distance(pincode1: str, pincode2: str) -> float:
    cache_key = f"{pincode1}:{pincode2}"
    if cache_key in PINCODE_DISTANCE_CACHE:
        return PINCODE_DISTANCE_CACHE[cache_key]
    
    reverse_key = f"{pincode2}:{pincode1}"
    if reverse_key in PINCODE_DISTANCE_CACHE:
        return PINCODE_DISTANCE_CACHE[reverse_key]
    
    prefix1 = int(pincode1[:2]) if len(pincode1) >= 2 else 0
    prefix2 = int(pincode2[:2]) if len(pincode2) >= 2 else 0
    
    distance = abs(prefix1 - prefix2) * 100
    if distance == 0:
        distance = 10 
    
    PINCODE_DISTANCE_CACHE[cache_key] = float(distance)
    return float(distance)


def calculate_delivery_charge(
    distance_km: float,
    order_total: float,
) -> float:
    return 0.0 if order_total >= 500 else 49.0


def estimate_delivery_timeframe(distance_km: float) -> tuple[int, int]:
    if distance_km <= 50:
        return (1, 2) 
    elif distance_km <= 200:
        return (2, 4) 
    else:
        return (4, 7) 


def is_pincode_serviceable(
    customer_pincode: str,
    merchant_id: str,
    allow_all_india: bool = True,
) -> bool:
    customer_pincode = sanitize_pincode(customer_pincode)
    if not customer_pincode:
        return False
    
    if blocked_pincodes_collection.find_one({'merchant_id': merchant_id, 'pincode': customer_pincode}):
        return False
    
    if allow_all_india:
        return True 
    
    return bool(
        serviceable_pincodes_collection.find_one({'merchant_id': merchant_id, 'pincode': customer_pincode})
    )


def get_merchant_shipping_settings(merchant_id: str) -> dict | None:
    return merchant_shipping_settings_collection.find_one(
        {'merchant_id': merchant_id},
        {'_id': 0},
    )


async def auto_dispatch_shipment_after_delay(shipment_id: str, delay_seconds: int = 3) -> None:
    """
    AUTO-DISPATCH: Disabled to allow manual shipping and delivery partner control.
    """
    pass


def start_shipment_simulator() -> None:
    """
    Disabled background automation to allow manual assignment and tracking
    """
    global shipment_simulation_started
    global shipment_simulation_task
    if shipment_simulation_started:
        return
    return


@app.on_event('shutdown')
async def shutdown_shipment_simulator() -> None:
    global shipment_simulation_task
    if shipment_simulation_task:
        shipment_simulation_task.cancel()
        try:
            await shipment_simulation_task
        except asyncio.CancelledError:
            pass
        shipment_simulation_task = None


@app.on_event('startup')
def ensure_database_ready() -> None:
    try:
        mongo_client.admin.command('ping')
        ensure_indexes()
        seed_collections()
        sync_local_upload_images_to_database()
        start_shipment_simulator()
    except (ConfigurationError, PyMongoError) as exc:
        if mongo_enable_fallback:
            activate_in_memory_database(str(exc))
            ensure_indexes()
            seed_collections()
            sync_local_upload_images_to_database()
            start_shipment_simulator()
            return

        troubleshooting_hint = (
            'Check MONGO_URI and network access. If your environment blocks TLS certificate validation '
            'temporarily, set MONGO_TLS_ALLOW_INVALID_CERTS=true in backend/.env and retry. '
            'Or set MONGO_ENABLE_FALLBACK=true to run with in-memory data.'
        )
        raise RuntimeError(f'Unable to connect to MongoDB: {exc}. {troubleshooting_hint}') from exc


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Invalid or expired authentication token.',
    )

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        token_type = str(payload.get('token_type') or 'access').strip().lower()
        if token_type != 'access':
            raise credentials_error
        email = str(payload.get('sub') or '').strip().lower()
        if not email:
            raise credentials_error
    except JWTError as exc:
        raise credentials_error from exc

    account = users_collection.find_one({'email': email})
    if not account:
        raise credentials_error

    account_status = normalize_account_status(account.get('status', 'ACTIVE'))
    if account_status == 'BLOCKED':
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Account is blocked. Please contact support.')

    return account


def get_current_user_optional(request: Request) -> dict | None:
    authorization: str = request.headers.get("Authorization")
    if not authorization:
        return None
    try:
        parts = authorization.split()
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            return None
        token = parts[1]
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        token_type = str(payload.get('token_type') or 'access').strip().lower()
        if token_type != 'access':
            return None
        email = str(payload.get('sub') or '').strip().lower()
        if email:
            return users_collection.find_one({'email': email})
    except Exception:
        pass
    return None


@app.post('/media/upload-image')
async def upload_image(request: Request, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    content_type = str(file.content_type or '').strip().lower()
    if content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Only JPG, PNG, and WEBP images are supported.',
        )

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Uploaded file is empty.')
    if len(payload) > MAX_IMAGE_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail='Image must be 2MB or smaller.')

    extension = ALLOWED_IMAGE_CONTENT_TYPES[content_type]
    file_name = f'{uuid4().hex}.{extension}'
    file_path = os.path.join(UPLOAD_IMAGE_ROOT, file_name)

    with open(file_path, 'wb') as output_file:
        output_file.write(payload)

    _store_uploaded_image(file_name, content_type, payload, current_user.get('email'))

    image_url = f'/uploads/images/{file_name}'
    return {
        'message': 'Image uploaded successfully.',
        'image_url': image_url,
        'file_name': file_name,
        'content_type': content_type,
        'uploaded_by': current_user.get('email'),
    }


@app.post('/auth/refresh')
def refresh_auth_token(payload: RefreshTokenRequest):
    refresh_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid or expired refresh token.')
    try:
        token_payload = jwt.decode(payload.refresh_token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        token_type = str(token_payload.get('token_type') or '').strip().lower()
        if token_type != 'refresh':
            raise refresh_error

        email = str(token_payload.get('sub') or '').strip().lower()
        if not email:
            raise refresh_error
    except JWTError as exc:
        raise refresh_error from exc

    account = users_collection.find_one({'email': email})
    if not account:
        raise refresh_error

    account_status = normalize_account_status(account.get('status', 'ACTIVE'))
    if account_status == 'BLOCKED':
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Account is blocked. Please contact support.')

    role = normalize_role(account.get('role', 'CUSTOMER'))
    return {
        'token': create_access_token(email, role),
        'refresh_token': create_refresh_token(email, role),
        'role': role,
        'status': account_status,
        'user': serialize_user(account),
    }


def require_roles(*roles: str) -> Callable:
    allowed = {normalize_role(role) for role in roles}

    def dependency(current_user: dict = Depends(get_current_user)) -> dict:
        role = normalize_role(current_user.get('role', 'CUSTOMER'))
        if role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Access denied for this role.')
        return current_user

    return dependency


@app.get('/')
def root():
    return {'service': 'Digital Atelier API', 'status': 'ok', 'database_mode': database_mode}


@app.get('/products')
def get_products():
    active_merchant_ids = get_active_registered_merchant_ids()
    query = {'review_status': 'APPROVED'}
    if active_merchant_ids:
        query['merchant_id'] = {'$in': active_merchant_ids}
    else:
        default_id = get_default_merchant_id()
        if default_id:
            query['merchant_id'] = default_id
    products = list(
        products_collection.find(
            query,
            {'_id': 0},
        )
    )
    return [serialize_product(product) for product in products]


@app.get('/product/{product_id}')
def get_product(product_id: int):
    active_merchant_ids = get_active_registered_merchant_ids()
    query = {'id': product_id, 'review_status': 'APPROVED'}
    if active_merchant_ids:
        query['merchant_id'] = {'$in': active_merchant_ids}
    else:
        default_id = get_default_merchant_id()
        if default_id:
            query['merchant_id'] = default_id
    product = products_collection.find_one(
        query,
        {'_id': 0},
    )
    if not product:
        return {'error': 'Product not found'}
    return serialize_product(product)


@app.get('/products/{product_id}/related')
def get_related_products(product_id: int):
    return get_related_products_for_product(product_id)


@app.get('/products/{product_id}/recommended')
def get_recommended_products(
    product_id: int,
    cart_ids: str | None = None,
    wishlist_ids: str | None = None,
    viewed_ids: str | None = None,
):
    return get_recommended_products_for_product(
        product_id,
        cart_ids=parse_id_list(cart_ids),
        wishlist_ids=parse_id_list(wishlist_ids),
        viewed_ids=parse_id_list(viewed_ids),
    )


@app.get('/products/frequently-bought')
def get_frequently_bought(product_id: int):
    return get_frequently_bought_bundle_for_product(product_id)


@app.get('/products/recently-viewed')
def get_recently_viewed(ids: str | None = None):
    return get_recently_viewed_products(parse_id_list(ids))


# ============================================================================
# PRODUCT REVIEWS ENDPOINTS
# ============================================================================

@app.post('/products/{product_id}/reviews')
def create_product_review(
    product_id: int,
    payload: ProductReviewRequest,
    current_user: dict = Depends(require_roles('CUSTOMER'))
):
    if not (1 <= payload.rating <= 5):
        raise HTTPException(status_code=400, detail='Rating must be between 1 and 5 stars')

    product = products_collection.find_one({'id': product_id})
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    customer_email = str(current_user.get('email') or '').strip().lower()
    customer_id = str(current_user.get('id') or '').strip()

    order = orders_collection.find_one({
        'order_id': payload.order_id,
        '$or': [
            {'customer_email': customer_email},
            {'user_id': customer_id},
            {'user_id': customer_email},
        ]
    })
    if not order:
        raise HTTPException(status_code=404, detail='Order not found or does not belong to you')

    order_delivered = normalize_order_status(order.get('status', '')) == 'DELIVERED'
    if not order_delivered and order.get('shipment_id'):
        shipment = shipments_collection.find_one({'shipment_id': order['shipment_id']})
        if shipment and normalize_shipment_status(shipment.get('status', '')) == 'DELIVERED':
            order_delivered = True
    if not order_delivered:
        raise HTTPException(status_code=400, detail='You can only review products from delivered orders')

    order_item_candidates = list(order_items_collection.find({'order_id': payload.order_id}, {'_id': 0}))
    order_item_candidates.extend(list(order.get('items', []) or []))

    product_in_order = False
    for item in order_item_candidates:
        item_product_id = (
            item.get('product_id') or
            item.get('id') or
            (item.get('product') if isinstance(item.get('product'), dict) else {}).get('id') or
            (item.get('product') if isinstance(item.get('product'), dict) else {}).get('product_id')
        )
        if item_product_id is None:
            continue
        try:
            if int(item_product_id) == int(product_id):
                product_in_order = True
                break
        except (ValueError, TypeError):
            if str(item_product_id).strip() == str(product_id).strip():
                product_in_order = True
                break

    if not product_in_order:
        raise HTTPException(status_code=400, detail='You can only review products you have purchased')

    existing_review = product_reviews_collection.find_one({
        'product_id': product_id,
        'order_id': payload.order_id,
        'customer_email': customer_email,
    })
    if existing_review:
        raise HTTPException(status_code=400, detail='You have already reviewed this product for this order.')

    review_id = str(uuid4())
    review_document = {
        'review_id': review_id,
        'product_id': product_id,
        'order_id': payload.order_id,
        'customer_email': customer_email,
        'customer_name': current_user.get('full_name') or current_user.get('name') or 'Customer',
        'customer_id': customer_id or current_user.get('id'),
        'rating': payload.rating,
        'review_text': (payload.review_text or '').strip(),
        'status': 'APPROVED',
        'helpful_count': 0,
        'created_at': now_utc().isoformat(),
        'updated_at': now_utc().isoformat(),
    }

    product_reviews_collection.insert_one(review_document)
    update_product_rating(product_id)

    return {
        'message': 'Review submitted successfully',
        'review_id': review_id,
    }


@app.get('/admin/product-feedback')
def get_admin_product_feedback(limit: int = 50, current_user: dict = Depends(require_roles('ADMIN'))):
    _ = current_user
    limit = max(1, min(int(limit or 50), 200))
    reviews = list(
        product_reviews_collection.find({'status': 'APPROVED'}, {'_id': 0})
        .sort('created_at', -1)
        .limit(limit)
    )

    product_ids = sorted({int(review.get('product_id') or 0) for review in reviews if int(review.get('product_id') or 0)})
    product_map = {
        int(product.get('id') or 0): product
        for product in products_collection.find({'id': {'$in': product_ids}}, {'_id': 0, 'id': 1, 'name': 1, 'section': 1, 'category': 1, 'image': 1, 'rating': 1, 'review_count': 1})
    }

    enriched_reviews = []
    for review in reviews:
        product = product_map.get(int(review.get('product_id') or 0), {})
        enriched_reviews.append({
            **review,
            'product_name': product.get('name') or '',
            'product_section': product.get('section') or '',
            'product_category': product.get('category') or '',
            'product_image': product.get('image') or '',
            'product_rating': float(product.get('rating') or 0),
            'product_review_count': int(product.get('review_count') or 0),
        })

    total_reviews = product_reviews_collection.count_documents({'status': 'APPROVED'})
    average_rating = sum(float(review.get('rating') or 0) for review in product_reviews_collection.find({'status': 'APPROVED'}, {'rating': 1})) / total_reviews if total_reviews else 0

    return {
        'reviews': enriched_reviews,
        'total_reviews': total_reviews,
        'average_rating': round(average_rating, 1),
    }


@app.get('/admin/delivery-ratings')
def get_admin_delivery_ratings(limit: int = 50, current_user: dict = Depends(require_roles('ADMIN'))):
    _ = current_user
    limit = max(1, min(int(limit or 50), 200))
    ratings = list(
        delivery_ratings_collection.find({}, {'_id': 0})
        .sort('created_at', -1)
        .limit(limit)
    )
    total_ratings = delivery_ratings_collection.count_documents({})
    average_rating = sum(float(item.get('rating') or 0) for item in delivery_ratings_collection.find({}, {'rating': 1})) / total_ratings if total_ratings else 0
    return {
        'ratings': ratings,
        'total_ratings': total_ratings,
        'average_rating': round(average_rating, 1),
    }


@app.get('/delivery/ratings')
def get_delivery_partner_ratings(limit: int = 50, current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE'))):
    limit = max(1, min(int(limit or 50), 200))
    email = str(current_user.get('email') or '').strip().lower()
    user_id = str(current_user.get('id') or '').strip()
    clauses = []
    if email:
        clauses.append({'delivery_partner_email': email})
    if user_id:
        clauses.append({'delivery_partner_id': user_id})
    query = {'$or': clauses} if clauses else {'delivery_partner_email': '__none__'}
    ratings = list(
        delivery_ratings_collection.find(query, {'_id': 0})
        .sort('created_at', -1)
        .limit(limit)
    )
    total_ratings = delivery_ratings_collection.count_documents(query)
    average_rating = sum(float(item.get('rating') or 0) for item in delivery_ratings_collection.find(query, {'rating': 1})) / total_ratings if total_ratings else 0
    return {
        'ratings': ratings,
        'total_ratings': total_ratings,
        'average_rating': round(average_rating, 1),
    }


@app.get('/products/{product_id}/reviews/mine')
def get_my_product_review(product_id: int, order_id: str = '', current_user: dict = Depends(require_roles('CUSTOMER'))):
    """Get the current user's review for a product+order, if one exists."""
    customer_email = str(current_user.get('email') or '').strip().lower()
    query = {'product_id': product_id, 'customer_email': customer_email}
    if order_id:
        query['order_id'] = order_id
    review = product_reviews_collection.find_one(query, {'_id': 0})
    if not review:
        return {'rating': None, 'review_text': None}
    return {'rating': review.get('rating'), 'review_text': review.get('review_text') or ''}


@app.get('/products/{product_id}/reviews')
def get_product_reviews(product_id: int, limit: int = 20, offset: int = 0):
    """Get all reviews for a product"""
    reviews = list(
        product_reviews_collection.find(
            {'product_id': product_id, 'status': 'APPROVED'},
            {'_id': 0}
        )
        .sort('created_at', -1)
        .skip(offset)
        .limit(limit)
    )
    
    all_reviews = list(product_reviews_collection.find(
        {'product_id': product_id, 'status': 'APPROVED'},
        {'rating': 1}
    ))
    
    total_reviews = len(all_reviews)
    average_rating = sum(r['rating'] for r in all_reviews) / total_reviews if total_reviews > 0 else 0
    
    rating_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for review in all_reviews:
        rating_counts[review['rating']] = rating_counts.get(review['rating'], 0) + 1
    
    return {
        'reviews': reviews,
        'total_reviews': total_reviews,
        'average_rating': round(average_rating, 1),
        'rating_distribution': rating_counts,
    }


# ============================================================================
# DELIVERY RATING ENDPOINTS
# ============================================================================

@app.post('/orders/{order_id}/delivery-rating')
def create_delivery_rating(
    order_id: str,
    payload: DeliveryRatingRequest,
    current_user: dict = Depends(require_roles('CUSTOMER'))
):
    """Submit a rating for how the delivery itself went, for a delivered order."""
    if not (1 <= payload.rating <= 5):
        raise HTTPException(status_code=400, detail='Rating must be between 1 and 5 stars')

    order = orders_collection.find_one({
        'order_id': order_id,
        '$or': [
            {'customer_email': current_user['email']},
            {'user_id': current_user.get('id')},
            {'user_id': current_user['email']}
        ]
    })

    if not order:
        raise HTTPException(status_code=404, detail='Order not found or does not belong to you')

    order_delivered = normalize_order_status(order.get('status', '')) == 'DELIVERED'
    if not order_delivered and order.get('shipment_id'):
        shipment = shipments_collection.find_one({'shipment_id': order['shipment_id']})
        if shipment and normalize_shipment_status(shipment.get('status', '')) == 'DELIVERED':
            order_delivered = True
    if not order_delivered:
        raise HTTPException(status_code=400, detail='You can only rate delivery for delivered orders')

    existing_rating = delivery_ratings_collection.find_one({
        'order_id': order_id,
        'customer_email': current_user['email'],
    })

    feedback_text = (payload.feedback or '').strip()

    if existing_rating:
        delivery_ratings_collection.update_one(
            {'_id': existing_rating['_id']},
            {
                '$set': {
                    'rating': payload.rating,
                    'feedback': feedback_text,
                    'updated_at': now_utc().isoformat(),
                }
            }
        )
        return {'message': 'Delivery rating updated successfully', 'rating': payload.rating, 'feedback': feedback_text}

    rating_document = {
        'rating_id': str(uuid4()),
        'order_id': order_id,
        'customer_email': current_user['email'],
        'customer_id': current_user.get('id'),
        'delivery_partner_email': order.get('assigned_delivery_partner'),
        'rating': payload.rating,
        'feedback': feedback_text,
        'created_at': now_utc().isoformat(),
        'updated_at': now_utc().isoformat(),
    }

    delivery_ratings_collection.insert_one(rating_document)

    return {
        'message': 'Delivery rating submitted successfully',
        'rating': payload.rating,
        'feedback': feedback_text,
    }


@app.get('/orders/{order_id}/delivery-rating')
def get_delivery_rating(
    order_id: str,
    current_user: dict = Depends(require_roles('CUSTOMER'))
):
    """Get the current user's delivery rating for an order, if one exists."""
    rating = delivery_ratings_collection.find_one(
        {'order_id': order_id, 'customer_email': current_user['email']},
        {'_id': 0},
    )
    if not rating:
        return {'rating': None, 'feedback': None}
    return {'rating': rating.get('rating'), 'feedback': rating.get('feedback') or ''}


@app.post('/orders/{order_id}/return')
def create_order_return(
    order_id: str,
    payload: ReturnOrderRequest,
    current_user: dict = Depends(get_current_user)
):
    """Submit a return request for a delivered order."""
    order = orders_collection.find_one({
        '$or': [{'order_id': order_id}, {'id': order_id}]
    })

    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    order_status = normalize_order_status(order.get('status', ''))
    if order_status != 'DELIVERED' and order.get('shipment_id'):
        shipment = shipments_collection.find_one({'shipment_id': order['shipment_id']})
        if shipment and normalize_shipment_status(shipment.get('status', '')) == 'DELIVERED':
            order_status = 'DELIVERED'

    if order_status != 'DELIVERED':
        raise HTTPException(status_code=400, detail='Return requests can only be submitted for delivered orders.')

    target_order_id = order.get('order_id') or order.get('id') or order_id
    existing_return = returns_collection.find_one({'order_id': target_order_id})

    reason_str = (payload.reason or '').strip() or 'Defective / Damaged Item'
    issue_str = (payload.issue_details or '').strip()
    proof_imgs = payload.proof_images or []

    return_payload = {
        'id': (existing_return or {}).get('id') or f"RET-{uuid4().hex[:10].upper()}",
        'order_id': target_order_id,
        'user_id': current_user.get('id') or current_user.get('email'),
        'user_email': current_user.get('email', 'customer@local'),
        'reason': reason_str,
        'issue_details': issue_str,
        'proof_images': proof_imgs,
        'status': 'RETURN_REQUESTED',
        'created_at': (existing_return or {}).get('created_at') or now_utc().isoformat(),
        'updated_at': now_utc().isoformat(),
        'order': serialize_order(order),
    }

    returns_collection.update_one(
        {'order_id': target_order_id},
        {'$set': return_payload},
        upsert=True
    )

    orders_collection.update_one(
        {'$or': [{'order_id': target_order_id}, {'id': target_order_id}]},
        {'$set': {'status': 'RETURN_REQUESTED', 'updated_at': now_utc()}}
    )

    return {
        'message': 'Return request submitted successfully.',
        'return_request': return_payload
    }


@app.get('/orders/{order_id}/return')
def get_order_return(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get the return request status for an order if one exists."""
    return_req = returns_collection.find_one({'order_id': order_id}, {'_id': 0})
    if not return_req:
        return {'return_request': None}
    if isinstance(return_req.get('created_at'), datetime):
        return_req['created_at'] = return_req['created_at'].isoformat()
    if isinstance(return_req.get('updated_at'), datetime):
        return_req['updated_at'] = return_req['updated_at'].isoformat()
    return {'return_request': return_req}


@app.get('/admin/returns')
def get_admin_returns(
    status_filter: str | None = None,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF'))
):
    """Get list of return requests for admin/ops review."""
    query = {}
    if status_filter and status_filter != 'ALL':
        query['status'] = status_filter
    ret_list = list(returns_collection.find(query).sort('created_at', -1))
    result = []
    for r in ret_list:
        r_dict = dict(r)
        r_dict.pop('_id', None)
        if isinstance(r_dict.get('created_at'), datetime):
            r_dict['created_at'] = r_dict['created_at'].isoformat()
        if isinstance(r_dict.get('updated_at'), datetime):
            r_dict['updated_at'] = r_dict['updated_at'].isoformat()
        if not r_dict.get('order'):
            ord_doc = orders_collection.find_one({'order_id': r_dict.get('order_id')})
            if ord_doc:
                r_dict['order'] = serialize_order(ord_doc)
        result.append(r_dict)
    return {'returns': result}


@app.put('/admin/returns/{order_id}/decision')
def update_return_decision(
    order_id: str,
    payload: ReturnDecisionRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF'))
):
    ret_item = returns_collection.find_one({'order_id': order_id})
    if not ret_item:
        raise HTTPException(status_code=404, detail='Return request not found.')
    new_status = 'RETURN_APPROVED' if payload.decision.upper() == 'APPROVE' else 'RETURN_REJECTED'
    returns_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'status': new_status,
                'review_note': payload.review_note or '',
                'updated_at': now_utc().isoformat()
            }
        }
    )
    orders_collection.update_one(
        {'$or': [{'order_id': order_id}, {'id': order_id}]},
        {'$set': {'status': new_status, 'updated_at': now_utc()}}
    )
    return {'message': f"Return request {payload.decision.lower()}d successfully."}



def update_product_rating(product_id: int):
    """Update product's average rating and review count"""
    reviews = list(product_reviews_collection.find(
        {'product_id': product_id, 'status': 'APPROVED'},
        {'rating': 1}
    ))
    
    if not reviews:
        return
    
    total_reviews = len(reviews)
    average_rating = sum(r['rating'] for r in reviews) / total_reviews
    
    products_collection.update_one(
        {'id': product_id},
        {
            '$set': {
                'rating': round(average_rating, 1),
                'review_count': total_reviews,
                'updated_at': now_utc(),
            }
        }
    )


@app.get('/recommendations/{customer_id}')
def get_recommendations_for_customer(customer_id: str, limit: int = 15):
    user = find_user_by_id_or_email(customer_id) or {}
    purchased_ids = []
    try:
        email = str(user.get('email') or '').strip()
        query = {'$or': []}
        if email:
            query['$or'].append({'customer_email': email})
        query['$or'].append({'customer_id': str(user.get('id') or '')})
        if not any(query['$or']):
            query = {}

        orders = list(orders_collection.find(query, {'_id': 0})) if query else []
        orders = sorted(orders, key=lambda o: o.get('created_at') or o.get('updated_at') or now_utc(), reverse=True)
        for o in orders:
            for it in o.get('items', []):
                pid = int(it.get('product_id') or it.get('id') or 0)
                if pid and pid not in purchased_ids:
                    purchased_ids.append(pid)
    except Exception:
        purchased_ids = []

    catalog = get_approved_product_catalog()
    blocked = set(purchased_ids)

    source_products = [get_catalog_product_by_id(pid) for pid in (purchased_ids[:4] or [])]
    source_products = [p for p in source_products if p]

    scored: list[tuple[float, dict]] = []
    trending_ids = {int(p.get('id') or 0) for p in get_trending_products(limit=50)}

    copurchase_counts: dict[int, int] = {}
    try:
        all_orders = list(orders_collection.find({}, {'_id': 0, 'items': 1}))
        for o in all_orders:
            ids = [int(it.get('product_id') or it.get('id') or 0) for it in o.get('items', []) if int(it.get('product_id') or it.get('id') or 0) > 0]
            for a in ids:
                for b in ids:
                    if a == b: continue
                    copurchase_counts.setdefault((a, b), 0)
                    copurchase_counts[(a, b)] += 1
    except Exception:
        copurchase_counts = {}

    for candidate in catalog:
        cid = int(candidate.get('id') or 0)
        if cid in blocked:
            continue
        base = rank_candidate_for_recommendation(source_products, candidate)

        boost = 0.0
        for sp in source_products:
            if not sp: continue
            try:
                if normalize_product_text(sp.get('category')) and normalize_product_text(sp.get('category')) == normalize_product_text(candidate.get('category')):
                    boost += 5
                if normalize_product_text(sp.get('section')) and normalize_product_text(sp.get('section')) == normalize_product_text(candidate.get('section')):
                    boost += 4
                overlap = tokenize_product(sp) & tokenize_product(candidate)
                if overlap:
                    boost += min(len(overlap), 3) * 3
                try:
                    sp_price = float(sp.get('price') or 0)
                    c_price = float(candidate.get('price') or 0)
                    if sp_price > 0 and c_price > 0 and abs(sp_price - c_price) / max(sp_price, c_price) <= 0.18:
                        boost += 2
                except Exception:
                    pass
                if copurchase_counts.get((int(sp.get('id') or 0), cid), 0) > 0:
                    boost += 2
            except Exception:
                continue

        if cid in trending_ids:
            boost += 1

        final_score = base + boost
        scored.append((final_score, candidate))

    scored.sort(key=lambda item: (item[0], -int(item[1].get('id') or 0)), reverse=True)
    recommended = [build_discovery_card(candidate, score=score, rank=i) for i, (score, candidate) in enumerate(scored[:limit])]

    result = []
    for p in recommended:
        pid = int(p.get('id') or 0)
        badge = ''
        prod = get_catalog_product_by_id(pid) or {}
        stock_qty = int(prod.get('stock_quantity') or prod.get('stock') or 0)
        sales_count = int(sum((int(it.get('quantity') or 0) for o in orders_collection.find({'items.product_id': pid}) for it in o.get('items', []) if int(it.get('product_id') or 0) == pid)))
        if stock_qty > 0 and stock_qty < 10:
            badge = 'LOW STOCK'
        elif sales_count > 20:
            badge = 'BESTSELLER'
        elif prod.get('created_at') and isinstance(prod.get('created_at'), datetime) and (now_utc() - prod.get('created_at')).days <= 30:
            badge = 'NEW ARRIVAL'
        elif pid in trending_ids:
            badge = 'TRENDING'
        elif int(p.get('discount_percent') or 0) > 20:
            badge = 'LIMITED DEAL'

        result.append({
            'id': pid,
            'title': p.get('title') or p.get('name'),
            'image': p.get('image'),
            'price': float(p.get('price') or 0),
            'rating': float(p.get('rating') or 0),
            'badge': badge,
            'category': p.get('category') or '',
            'stock': stock_qty,
        })

    return result


@app.get('/merchant/products')
def get_merchant_products(current_user: dict = Depends(require_roles('ADMIN'))):
    products = list(
        products_collection.find(
            {},
            {'_id': 0},
        ).sort('updated_at', -1),
    )
    return [serialize_product(product) for product in products]


@app.post('/merchant/products')
def create_merchant_product(payload: MerchantProductRequest, current_user: dict = Depends(require_roles('ADMIN'))):
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        raise HTTPException(status_code=400, detail='Merchant account is missing an id.')

    if not str(payload.name).strip():
        raise HTTPException(status_code=400, detail='Product name is required.')
    if not str(payload.category).strip():
        raise HTTPException(status_code=400, detail='Category is required.')
    if not str(payload.image).strip():
        raise HTTPException(status_code=400, detail='Image URL is required.')
    if not str(payload.description).strip():
        raise HTTPException(status_code=400, detail='Description is required.')
    if float(payload.price) < 0:
        raise HTTPException(status_code=400, detail='Price must be zero or higher.')

    product = build_merchant_product_payload(payload)
    product['id'] = get_next_product_id()
    product['merchant_id'] = merchant_id
    product['review_status'] = 'APPROVED'
    product['created_at'] = now_utc()
    product['updated_at'] = now_utc()

    products_collection.insert_one(product)
    return {'message': 'Product created successfully.', 'product': serialize_product(product)}


@app.put('/merchant/products/{product_id}')
def update_merchant_product(
    product_id: int,
    payload: MerchantProductRequest,
    current_user: dict = Depends(require_roles('ADMIN')),
):
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        raise HTTPException(status_code=400, detail='Merchant account is missing an id.')

    existing_product = products_collection.find_one({'id': product_id}, {'_id': 0})
    if not existing_product:
        raise HTTPException(status_code=404, detail='Product not found.')

    if not str(payload.name).strip():
        raise HTTPException(status_code=400, detail='Product name is required.')
    if not str(payload.category).strip():
        raise HTTPException(status_code=400, detail='Category is required.')
    if not str(payload.image).strip():
        raise HTTPException(status_code=400, detail='Image URL is required.')
    if not str(payload.description).strip():
        raise HTTPException(status_code=400, detail='Description is required.')
    if float(payload.price) < 0:
        raise HTTPException(status_code=400, detail='Price must be zero or higher.')

    product = build_merchant_product_payload(payload, existing_product)
    product['merchant_id'] = existing_product.get('merchant_id') or merchant_id
    product['updated_at'] = now_utc()
    products_collection.update_one(
        {'id': product_id},
        {'$set': product},
    )

    new_stock = int(product.get('stock') if product.get('stock') is not None else product.get('stock_quantity') or 0)
    warehouses_collection.update_many(
        {'product_id': product_id},
        {'$set': {'stock': new_stock, 'updated_at': now_utc()}}
    )

    updated = products_collection.find_one({'id': product_id}, {'_id': 0})
    return {'message': 'Product updated successfully.', 'product': serialize_product(updated)}


class StockUpdateRequest(BaseModel):
    stock_quantity: int


@app.put('/admin/products/{product_id}/stock')
def admin_update_product_stock(
    product_id: int,
    payload: StockUpdateRequest,
    current_user: dict = Depends(require_roles('ADMIN')),
):
    existing = products_collection.find_one({'id': product_id}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='Product not found.')

    old_stock_qty = int(existing.get('stock_quantity') if existing.get('stock_quantity') is not None else existing.get('stock') or 0)
    old_reserved = int(existing.get('reserved_stock') or 0)
    old_available = max(0, old_stock_qty - old_reserved)

    new_stock_qty = int(payload.stock_quantity)
    products_collection.update_one({'id': product_id}, {'$set': {'stock_quantity': new_stock_qty, 'updated_at': now_utc()}})

    warehouses_collection.update_many(
        {'product_id': product_id},
        {'$set': {'stock': new_stock_qty, 'updated_at': now_utc()}}
    )

    new_available = max(0, new_stock_qty - old_reserved)

    if old_available <= 0 and new_available > 0:
        wishers = list(wishlists_collection.find({'product_id': product_id}, {'_id': 0}))
        product_name = existing.get('name') or f'Product {product_id}'
        for w in wishers:
            user_id = str(w.get('user_id') or '')
            if not user_id:
                continue
            create_notification(
                event_type='PRODUCT_RESTOCK',
                order_id='',
                message=f'{product_name} is back in stock. Grab it while it lasts!',
                user_id=user_id,
                title='Product Back In Stock',
            )

    updated = products_collection.find_one({'id': product_id}, {'_id': 0})
    return {'message': 'Stock updated.', 'product': serialize_product(updated)}


@app.post('/wishlist')
def add_to_wishlist(payload: WishlistRequest, current_user: dict = Depends(require_roles('CUSTOMER'))):
    user_id = str(current_user.get('id') or '').strip()
    user_email = str(current_user.get('email') or '').strip().lower()
    product = products_collection.find_one({'id': payload.product_id}, {'_id': 0})
    if not product:
        raise HTTPException(status_code=404, detail='Product not found.')

    owner = user_id or user_email
    existing = wishlists_collection.find_one({'user_id': owner, 'product_id': payload.product_id})
    if existing:
        return {'message': 'Already in wishlist.'}

    entry = {
        'id': f"WIS-{uuid4().hex[:12].upper()}",
        'user_id': owner,
        'product_id': payload.product_id,
        'created_at': now_utc().isoformat(),
    }
    wishlists_collection.insert_one(entry)
    return {'message': 'Added to wishlist.', 'wishlist': entry}


@app.get('/wishlist/my')
def get_my_wishlist(current_user: dict = Depends(require_roles('CUSTOMER'))):
    user_id = str(current_user.get('id') or '').strip()
    user_email = str(current_user.get('email') or '').strip().lower()
    owner = user_id or user_email
    entries = list(wishlists_collection.find({'user_id': owner}, {'_id': 0}).sort('created_at', -1))
    for e in entries:
        prod = products_collection.find_one({'id': e.get('product_id')}, {'_id': 0})
        e['product'] = serialize_product(prod) if prod else None
    return {'wishlist': entries}


@app.delete('/wishlist/{product_id}')
def remove_from_wishlist(product_id: int, current_user: dict = Depends(require_roles('CUSTOMER'))):
    user_id = str(current_user.get('id') or '').strip()
    user_email = str(current_user.get('email') or '').strip().lower()
    owner = user_id or user_email
    result = wishlists_collection.delete_many({'user_id': owner, 'product_id': product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail='Wishlist entry not found.')
    return {'message': 'Removed from wishlist.'}


@app.delete('/merchant/products/{product_id}')
def delete_merchant_product(product_id: int, current_user: dict = Depends(require_roles('ADMIN'))):
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        raise HTTPException(status_code=400, detail='Merchant account is missing an id.')

    result = products_collection.delete_one({'id': product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail='Product not found.')

    warehouses_collection.delete_many({'product_id': product_id})
    return {'message': 'Product deleted successfully.'}


@app.post('/auth/login')
@app.post('/login')
def login(payload: AuthLoginRequest):
    email = payload.email.strip().lower()
    account = users_collection.find_one({'email': email})

    if not account:
        raise HTTPException(status_code=404, detail='Account not found. Please sign up first.')

    if account.get('provider') == 'google':
        raise HTTPException(status_code=400, detail='This account uses Google sign-in. Please continue with Google.')

    password_hash = account.get('password_hash')
    legacy_password = account.get('password', '')

    valid_password = False
    if password_hash:
        valid_password = verify_password(payload.password, password_hash)
    elif legacy_password:
        valid_password = payload.password == legacy_password
        if valid_password:
            users_collection.update_one(
                {'email': email},
                {
                    '$set': {'password_hash': hash_password(payload.password), 'updated_at': now_utc()},
                    '$unset': {'password': ''},
                },
            )

    if not valid_password:
        raise HTTPException(status_code=401, detail='Invalid email or password.')

    account_status = normalize_account_status(account.get('status', 'ACTIVE'))
    role = normalize_role(account.get('role', 'CUSTOMER'))

    if account_status == 'PENDING':
        account_status = 'ACTIVE'
        users_collection.update_one(
            {'email': email},
            {'$set': {'status': 'ACTIVE', 'updated_at': now_utc()}},
        )
        account = users_collection.find_one({'email': email}) or account

    if account_status == 'BLOCKED':
        raise HTTPException(status_code=403, detail='Account is blocked. Please contact support.')

    if role in {'ADMIN', 'MERCHANT'}:
        users_collection.update_one(
            {'email': email},
            {'$set': {'merchant_status': 'APPROVED', 'updated_at': now_utc()}},
        )

    token = create_access_token(email, role)
    refresh_token = create_refresh_token(email, role)

    return {
        'message': f"Welcome back, {account['full_name']}!",
        'role': role,
        'status': account_status,
        'token': token,
        'refresh_token': refresh_token,
        'user': serialize_user(account),
    }


@app.get('/auth/me')
def auth_me(current_user: dict = Depends(get_current_user)):
    return {
        'user': serialize_user(current_user),
        'role': normalize_role(current_user.get('role', 'CUSTOMER')),
        'status': normalize_account_status(current_user.get('status', 'ACTIVE')),
    }


@app.post('/signup')
def signup(payload: SignupRequest):
    email = payload.email.strip().lower()

    if users_collection.find_one({'email': email}):
        raise HTTPException(status_code=409, detail='Account already exists. Please login.')

    requested_role = str(payload.role or '').strip().upper()
    if requested_role in {'SUPER_ADMIN', 'SUPERADMIN', 'SUPER-ADMIN'}:
        raise HTTPException(status_code=403, detail='Super admin registration is disabled. Create this account manually in database.')

    normalized_role = normalize_role(payload.role)
    account_status = 'ACTIVE'
    merchant_status = 'APPROVED' if normalized_role == 'ADMIN' else 'PENDING'

    profile_details = payload.profile_details or {}
    if normalized_role in {'DELIVERY_ASSOCIATE', 'OPERATIONS_STAFF'}:
        cleaned_phone = sanitize_phone_number(payload.phone_number or profile_details.get('phone_number') or '')
        if len(cleaned_phone) != 10:
            raise HTTPException(status_code=400, detail='Phone number must be exactly 10 digits.')
        profile_details['phone_number'] = cleaned_phone

    if normalized_role == 'DELIVERY_ASSOCIATE':
        cleaned_primary_pincode = sanitize_pincode(payload.pincode or profile_details.get('service_pincode') or '')
        if not is_valid_indian_pincode(cleaned_primary_pincode):
            raise HTTPException(status_code=400, detail='Service pincode must be a valid 6-digit pincode.')

        aadhaar_number = ''.join(ch for ch in str(profile_details.get('aadhaar_number') or '').strip() if ch.isdigit())
        if len(aadhaar_number) != 12:
            raise HTTPException(status_code=400, detail='Aadhaar number must be exactly 12 digits.')

        vehicle_type = str(profile_details.get('vehicle_type') or '').strip().upper()
        if vehicle_type not in {'BIKE', 'CYCLE', 'VAN'}:
            raise HTTPException(status_code=400, detail='Vehicle type must be Bike, Cycle, or Van.')

        vehicle_number = str(profile_details.get('vehicle_number') or '').strip().upper()
        if not vehicle_number:
            raise HTTPException(status_code=400, detail='Vehicle number is required.')

        driving_license_number = str(profile_details.get('driving_license_number') or '').strip().upper()
        if not driving_license_number:
            raise HTTPException(status_code=400, detail='Driving license number is required.')

        availability = str(profile_details.get('availability') or '').strip().upper().replace('-', '_')
        if availability not in {'FULL_TIME', 'PART_TIME'}:
            raise HTTPException(status_code=400, detail='Availability must be Full-time or Part-time.')

        service_pincodes = parse_service_pincodes(profile_details.get('service_pincodes') or cleaned_primary_pincode)
        if not service_pincodes:
            raise HTTPException(status_code=400, detail='At least one service pincode is required.')
        for service_pincode in service_pincodes:
            if not is_valid_indian_pincode(service_pincode):
                raise HTTPException(status_code=400, detail='Each service pincode must be a valid 6-digit pincode.')

        id_proof_upload = profile_details.get('id_proof_upload') or {}
        id_proof_filename = str(id_proof_upload.get('name') or profile_details.get('id_proof_filename') or '').strip()
        if not id_proof_filename:
            raise HTTPException(status_code=400, detail='ID proof upload is required.')

        profile_details['aadhaar_number'] = aadhaar_number
        profile_details['vehicle_type'] = vehicle_type
        profile_details['vehicle_number'] = vehicle_number
        profile_details['driving_license_number'] = driving_license_number
        profile_details['availability'] = availability
        profile_details['service_pincode'] = cleaned_primary_pincode
        profile_details['service_pincodes'] = service_pincodes
        profile_details['id_proof_upload'] = {
            'name': id_proof_filename,
            'type': str(id_proof_upload.get('type') or '').strip(),
            'size': int(id_proof_upload.get('size') or 0),
        }
        is_demo_partner_signup = email == DEMO_DELIVERY_PARTNER_EMAIL
        profile_details = normalize_delivery_partner_profile_for_scope(profile_details, is_demo_partner_signup)

    if payload.phone_number:
        profile_details['phone_number'] = sanitize_phone_number(payload.phone_number)
    if payload.city:
        profile_details['city'] = payload.city.strip()
    if payload.state:
        profile_details['state'] = payload.state.strip()
    if payload.pincode:
        profile_details['pincode'] = sanitize_pincode(payload.pincode)

    account = {
        'id': f"USR-{uuid4().hex[:10].upper()}",
        'name': payload.full_name.strip() or 'New User',
        'full_name': payload.full_name.strip() or 'New User',
        'email': email,
        'password_hash': hash_password(payload.password),
        'provider': 'email',
        'role': normalized_role,
        'status': account_status,
        'merchant_status': merchant_status,
        'profile_details': profile_details,
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    users_collection.insert_one(account)

    token = create_access_token(email, normalized_role)
    refresh_token = create_refresh_token(email, normalized_role)

    return {
        'message': f"Account created for {account['full_name']}.",
        'role': account['role'],
        'status': account_status,
        'token': token,
        'refresh_token': refresh_token,
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
            'id': f"USR-{uuid4().hex[:10].upper()}",
            'name': display_name,
            'full_name': display_name,
            'email': email,
            'password_hash': '',
            'provider': 'google',
            'role': 'CUSTOMER',
            'status': 'ACTIVE',
            'created_at': now_utc(),
            'updated_at': now_utc(),
        }
        users_collection.insert_one(account)

    role = normalize_role(account.get('role', 'CUSTOMER'))
    token = create_access_token(email, role)
    refresh_token = create_refresh_token(email, role)
    return {
        'message': f"Signed in with Google as {account['full_name']}.",
        'role': role,
        'status': normalize_account_status(account.get('status', 'ACTIVE')),
        'token': token,
        'refresh_token': refresh_token,
        'user': serialize_user(account),
    }


@app.put('/api/user/profile')
def update_user_profile(
    payload: UserAddressUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update user profile and shipping address."""
    user_id = current_user.get('id')
    email = current_user.get('email', '').strip().lower()

    user = users_collection.find_one({'$or': [{'id': user_id}, {'email': email}]})
    if not user:
        raise HTTPException(status_code=404, detail='User not found.')

    address_data = payload.dict()

    users_collection.update_one(
        {'_id': user['_id']},
        {
            '$set': {
                'address': address_data,
                'updated_at': now_utc(),
            }
        },
    )

    updated_user = users_collection.find_one({'_id': user['_id']})
    return {
        'message': 'Profile address updated successfully.',
        'user': serialize_user(updated_user),
    }


@app.get('/api/merchant/profile')
def get_merchant_profile(
    current_user: dict = Depends(require_roles('ADMIN', 'MERCHANT')),
):
    """Return the current merchant/admin profile details."""
    user_id = current_user.get('id')
    user = users_collection.find_one({'id': user_id}, {'_id': 0}) or current_user
    return {
        'user': serialize_user(user),
        'profile_details': user.get('profile_details') or {},
    }


@app.put('/api/merchant/profile')
def update_merchant_profile(
    payload: MerchantProfileUpdateRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'MERCHANT')),
):
    """Update merchant profile details (store info, phone, banking details)"""
    user_id = current_user.get('id')
    email = current_user.get('email', '').strip().lower()

    user = users_collection.find_one({'$or': [{'id': user_id}, {'email': email}]})
    if not user:
        raise HTTPException(status_code=404, detail='User not found.')

    current_profile_details = user.get('profile_details', {}) or {}
    if payload.profile_details:
        current_profile_details.update(payload.profile_details)

    top_level_set: dict = {'profile_details': None, 'updated_at': now_utc()}
    if payload.phone_number:
        cleaned_phone = str(payload.phone_number).strip()
        current_profile_details['phone_number'] = cleaned_phone
        top_level_set['phone_number'] = cleaned_phone

    if payload.bank_details:
        current_bank_details = current_profile_details.get('bank_details', {}) or {}
        current_bank_details.update(payload.bank_details)
        current_profile_details['bank_details'] = current_bank_details

    top_level_set['profile_details'] = current_profile_details

    result = users_collection.update_one(
        {'id': user_id},
        {'$set': top_level_set},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=400, detail='Failed to update profile.')

    updated_user = users_collection.find_one({'id': user_id})
    return {
        'message': 'Merchant profile updated successfully.',
        'user': serialize_user(updated_user),
        'profile_details': (updated_user or {}).get('profile_details') or {},
    }


@app.get('/admin/delivery-associates')
def get_delivery_associates(
    status_filter: str | None = None,
    current_user: dict = Depends(require_roles('ADMIN')),
):
    _ = current_user
    query = {'role': 'DELIVERY_ASSOCIATE'}
    if status_filter:
        query['status'] = normalize_account_status(status_filter, fallback='PENDING')

    associates = list(users_collection.find(query).sort('created_at', -1))
    return {'users': [serialize_user(user) for user in associates]}


@app.get('/admin/user-approvals')
def get_pending_user_approvals(
    status_filter: str = 'PENDING',
    current_user: dict = Depends(require_roles('ADMIN')),
):
    _ = current_user
    query = {
        'role': {'$in': ['DELIVERY_ASSOCIATE', 'OPERATIONS_STAFF']},
        'status': normalize_account_status(status_filter, fallback='PENDING'),
    }
    pending_users = list(users_collection.find(query).sort('created_at', -1))
    return {'users': [serialize_user(user) for user in pending_users]}


@app.put('/admin/delivery-associates/{user_id}/status')
def update_delivery_associate_status(
    user_id: str,
    payload: AccountStatusUpdateRequest,
    current_user: dict = Depends(require_roles('ADMIN')),
):
    _ = current_user
    next_status = normalize_account_status(payload.status, fallback='ACTIVE')
    result = users_collection.update_one(
        {'id': user_id, 'role': 'DELIVERY_ASSOCIATE'},
        {'$set': {'status': next_status, 'updated_at': now_utc()}},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail='Delivery associate account not found.')

    user_account = users_collection.find_one({'id': user_id})
    return {'message': f'Delivery associate status set to {next_status}.', 'user': serialize_user(user_account)}


@app.put('/admin/users/{user_id}/status')
def update_pending_user_status(
    user_id: str,
    payload: AccountStatusUpdateRequest,
    current_user: dict = Depends(require_roles('ADMIN')),
):
    _ = current_user
    next_status = normalize_account_status(payload.status, fallback='ACTIVE')
    if next_status not in {'ACTIVE', 'BLOCKED'}:
        raise HTTPException(status_code=400, detail='Status must be ACTIVE or BLOCKED for approvals.')

    result = users_collection.update_one(
        {'id': user_id, 'role': {'$in': ['DELIVERY_ASSOCIATE', 'OPERATIONS_STAFF']}},
        {'$set': {'status': next_status, 'updated_at': now_utc()}},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail='Pending user account not found.')

    user_account = users_collection.find_one({'id': user_id})
    return {'message': f'User status set to {next_status}.', 'user': serialize_user(user_account)}


@app.get('/admin/delivery-coverage')
def get_admin_delivery_coverage(current_user: dict = Depends(require_roles('ADMIN'))):
    merchant_id = str(current_user.get('id') or '').strip()
    coverage = get_merchant_delivery_coverage(merchant_id)
    return coverage


@app.put('/admin/delivery-coverage')
def update_admin_delivery_coverage(
    payload: DeliveryCoverageRequest,
    current_user: dict = Depends(require_roles('ADMIN')),
):
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        raise HTTPException(status_code=400, detail='Unable to resolve merchant account id for coverage settings.')

    normalized_payload = normalize_delivery_coverage_payload(payload)
    now = now_utc()
    delivery_coverage_collection.update_one(
        {'merchant_id': merchant_id},
        {
            '$set': {
                'merchant_id': merchant_id,
                'delivery_scope': normalized_payload['delivery_scope'],
                'states': normalized_payload['states'],
                'cities': normalized_payload['cities'],
                'deliver_all_cities_in_selected_states': normalized_payload['deliver_all_cities_in_selected_states'],
                'updated_at': now,
            },
            '$setOnInsert': {'created_at': now},
        },
        upsert=True,
    )

    updated = get_merchant_delivery_coverage(merchant_id)
    return {'message': 'Delivery coverage settings saved.', **updated}


@app.get('/admin/shipping-settings')
def get_merchant_shipping_config(current_user: dict = Depends(require_roles('ADMIN', 'MERCHANT'))):
    """Retrieve merchant shipping configuration."""
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        raise HTTPException(status_code=400, detail='Unable to resolve merchant ID.')
    
    settings = get_merchant_shipping_settings(merchant_id)
    if not settings:
        return {
            'merchant_id': merchant_id,
            'warehouse': {
                'address': '',
                'pincode': '',
                'contact_number': '',
            },
            'distance_pricing': {
                'base_charge': 40,
                'per_km_rate': 1.5,
                'min_charge': 30,
                'max_charge': 500,
            },
            'couriers': {
                'available_couriers': ['Local', 'Express', 'Premium'],
            },
            'cod_rules': {
                'cod_enabled': True,
                'cod_limit': 100000,
                'cod_extra_charge': 0,
            },
            'allow_all_india': True,
            'serviceable_pincodes_count': 0,
            'blocked_pincodes_count': 0,
        }
    
    serviceable_count = serviceable_pincodes_collection.count_documents({'merchant_id': merchant_id})
    blocked_count = blocked_pincodes_collection.count_documents({'merchant_id': merchant_id})
    settings['serviceable_pincodes_count'] = serviceable_count
    settings['blocked_pincodes_count'] = blocked_count
    
    return settings


@app.put('/admin/shipping-settings')
def update_merchant_shipping_config(
    payload: MerchantShippingSettingsRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'MERCHANT')),
):
    """Update merchant shipping configuration."""
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        raise HTTPException(status_code=400, detail='Unable to resolve merchant ID.')
    
    warehouse_pincode = sanitize_pincode(payload.warehouse.pincode)
    if len(warehouse_pincode) != 6:
        raise HTTPException(status_code=400, detail='Warehouse pincode must be 6 digits.')
    
    if payload.distance_pricing.base_charge < 0 or payload.distance_pricing.per_km_rate < 0:
        raise HTTPException(status_code=400, detail='Charges cannot be negative.')
    
    now = now_utc()
    merchant_shipping_settings_collection.update_one(
        {'merchant_id': merchant_id},
        {
            '$set': {
                'merchant_id': merchant_id,
                'warehouse': payload.warehouse.dict(),
                'distance_pricing': payload.distance_pricing.dict(),
                'couriers': payload.couriers.dict(),
                'cod_rules': payload.cod_rules.dict(),
                'allow_all_india': payload.allow_all_india,
                'updated_at': now,
            },
            '$setOnInsert': {'created_at': now},
        },
        upsert=True,
    )
    
    if not payload.allow_all_india and payload.serviceable_pincodes:
        valid_pincodes = parse_service_pincodes(payload.serviceable_pincodes)
        serviceable_pincodes_collection.delete_many({'merchant_id': merchant_id})
        if valid_pincodes:
            serviceable_pincodes_collection.insert_many([
                {'merchant_id': merchant_id, 'pincode': p, 'created_at': now}
                for p in valid_pincodes
            ])
    
    if payload.blocked_pincodes:
        valid_blocked = parse_service_pincodes(payload.blocked_pincodes)
        blocked_pincodes_collection.delete_many({'merchant_id': merchant_id})
        if valid_blocked:
            blocked_pincodes_collection.insert_many([
                {'merchant_id': merchant_id, 'pincode': p, 'created_at': now}
                for p in valid_blocked
            ])
    
    updated = get_merchant_shipping_settings(merchant_id)
    return {
        'message': 'Shipping settings updated successfully.',
        'settings': updated,
    }


@app.get('/check-delivery')
@app.post('/check-delivery')
def check_delivery_serviceability(
    customer_pincode: str,
    order_total: float = 0,
    current_user: dict | None = Depends(get_current_user_optional),
):
    customer_pincode = sanitize_pincode(customer_pincode)
    if len(customer_pincode) != 6:
        raise HTTPException(status_code=400, detail='Invalid customer pincode.')
    
    # Always return serviceable to allow orders to be placed for any pincode entered by the user
    return {
        'is_serviceable': True,
        'estimated_days': '3-5 days',
        'delivery_charge': 0.0,
        'free_delivery_threshold': 500,
        'standard_delivery_charge': 0,
        'cod_available': True,
        'distance_km': 10.0,
    }


def apply_order_status_update(
    order: dict, 
    next_status: str, 
    actor_id: str, 
    location: str = '',
    performer_role: str = 'SYSTEM',
    performer_email: str = 'system@local'
) -> dict:
    current_status = normalize_order_status(order.get('status', 'PLACED'))
    target_status = normalize_order_status(next_status)
    allowed_roles = STATUS_PERFORMER_ROLE_MAP.get(target_status)
    normalized_role = normalize_role(performer_role)

    if allowed_roles and normalized_role not in allowed_roles:
        allowed_roles_text = ', '.join(sorted(role.replace('_', ' ').lower() for role in allowed_roles))
        raise HTTPException(
            status_code=403,
            detail=f'Only {allowed_roles_text} can set {target_status}.',
        )

    validate_order_workflow_transition(current_status, target_status)

    if current_status == target_status:
        return order

    orders_collection.update_one(
        {'order_id': order['order_id']},
        {
            '$set': {
                'status': target_status,
                'updated_at': now_utc(),
                'updated_by': actor_id,
                'updated_by_role': performer_role,
                'updated_by_email': performer_email,
            }
        },
    )
    append_order_status_history(
        order['order_id'], 
        target_status,
        actor_id,
        performer_role=performer_role,
        performer_email=performer_email,
        location=location
    )
    append_delivery_log(
        order['order_id'], 
        target_status, 
        actor_id,
        location=location,
        performer_role=performer_role,
        performer_email=performer_email
    )

    customer_id = str(order.get('user_id') or order.get('customer_email') or '').strip() or None
    
    event_type_map = {
        'CONFIRMED': 'ORDER_CONFIRMED',
        'PACKED': 'ORDER_PACKED',
        'SHIPPED': 'SHIPMENT_DISPATCHED',
        'OUT_FOR_DELIVERY': 'OUT_FOR_DELIVERY',
        'DELIVERED': 'DELIVERED',
        'CANCELLED': 'CANCELLED',
        'REJECTED': 'REJECTED',
    }
    event_type = event_type_map.get(target_status, target_status)
    message = get_status_message(target_status)
    send_order_notification(
        order_id=order['order_id'],
        event_type=event_type,
        message=message,
        user_id=customer_id,
    )
    
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running() and customer_id:
            event_data = {
                "type": "order_status_updated",
                "data": {
                    "order_id": order['order_id'],
                    "previous_status": current_status,
                    "new_status": target_status,
                    "timestamp": now_utc().isoformat(),
                    "performed_by": actor_id,
                    "performer_role": performer_role,
                    "performer_email": performer_email,
                    "location": location,
                    "message": message,
                }
            }
            asyncio.create_task(manager.broadcast_to_user(customer_id, event_data))

            for merchant_id in get_active_registered_merchant_ids():
                asyncio.create_task(manager.broadcast_to_user(merchant_id, event_data))
    except:
        pass

    if target_status == 'CONFIRMED':
        reduce_inventory_for_order(order['order_id'], order.get('warehouse_id'))

    if target_status == 'DELIVERED':
        payment = payments_collection.find_one({'order_id': order['order_id']}, {'_id': 0}) or {}
        method = str(payment.get('method') or 'COD').upper()
        if method == 'COD':
            set_payment_status(order['order_id'], 'SUCCESS', method='COD')

    latest = orders_collection.find_one({'order_id': order['order_id']})
    check_and_notify_early_arrival(latest)
    return latest


def check_and_notify_early_arrival(order: dict | None) -> None:
    if not order:
        return
    try:
        status_timestamps = (order.get('status_timestamps') if isinstance(order, dict) else {}) or {}
        delivered_at = status_timestamps.get('DELIVERED')
        if delivered_at:
            pass
    except Exception:
        pass


def get_status_message(status: str) -> str:
    messages = {
        'PLACED': 'Your order has been placed successfully! 📝',
        'CONFIRMED': 'Your order is confirmed! ✅',
        'PACKED': 'Your order is being packed. 📦',
        'SHIPPED': 'Your order has been shipped! 🚚',
        'DISPATCHED': 'Your shipment has left the warehouse.',
        'IN_TRANSIT': 'Your shipment is moving between hubs.',
        'ARRIVED_AT_CITY': 'Your shipment has reached the destination city hub.',
        'OUT_FOR_DELIVERY': 'Your order is out for delivery! 📍',
        'DELIVERED': 'Your order has been delivered successfully! 🎉',
        'REJECTED': 'Your order has been rejected by the merchant.',
        'CANCELLED': 'Your order has been cancelled.',
        'DELIVERY_FAILED': 'Delivery attempt failed. We will try again soon.',
    }
    return messages.get(status, f'Order status updated to {status.replace("_", " ")}')


def build_shipment_route(source_warehouse: dict, destination: dict) -> list[str]:
    warehouse_label = str(source_warehouse.get('city') or source_warehouse.get('warehouse_id') or 'Source Warehouse').strip()
    if warehouse_label and 'warehouse' not in warehouse_label.lower():
        warehouse_label = f'{warehouse_label} Warehouse'
    if not warehouse_label:
        warehouse_label = 'Source Warehouse'

    destination_state = str(destination.get('state') or '').strip()
    destination_city = str(destination.get('city') or '').strip()
    regional_hub = f'{destination_state} Regional Hub' if destination_state else 'Regional Hub'
    city_hub = f'{destination_city} Hub' if destination_city else 'City Hub'

    route = [warehouse_label]
    if regional_hub != route[-1]:
        route.append(regional_hub)
    if city_hub != route[-1]:
        route.append(city_hub)
    route.append('Out for Delivery')
    return route


def build_shipment_location(route: list[str], status: str, shipment: dict | None = None) -> tuple[str, str | None]:
    current_status = normalize_shipment_status(status)
    normalized_route = [str(entry or '').strip() for entry in (route or []) if str(entry or '').strip()]
    source = normalized_route[0] if normalized_route else str((shipment or {}).get('source_warehouse') or 'Warehouse').strip() or 'Warehouse'
    regional = normalized_route[1] if len(normalized_route) > 1 else 'Regional Hub'
    city_hub = normalized_route[2] if len(normalized_route) > 2 else 'City Hub'

    if current_status == 'CREATED':
        return source, regional
    if current_status == 'DISPATCHED':
        return source, regional
    if current_status == 'IN_TRANSIT':
        return regional, city_hub
    if current_status == 'ARRIVED_AT_CITY':
        return city_hub, 'Out for Delivery'
    if current_status == 'OUT_FOR_DELIVERY':
        return 'Last mile route', None
    return 'Delivered to customer', None


def append_shipment_event(shipment_id: str, status_value: str, location: str, message: str, order_id: str | None = None) -> dict:
    entry = {
        'id': f'SEV-{uuid4().hex[:12].upper()}',
        'shipment_id': shipment_id,
        'order_id': order_id,
        'status': normalize_shipment_status(status_value),
        'location': str(location or '').strip(),
        'message': str(message or '').strip(),
        'timestamp': now_utc(),
    }
    shipment_events_collection.insert_one(entry)
    return entry


def get_shipment_status_message(status: str) -> str:
    messages = {
        'CREATED': 'Shipment created and queued at the source warehouse.',
        'DISPATCHED': 'Shipment dispatched from the warehouse.',
        'IN_TRANSIT': 'Shipment is moving through the hub network.',
        'ARRIVED_AT_CITY': 'Shipment arrived at the destination city hub.',
        'OUT_FOR_DELIVERY': 'Shipment handed over for last-mile delivery.',
        'DELIVERED': 'Shipment delivered successfully.',
    }
    return messages.get(normalize_shipment_status(status), 'Shipment status updated.')


def sync_order_status_from_shipment(
    shipment: dict,
    target_status: str,
    location: str,
    performer_role: str,
    performer_email: str,
    actor_id: str,
) -> None:
    shipment_status = normalize_shipment_status(target_status)
    order_ids = get_shipment_order_ids(str(shipment.get('shipment_id') or ''))
    if not order_ids:
        return

    for order_id in order_ids:
        order = orders_collection.find_one(active_orders_filter({'order_id': order_id}))
        if not order:
            continue

        current_status = normalize_order_status(order.get('status', 'PLACED'))
        next_status = current_status
        if shipment_status == 'DISPATCHED' and current_status in {'PACKED', 'CONFIRMED', 'PLACED'}:
            next_status = 'SHIPPED'
        elif shipment_status == 'OUT_FOR_DELIVERY':
            next_status = 'OUT_FOR_DELIVERY'
        elif shipment_status == 'DELIVERED':
            next_status = 'DELIVERED'

        if next_status != current_status:
            apply_order_status_update(
                order,
                next_status,
                actor_id,
                location=location,
                performer_role=performer_role,
                performer_email=performer_email,
            )


def assign_last_mile_partner_for_shipment(shipment: dict, destination: dict, destination_pincode: str) -> tuple[str | None, str | None]:
    partners = list(
        users_collection.find(
            {'role': 'DELIVERY_ASSOCIATE', 'status': 'ACTIVE'},
            {'_id': 0, 'id': 1, 'email': 1, 'profile_details': 1, 'city': 1, 'state': 1, 'is_online': 1},
        )
    )
    if not partners:
        return None, None

    eligible_partners = []
    for partner in partners:
        profile = normalize_delivery_partner_profile_for_scope(partner.get('profile_details') or {}, is_demo_partner=is_demo_delivery_partner_account(partner))
        if not bool(partner.get('is_online', True)):
            continue
        availability = str(profile.get('availability') or '').strip().upper()
        if availability and availability not in {'FULL_TIME', 'PART_TIME', 'ACTIVE', 'AVAILABLE'}:
            continue
        service_pincodes = parse_service_pincodes(profile.get('service_pincodes') or profile.get('service_pincode'))
        if not is_delivery_partner_all_india(profile) and destination_pincode not in service_pincodes:
            continue
        eligible_partners.append(partner)

    if not eligible_partners:
        return None, None

    workload_map = get_delivery_partner_workload()
    ranked = sorted(
        eligible_partners,
        key=lambda partner: score_delivery_partner(partner, destination, destination_pincode, workload_map),
        reverse=True,
    )
    selected = ranked[0]
    selected_id = str(selected.get('id') or '').strip() or None
    selected_email = str(selected.get('email') or '').strip().lower() or None
    if not selected_id and not selected_email:
        return None, None

    orders_collection.update_many(
        {'shipment_id': shipment.get('shipment_id')},
        {
            '$set': {
                'assigned_delivery_id': selected_id,
                'assigned_delivery_partner': selected_email,
                'delivery_meta.assigned_at': now_utc().isoformat(),
                'delivery_meta.assignment_source': 'shipment_arrived_at_city',
                'updated_at': now_utc(),
            }
        },
    )
    shipments_collection.update_one(
        {'shipment_id': shipment.get('shipment_id')},
        {
            '$set': {
                'assigned_partner_id': selected_id,
                'assigned_partner_email': selected_email,
                'updated_at': now_utc(),
            }
        },
    )
    return selected_id, selected_email


def create_shipment_from_order(order: dict, current_user: dict | None = None, status: str = 'CREATED') -> dict:
    destination = get_order_destination_location(order)
    warehouse = get_warehouse_location(order)
    shipment_id = str(order.get('shipment_id') or f'SHP-{uuid4().hex[:10].upper()}').strip()
    destination_pincode = sanitize_pincode(order.get('destination_pincode', ''))
    route = build_shipment_route(warehouse, destination)
    current_status = normalize_shipment_status(status)
    current_location, next_location = build_shipment_location(route, current_status, {'source_warehouse': warehouse.get('warehouse_id')})
    shipment_document = {
        'id': shipment_id,
        'shipment_id': shipment_id,
        'order_id': order.get('order_id'),
        'source_warehouse': warehouse.get('city') and f"{warehouse.get('city')} Warehouse" or warehouse.get('warehouse_id') or 'Warehouse',
        'source_warehouse_id': warehouse.get('warehouse_id'),
        'destination_pincode': destination_pincode,
        'destination_city': str(destination.get('city') or '').strip(),
        'destination_state': str(destination.get('state') or '').strip(),
        'status': current_status,
        'current_location': current_location,
        'next_location': next_location,
        'assigned_partner_id': None,
        'assigned_partner_email': None,
        'route': route,
        'tracking_id': f'TRK-{uuid4().hex[:12].upper()}',
        'courier_name': 'BlueDart',
        'vehicle_type': 'VAN',
        'created_at': now_utc(),
        'updated_at': now_utc(),
        'updated_by': str((current_user or {}).get('id') or (current_user or {}).get('email') or 'system'),
    }
    
    created_at_value = shipment_document.pop('created_at')
    tracking_id_value = shipment_document.pop('tracking_id')
    
    shipments_collection.update_one(
        {'shipment_id': shipment_id},
        {
            '$set': shipment_document,
            '$setOnInsert': {
                'created_at': created_at_value,
                'tracking_id': tracking_id_value,
            }
        },
        upsert=True,
    )
    shipment = shipments_collection.find_one({'shipment_id': shipment_id}) or shipment_document
    append_shipment_event(
        shipment_id,
        current_status,
        current_location,
        get_shipment_status_message(current_status),
        order_id=str(order.get('order_id') or '').strip() or None,
    )
    orders_collection.update_one(
        {'order_id': order.get('order_id')},
        {
            '$set': {
                'shipment_id': shipment_id,
                'updated_at': now_utc(),
            }
        },
    )
    shipment_items_collection.update_one(
        {'shipment_id': shipment_id, 'order_id': order.get('order_id')},
        {'$set': {'shipment_id': shipment_id, 'order_id': order.get('order_id')}},
        upsert=True,
    )
    return shipment


def transition_shipment_status(
    shipment: dict,
    target_status: str,
    actor_id: str,
    performer_role: str,
    performer_email: str,
    location: str | None = None,
) -> dict:
    shipment_id = str(shipment.get('shipment_id') or '').strip()
    if not shipment_id:
        raise HTTPException(status_code=404, detail='Shipment not found.')

    current_status = normalize_shipment_status(shipment.get('status', 'CREATED'))
    next_status = normalize_shipment_status(target_status)
    if current_status == next_status:
        return shipments_collection.find_one({'shipment_id': shipment_id}) or shipment

    valid_transitions = {
        'CREATED': {'DISPATCHED', 'IN_TRANSIT', 'ARRIVED_AT_CITY', 'OUT_FOR_DELIVERY', 'DELIVERED'},
        'DISPATCHED': {'IN_TRANSIT', 'ARRIVED_AT_CITY', 'OUT_FOR_DELIVERY', 'DELIVERED'},
        'IN_TRANSIT': {'ARRIVED_AT_CITY', 'OUT_FOR_DELIVERY', 'DELIVERED'},
        'ARRIVED_AT_CITY': {'OUT_FOR_DELIVERY', 'DELIVERED'},
        'OUT_FOR_DELIVERY': {'DELIVERED'},
    }
    if next_status not in valid_transitions.get(current_status, set()):
        raise HTTPException(status_code=400, detail=f'Shipment cannot move from {current_status} to {next_status}.')

    route = list(shipment.get('route') or [])
    current_location, next_location = build_shipment_location(route, next_status, shipment)
    location_value = str(location or current_location or 'Hub network').strip()

    shipments_collection.update_one(
        {'shipment_id': shipment_id},
        {
            '$set': {
                'status': next_status,
                'current_location': location_value,
                'next_location': next_location,
                'updated_at': now_utc(),
                'updated_by': actor_id,
            }
        },
    )
    latest_shipment = shipments_collection.find_one({'shipment_id': shipment_id}) or dict(shipment, status=next_status)
    append_shipment_event(
        shipment_id,
        next_status,
        location_value,
        get_shipment_status_message(next_status),
        order_id=str(shipment.get('order_id') or '').strip() or None,
    )

    if next_status == 'ARRIVED_AT_CITY':
        shipment_order_ids = get_shipment_order_ids(shipment_id)
        reference_order = None
        if shipment.get('order_id'):
          reference_order = orders_collection.find_one({'order_id': shipment.get('order_id')})
        if not reference_order and shipment_order_ids:
            reference_order = orders_collection.find_one({'order_id': shipment_order_ids[0]})
        destination = {
            'city': str(shipment.get('destination_city') or (reference_order or {}).get('shipping_details', {}).get('city') or '').strip(),
            'state': str(shipment.get('destination_state') or (reference_order or {}).get('shipping_details', {}).get('state') or '').strip(),
        }
        destination_pincode = sanitize_pincode(shipment.get('destination_pincode') or (reference_order or {}).get('destination_pincode', ''))
        assign_last_mile_partner_for_shipment(latest_shipment, destination, destination_pincode)

    sync_order_status_from_shipment(latest_shipment, next_status, location_value, performer_role, performer_email, actor_id)

    if next_status in {'DISPATCHED', 'IN_TRANSIT', 'ARRIVED_AT_CITY'}:
        for order_id in get_shipment_order_ids(shipment_id):
            order = orders_collection.find_one({'order_id': order_id})
            customer_id = str(order or {}).get('user_id')
            if customer_id:
                send_order_notification(
                    order_id=order_id,
                    event_type='SHIPMENT_TRANSIT_UPDATE',
                    message=f"Your order shipment is in transit: {location_value}",
                    user_id=customer_id,
                )
    return latest_shipment


# ============================================================================
# ORDER ENDPOINTS
# ============================================================================

@app.post('/orders')
def create_order(
    payload: CreateOrderRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user.get('id')
    user_email = current_user.get('email', '').strip().lower()

    if not payload.items:
        raise HTTPException(status_code=400, detail="Cart is empty.")

    # Calculate subtotal and details
    total_amount = 0.0
    items_to_save = []
    order_id = f"ORD-{uuid4().hex[:10].upper()}"

    for it in payload.items:
        product = products_collection.find_one({'id': it.product_id})
        if not product:
            raise HTTPException(status_code=404, detail=f"Product with id {it.product_id} not found.")
        
        price = float(product.get('price') or 0.0)
        quantity = int(it.quantity or 1)
        total_amount += price * quantity
        
        items_to_save.append({
            'id': f"OI-{uuid4().hex[:12].upper()}",
            'order_id': order_id,
            'product_id': it.product_id,
            'quantity': quantity,
        })

    # Save to order_items_collection
    if items_to_save:
        order_items_collection.insert_many(items_to_save)

    # Save to orders_collection
    now = now_utc()
    order_doc = {
        'id': order_id,
        'order_id': order_id,
        'user_id': user_id,
        'customer_id': user_id,
        'customer_email': user_email,
        'status': 'PLACED',
        'created_at': now,
        'updated_at': now,
        'payment_method': payload.payment_method,
        'destination_pincode': sanitize_pincode(payload.pincode),
        'shipping_details': payload.shipping_details or {},
        'is_deleted': False,
        'order_value': total_amount,
        'total_amount': total_amount,
        'status_timestamps': {
            'PLACED': now.isoformat()
        }
    }
    orders_collection.insert_one(order_doc)

    # Record first delivery log
    delivery_logs_collection.insert_one({
        'id': f"DLOG-{uuid4().hex[:12].upper()}",
        'order_id': order_id,
        'status': 'PLACED',
        'updated_by': user_id,
        'location': 'Order placement',
        'timestamp': now,
    })

    # Save payment information if any
    payment_doc = {
        'id': f"PMT-{uuid4().hex[:10].upper()}",
        'order_id': order_id,
        'method': payload.payment_method,
        'amount': total_amount,
        'status': 'SUCCESS' if payload.payment_method != 'COD' else 'PENDING',
        'payment_details': payload.payment_details or {},
        'created_at': now,
        'updated_at': now,
    }
    payments_collection.insert_one(payment_doc)

    # Trigger automatic shipment creation on placement
    try:
        create_shipment_from_order(order_doc, current_user=current_user)
    except Exception as e:
        print(f"[WARN] Auto shipment creation failed: {e}")

    # Trigger WebSocket notification for order creation
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            event_data = {
                "type": "order_created",
                "data": {
                    "order_id": order_id,
                    "customer_id": user_id,
                    "customer_email": user_email,
                    "total_amount": total_amount,
                    "created_at": now.isoformat(),
                }
            }
            if user_id:
                asyncio.create_task(manager.broadcast_to_user(user_id, event_data))
            if user_email:
                asyncio.create_task(manager.broadcast_to_user(user_email, event_data))
            
            # Broadcast to any connected admins, merchants, or operations staff
            admin_staff_users = list(users_collection.find(
                {'role': {'$in': ['ADMIN', 'MERCHANT', 'OPERATIONS_STAFF', 'SUPER_ADMIN']}, 'status': 'ACTIVE'},
                {'_id': 0, 'id': 1, 'email': 1}
            ))
            target_ids = set()
            for u in admin_staff_users:
                uid = str(u.get('id') or '').strip()
                uemail = str(u.get('email') or '').strip().lower()
                if uid:
                    target_ids.add(uid)
                if uemail:
                    target_ids.add(uemail)
            
            for conn_user in list(manager.active_connections.keys()):
                if conn_user in target_ids or conn_user.lower() in target_ids:
                    asyncio.create_task(manager.broadcast_to_user(conn_user, event_data))
    except Exception as e:
        print(f"[WARN] WebSocket broadcast failed: {e}")

    return {
        'message': 'Order placed successfully.',
        'order_id': order_id,
        'order': serialize_order(order_doc),
    }



@app.get('/orders/my')
def get_my_orders(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get('id')
    user_email = current_user.get('email', '').strip().lower()
    
    query = {'$or': [{'user_id': user_id}, {'customer_id': user_id}, {'customer_email': user_email}]}
    orders = list(orders_collection.find(query).sort('created_at', -1))
    return serialize_orders_batch(orders)


@app.get('/admin/dashboard-stats')
def get_admin_dashboard_stats(
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF', 'MERCHANT')),
):
    now = now_utc()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    # Fetch and parse orders
    all_orders = list(orders_collection.find({'status': {'$nin': ['CANCELLED', 'REJECTED']}}))
    for o in all_orders:
        created = o.get('created_at')
        if isinstance(created, str):
            try:
                val = created.replace('Z', '+00:00')
                o['_parsed_created_at'] = datetime.fromisoformat(val)
            except Exception:
                o['_parsed_created_at'] = now
        elif isinstance(created, datetime):
            o['_parsed_created_at'] = created
        else:
            o['_parsed_created_at'] = now
        
        if o['_parsed_created_at'].tzinfo is None:
            o['_parsed_created_at'] = o['_parsed_created_at'].replace(tzinfo=timezone.utc)

    def get_metrics_for_period(orders_list, start_time: datetime, end_time: datetime):
        period_orders = [o for o in orders_list if start_time <= o['_parsed_created_at'] < end_time]
        rev = sum(o.get('total_amount') or o.get('order_value') or 0 for o in period_orders)
        cnt = len(period_orders)
        avg = rev / cnt if cnt > 0 else 0
        return rev, cnt, avg

    def get_sparkline_for_period(orders_list, start_time: datetime, end_time: datetime, num_intervals: int, metric_type: str):
        interval_delta = (end_time - start_time) / num_intervals
        values = []
        for i in range(num_intervals):
            t1 = start_time + i * interval_delta
            t2 = t1 + interval_delta
            interval_orders = [o for o in orders_list if t1 <= o['_parsed_created_at'] < t2]
            if metric_type == 'revenue':
                val = sum(o.get('total_amount') or o.get('order_value') or 0 for o in interval_orders)
            elif metric_type == 'orders':
                val = len(interval_orders)
            else:
                rev = sum(o.get('total_amount') or o.get('order_value') or 0 for o in interval_orders)
                val = rev / len(interval_orders) if len(interval_orders) > 0 else 0
            values.append(float(val))
        return values

    def calculate_trend(current_val, previous_val, period_name="yesterday"):
        if previous_val == 0:
            if current_val > 0:
                return f"+100% from {period_name}"
            return f"0% from {period_name}"
        pct = ((current_val - previous_val) / previous_val) * 100
        sign = "+" if pct >= 0 else ""
        return f"{sign}{pct:.1f}% from {period_name}"

    # TODAY
    t_rev, t_ord, t_avg = get_metrics_for_period(all_orders, now - timedelta(days=1), now)
    pt_rev, pt_ord, pt_avg = get_metrics_for_period(all_orders, now - timedelta(days=2), now - timedelta(days=1))
    t_spark_rev = get_sparkline_for_period(all_orders, now - timedelta(days=1), now, 10, 'revenue')
    t_spark_ord = get_sparkline_for_period(all_orders, now - timedelta(days=1), now, 10, 'orders')
    t_spark_avg = get_sparkline_for_period(all_orders, now - timedelta(days=1), now, 10, 'avg')
    
    # WEEK
    w_rev, w_ord, w_avg = get_metrics_for_period(all_orders, now - timedelta(days=7), now)
    pw_rev, pw_ord, pw_avg = get_metrics_for_period(all_orders, now - timedelta(days=14), now - timedelta(days=7))
    w_spark_rev = get_sparkline_for_period(all_orders, now - timedelta(days=7), now, 7, 'revenue')
    w_spark_ord = get_sparkline_for_period(all_orders, now - timedelta(days=7), now, 7, 'orders')
    w_spark_avg = get_sparkline_for_period(all_orders, now - timedelta(days=7), now, 7, 'avg')
    
    # MONTH
    m_rev, m_ord, m_avg = get_metrics_for_period(all_orders, now - timedelta(days=30), now)
    pm_rev, pm_ord, pm_avg = get_metrics_for_period(all_orders, now - timedelta(days=60), now - timedelta(days=30))
    m_spark_rev = get_sparkline_for_period(all_orders, now - timedelta(days=30), now, 10, 'revenue')
    m_spark_ord = get_sparkline_for_period(all_orders, now - timedelta(days=30), now, 10, 'orders')
    m_spark_avg = get_sparkline_for_period(all_orders, now - timedelta(days=30), now, 10, 'avg')

    statsByRange = {
        'TODAY': [
            { 'label': 'Revenue', 'value': f"Rs. {int(t_rev)}", 'trend': calculate_trend(t_rev, pt_rev, 'yesterday'), 'sparkline': t_spark_rev },
            { 'label': 'Orders', 'value': str(t_ord), 'trend': calculate_trend(t_ord, pt_ord, 'yesterday'), 'sparkline': t_spark_ord },
            { 'label': 'Average Value', 'value': f"Rs. {int(t_avg)}", 'trend': calculate_trend(t_avg, pt_avg, 'yesterday'), 'sparkline': t_spark_avg }
        ],
        'WEEK': [
            { 'label': 'Revenue', 'value': f"Rs. {int(w_rev)}", 'trend': calculate_trend(w_rev, pw_rev, 'last week'), 'sparkline': w_spark_rev },
            { 'label': 'Orders', 'value': str(w_ord), 'trend': calculate_trend(w_ord, pw_ord, 'last week'), 'sparkline': w_spark_ord },
            { 'label': 'Average Value', 'value': f"Rs. {int(w_avg)}", 'trend': calculate_trend(w_avg, pw_avg, 'last week'), 'sparkline': w_spark_avg }
        ],
        'MONTH': [
            { 'label': 'Revenue', 'value': f"Rs. {int(m_rev)}", 'trend': calculate_trend(m_rev, pm_rev, 'last month'), 'sparkline': m_spark_rev },
            { 'label': 'Orders', 'value': str(m_ord), 'trend': calculate_trend(m_ord, pm_ord, 'last month'), 'sparkline': m_spark_ord },
            { 'label': 'Average Value', 'value': f"Rs. {int(m_avg)}", 'trend': calculate_trend(m_avg, pm_avg, 'last month'), 'sparkline': m_spark_avg }
        ]
    }

    # chartData.revenue
    revenue_chart = []
    for i in range(29, -1, -1):
        day_start = now - timedelta(days=i+1)
        day_end = now - timedelta(days=i)
        day_str = day_end.strftime('%b %d')
        period_orders = [o for o in all_orders if day_start <= o['_parsed_created_at'] < day_end]
        rev = sum(o.get('total_amount') or o.get('order_value') or 0 for o in period_orders)
        revenue_chart.append({'day': day_str, 'revenue': float(rev)})

    # chartData.orders
    orders_chart = []
    for i in range(6, -1, -1):
        day_start = now - timedelta(days=i+1)
        day_end = now - timedelta(days=i)
        day_str = day_end.strftime('%b %d')
        period_orders = [o for o in all_orders if day_start <= o['_parsed_created_at'] < day_end]
        orders_chart.append({'day': day_str, 'orders': len(period_orders)})

    return {
        'statsByRange': statsByRange,
        'chartData': {
            'revenue': revenue_chart,
            'orders': orders_chart
        }
    }


@app.get('/admin/orders')
def get_admin_orders(
    status_filter: str | None = None,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    query = {}
    if status_filter:
        query['status'] = status_filter
    
    orders = list(orders_collection.find(query).sort('created_at', -1))
    return serialize_orders_batch(orders)


@app.get('/orders/{order_id}/tracking')
def get_order_tracking(
    order_id: str,
    current_user: dict = Depends(get_current_user_optional),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    return serialize_order(order)


@app.post('/orders/{order_id}/{action}')
@app.put('/orders/{order_id}/{action}')
@app.patch('/orders/{order_id}/{action}')
def handle_order_action(
    order_id: str,
    action: str,
    payload: OrderActionRequest | None = None,
    current_user: dict = Depends(get_current_user),
):
    actor_id = current_user.get('id')
    role = normalize_role(current_user.get('role', 'CUSTOMER'))
    email = current_user.get('email', 'system@local')

    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    action_lower = action.lower().strip()
    action_status_map = {
        'confirm': 'CONFIRMED',
        'reject': 'REJECTED',
        'pack': 'PACKED',
        'cancel': 'CANCELLED',
        'start-delivery': 'SHIPPED',
        'out-for-delivery': 'OUT_FOR_DELIVERY',
        'delivered': 'DELIVERED',
    }

    target_status = action_status_map.get(action_lower)
    if not target_status:
        raise HTTPException(status_code=400, detail=f"Unsupported action: {action}")

    # For delivery actions, update shipment status as well if there is an active shipment
    shipment_id = order.get('shipment_id')
    if shipment_id and target_status in {'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'}:
        shipment = shipments_collection.find_one({'shipment_id': shipment_id})
        if shipment:
            shipment_status_map = {
                'SHIPPED': 'DISPATCHED',
                'OUT_FOR_DELIVERY': 'OUT_FOR_DELIVERY',
                'DELIVERED': 'DELIVERED',
            }
            try:
                transition_shipment_status(
                    shipment,
                    shipment_status_map[target_status],
                    actor_id,
                    role,
                    email,
                    location=(payload.current_location if payload else None),
                )
            except Exception as e:
                print(f"[WARN] Syncing shipment status failed: {e}")

    updated_order = apply_order_status_update(
        order,
        target_status,
        actor_id,
        location=(payload.current_location if payload else ""),
        performer_role=role,
        performer_email=email,
    )
    return {
        'message': f"Order status updated to {target_status}.",
        'order': serialize_order(updated_order),
    }


@app.put('/admin/orders/{order_id}/assign')
def assign_delivery_partner(
    order_id: str,
    payload: AssignDeliveryRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    partner_email = payload.delivery_partner_email.strip().lower()
    partner = users_collection.find_one({'email': partner_email, 'role': 'DELIVERY_ASSOCIATE'})
    if not partner:
        raise HTTPException(status_code=404, detail=f"Delivery associate with email {partner_email} not found.")

    partner_id = partner.get('id')

    orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'assigned_delivery_id': partner_id,
                'assigned_delivery_partner': partner_email,
                'delivery_meta.assigned_at': now_utc().isoformat(),
                'delivery_meta.assignment_source': 'admin_manual_assign',
                'updated_at': now_utc(),
            }
        },
    )

    shipment_id = order.get('shipment_id')
    if shipment_id:
        shipments_collection.update_one(
            {'shipment_id': shipment_id},
            {
                '$set': {
                    'assigned_partner_id': partner_id,
                    'assigned_partner_email': partner_email,
                    'updated_at': now_utc(),
                }
            },
        )

    return {
        'message': f"Order assigned to {partner_email} successfully.",
        'order': serialize_order(orders_collection.find_one({'order_id': order_id})),
    }


@app.get('/orders/{order_id}/eta')
def get_order_eta(
    order_id: str,
    current_user: dict = Depends(get_current_user_optional),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    
    # Calculate delivery ETA based on distance
    settings = get_merchant_shipping_settings(get_default_merchant_id()) or {}
    warehouse_pincode = settings.get('warehouse', {}).get('pincode', '560001')
    customer_pincode = order.get('destination_pincode') or order.get('pincode') or '560001'
    
    distance = calculate_distance(warehouse_pincode, customer_pincode)
    min_days, max_days = estimate_delivery_timeframe(distance)
    
    created_at = order.get('created_at') or now_utc()
    eta_min = created_at + timedelta(days=min_days)
    eta_max = created_at + timedelta(days=max_days)

    return {
        'order_id': order_id,
        'min_eta': eta_min.isoformat(),
        'max_eta': eta_max.isoformat(),
        'estimated_days': f"{min_days}-{max_days} days",
    }


class DeliveryProfileUpdateRequest(BaseModel):
    is_online: bool | None = None
    service_pincodes: str | None = None


@app.get('/delivery/profile')
def get_delivery_profile(
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE', 'ADMIN')),
):
    user_id = current_user.get('id')
    user = users_collection.find_one({'id': user_id}, {'_id': 0}) or current_user
    return {
        'user': serialize_user(user),
        'profile_details': user.get('profile_details') or {},
    }


@app.put('/delivery/profile')
def update_delivery_profile(
    payload: DeliveryProfileUpdateRequest,
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE', 'ADMIN')),
):
    user_id = current_user.get('id')
    user = users_collection.find_one({'id': user_id})
    if not user:
        raise HTTPException(status_code=404, detail='User not found.')

    current_profile_details = user.get('profile_details', {}) or {}
    top_level_set: dict = {'updated_at': now_utc()}
    
    if payload.is_online is not None:
        top_level_set['is_online'] = payload.is_online
        current_profile_details['is_online'] = payload.is_online
        
    if payload.service_pincodes is not None:
        current_profile_details['service_pincodes'] = payload.service_pincodes

    top_level_set['profile_details'] = current_profile_details

    result = users_collection.update_one(
        {'id': user_id},
        {'$set': top_level_set},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=400, detail='Failed to update delivery profile.')

    updated_user = users_collection.find_one({'id': user_id})
    return {
        'message': 'Delivery profile updated successfully.',
        'user': serialize_user(updated_user),
        'profile_details': updated_user.get('profile_details') or {},
    }


@app.get('/delivery/earnings')
def get_delivery_earnings(
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE', 'ADMIN')),
):
    partner_id = current_user.get('id')
    now = now_utc()
    today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    week_start = today_start - timedelta(days=7)
    
    delivered_orders = list(orders_collection.find({
        'assigned_delivery_id': partner_id,
        'status': 'DELIVERED'
    }))
    
    today_deliveries = 0
    today_earnings = 0.0
    weekly_earnings = 0.0
    
    for order in delivered_orders:
        delivered_at_str = order.get('delivery_meta', {}).get('delivered_at')
        if delivered_at_str:
            try:
                delivered_at = datetime.fromisoformat(delivered_at_str)
            except ValueError:
                delivered_at = order.get('updated_at') or now
        else:
            delivered_at = order.get('updated_at') or now
            
        if delivered_at.tzinfo is None:
            delivered_at = delivered_at.replace(tzinfo=timezone.utc)
            
        order_value = float(order.get('total_amount') or order.get('order_value') or 0)
        fee = 60.0 + (0.02 * order_value)
        
        if delivered_at >= today_start:
            today_deliveries += 1
            today_earnings += fee
            
        if delivered_at >= week_start:
            weekly_earnings += fee
            
    return {
        'today_deliveries': today_deliveries,
        'today_earnings': round(today_earnings, 2),
        'weekly_earnings': round(weekly_earnings, 2),
    }


@app.get('/delivery/pincode-orders')
def get_delivery_pincode_orders(
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE', 'ADMIN')),
):
    profile = current_user.get('profile_details') or {}
    service_pincodes = parse_service_pincodes(profile.get('service_pincodes') or profile.get('service_pincode') or '')
    
    unassigned_orders = []
    if service_pincodes:
        unassigned_orders = list(orders_collection.find({
            'assigned_delivery_id': None,
            'status': {'$in': ['CONFIRMED', 'PACKED', 'SHIPPED']},
            'destination_pincode': {'$in': service_pincodes}
        }).sort('created_at', -1))
    
    if normalize_role(current_user.get('role')) == 'ADMIN' and not unassigned_orders:
        unassigned_orders = list(orders_collection.find({
            'assigned_delivery_id': None,
            'status': {'$in': ['CONFIRMED', 'PACKED', 'SHIPPED']}
        }).sort('created_at', -1))

    return serialize_orders_batch(unassigned_orders)


@app.get('/delivery/orders')
def get_delivery_orders(
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE', 'ADMIN')),
):
    email = current_user.get('email', '').strip().lower()
    partner_id = current_user.get('id')

    # Get orders assigned to me, including PACKED, SHIPPED, OUT_FOR_DELIVERY, ARRIVED_AT_CITY, DELIVERED
    my_orders = list(orders_collection.find({
        'assigned_delivery_id': partner_id,
        'status': {'$in': ['PACKED', 'ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_CITY', 'DELIVERED']}
    }).sort('created_at', -1))

    # Get available (unassigned) orders in my service pincodes
    profile = current_user.get('profile_details') or {}
    service_pincodes = parse_service_pincodes(profile.get('service_pincodes') or profile.get('service_pincode') or '')
    
    unassigned_orders = []
    if service_pincodes:
        unassigned_orders = list(orders_collection.find({
            'assigned_delivery_id': None,
            'status': {'$in': ['CONFIRMED', 'PACKED', 'SHIPPED']},
            'destination_pincode': {'$in': service_pincodes}
        }).sort('created_at', -1))
    
    if normalize_role(current_user.get('role')) == 'ADMIN' and not unassigned_orders:
        unassigned_orders = list(orders_collection.find({
            'assigned_delivery_id': None,
            'status': {'$in': ['CONFIRMED', 'PACKED', 'SHIPPED']}
        }).sort('created_at', -1))

    return {
        'assigned_orders': serialize_orders_batch(my_orders),
        'available_orders': serialize_orders_batch(unassigned_orders),
    }


@app.put('/delivery/orders/{order_id}/self-assign')
@app.post('/delivery/orders/{order_id}/self-assign')
def self_assign_delivery_order(
    order_id: str,
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE', 'ADMIN')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    partner_email = current_user.get('email', '').strip().lower()
    partner_id = current_user.get('id')

    orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'assigned_delivery_id': partner_id,
                'assigned_delivery_partner': partner_email,
                'delivery_meta.assigned_at': now_utc().isoformat(),
                'delivery_meta.assignment_source': 'delivery_self_assign',
            }
        },
    )

    apply_order_status_update(
        order=order,
        next_status='ACCEPTED',
        actor_id=partner_id,
        performer_role=normalize_role(current_user.get('role', 'DELIVERY_ASSOCIATE')),
        performer_email=partner_email,
    )

    shipment_id = order.get('shipment_id')
    if shipment_id:
        shipments_collection.update_one(
            {'shipment_id': shipment_id},
            {
                '$set': {
                    'assigned_partner_id': partner_id,
                    'assigned_partner_email': partner_email,
                    'updated_at': now_utc(),
                }
            },
        )

    return {
        'message': "Order self-assigned and accepted successfully.",
        'order': serialize_order(orders_collection.find_one({'order_id': order_id})),
    }


# --- Operations & Shipments Endpoints to resolve 404 errors ---

class DispatchShipmentRequest(BaseModel):
    current_location: str | None = None


@app.post('/shipments/{shipment_id}/dispatch')
def dispatch_shipment_endpoint(
    shipment_id: str,
    payload: DispatchShipmentRequest | None = None,
    current_user: dict = Depends(get_current_user),
):
    shipment = shipments_collection.find_one({'shipment_id': shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found.")

    actor_id = current_user.get('id')
    role = normalize_role(current_user.get('role', 'CUSTOMER'))
    email = current_user.get('email', 'system@local')

    updated_shipment = transition_shipment_status(
        shipment,
        'DISPATCHED',
        actor_id,
        role,
        email,
        location=(payload.current_location if payload else None),
    )
    return {
        'message': "Shipment dispatched successfully.",
        'shipment': serialize_shipment(updated_shipment),
    }


@app.get('/operations/orders')
def get_operations_orders(
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    orders = list(orders_collection.find({'status': 'CONFIRMED'}).sort('created_at', -1))
    return serialize_orders_batch(orders)


@app.get('/operations/packed-orders')
def get_operations_packed_orders(
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    orders = list(orders_collection.find({'status': 'PACKED'}).sort('created_at', -1))
    return serialize_orders_batch(orders)


@app.get('/operations/shipments')
def get_operations_shipments(
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    shipments = list(shipments_collection.find().sort('created_at', -1))
    return [serialize_shipment(s) for s in shipments]


@app.get('/admin/tracking-logs')
def get_admin_tracking_logs(
    order_id: str,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    logs = get_tracking_logs(order_id)
    return {'logs': logs}