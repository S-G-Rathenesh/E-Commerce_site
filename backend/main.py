import os
import random
import re
from datetime import UTC, datetime, timedelta
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
UPLOAD_ROOT = os.path.join(os.path.dirname(__file__), 'uploads')
UPLOAD_IMAGE_ROOT = os.path.join(UPLOAD_ROOT, 'images')
ALLOWED_IMAGE_CONTENT_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}
MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024

os.makedirs(UPLOAD_IMAGE_ROOT, exist_ok=True)

app.mount('/uploads', StaticFiles(directory=UPLOAD_ROOT), name='uploads')

# WebSocket Manager for Real-Time Order Updates
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
    
    async def broadcast_to_role(self, role: str, message: dict):
        """Broadcast to all users with a specific role"""
        from pymongo import MongoClient
        # This will be implemented after mongo_client is available
        pass

manager = ConnectionManager()

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
    'SHIPPED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
]
SHIPMENT_STATUS_FLOW = ORDER_STATUS_FLOW
SHIPMENT_ENTITY_STATUSES = ['CREATED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED']
DELIVERY_FINAL_STATES = {'OUT_FOR_DELIVERY', 'DELIVERED'}
ORDER_STATUS_TRANSITIONS = {
    'PLACED': {'CONFIRMED', 'REJECTED', 'CANCELLED'},
    'CONFIRMED': {'PACKED'},
    'PACKED': {'SHIPPED'},
    'SHIPPED': {'OUT_FOR_DELIVERY'},
    'OUT_FOR_DELIVERY': {'DELIVERED'},
}
STATUS_PERFORMER_ROLE_MAP = {
    'CONFIRMED': {'ADMIN'},
    'REJECTED': {'ADMIN'},
    'PACKED': {'ADMIN', 'OPERATIONS_STAFF'},
    'SHIPPED': {'ADMIN', 'OPERATIONS_STAFF'},
    'OUT_FOR_DELIVERY': {'DELIVERY_ASSOCIATE'},
    'DELIVERED': {'DELIVERY_ASSOCIATE'},
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


# ============================================================================
# NEW: AMAZON-LIKE SHIPPING SYSTEM MODELS
# ============================================================================

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
    serviceable_pincodes: list[str] | None = None  # CSV or list
    blocked_pincodes: list[str] | None = None


class SavePaymentMethodRequest(BaseModel):
    method_type: str  # UPI, CARD, NETBANKING, WALLET
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
            'service_scope': 'ALL_INDIA',
            'allow_all_india': True,
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
warehouses_collection = database['warehouses']
delivery_coverage_collection = database['delivery_coverage']
payments_collection = database['payments']
returns_collection = database['returns']
notifications_collection = database['notifications']
# NEW: Shipping system collections
merchant_shipping_settings_collection = database['merchant_shipping_settings']
serviceable_pincodes_collection = database['serviceable_pincodes']
blocked_pincodes_collection = database['blocked_pincodes']
pincode_distance_cache_collection = database['pincode_distance_cache']
banners_collection = database['banners']
platform_settings_collection = database['platform_settings']
global_offers_collection = database['global_offers']
database_mode = 'mongo'


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
    global warehouses_collection
    global delivery_coverage_collection
    global payments_collection
    global returns_collection
    global notifications_collection
    global merchant_shipping_settings_collection
    global serviceable_pincodes_collection
    global blocked_pincodes_collection
    global pincode_distance_cache_collection
    global banners_collection
    global platform_settings_collection
    global global_offers_collection
    global database_mode

    # Guard against malformed MONGOMOCK_SERVER_VERSION values that can crash mongomock internals.
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
    warehouses_collection = database['warehouses']
    delivery_coverage_collection = database['delivery_coverage']
    payments_collection = database['payments']
    returns_collection = database['returns']
    notifications_collection = database['notifications']
    # NEW: Shipping system collections
    merchant_shipping_settings_collection = database['merchant_shipping_settings']
    serviceable_pincodes_collection = database['serviceable_pincodes']
    blocked_pincodes_collection = database['blocked_pincodes']
    pincode_distance_cache_collection = database['pincode_distance_cache']
    banners_collection = database['banners']
    platform_settings_collection = database['platform_settings']
    global_offers_collection = database['global_offers']
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


def serialize_product(document: dict) -> dict:
    payload = dict(document)
    payload.pop('_id', None)
    return payload


def normalize_product_stock(value: int | float | str | None, fallback: int = 0) -> int:
    try:
        stock_value = int(float(value))
    except (TypeError, ValueError):
        stock_value = fallback
    return max(stock_value, 0)


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
    return base


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


def append_order_status_history(
    order_id: str,
    status_value: str,
    updated_by: str,
    performer_role: str = 'SYSTEM',
    performer_email: str = 'system@local',
    location: str = '',
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
    }

    order_status_history_collection.insert_one(entry)
    orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                f'status_timestamps.{normalized}': timestamp,
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
    return items


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
        return by_id
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
    """Create notification and emit WebSocket event"""
    normalized_event = str(event_type or '').strip().upper()
    if normalized_event in {'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'}:
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
    
    # Emit WebSocket event if user is connected
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
    """Generate notification title based on event type"""
    titles = {
        'PLACED': '📝 Order Placed',
        'CONFIRMED': '✅ Order Confirmed',
        'PACKED': '📦 Order Packed',
        'SHIPPED': '🚚 Order Shipped',
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
    return ''.join(ch for ch in str(value or '') if ch.isdigit())


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
    return None


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
    if user_location['city'] == warehouse['city'] and user_location['state'] == warehouse['state']:
        return 0
    if user_location['state'] == warehouse['state']:
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

    ranked = sorted(
        candidates,
        key=lambda warehouse: (
            delivery_bucket(user_location, warehouse),
            abs(int(user_location['pincode'][:3]) - int(str(warehouse['pincode'])[:3])),
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
    destination_pincode = sanitize_pincode(order.get('destination_pincode', ''))
    if not is_valid_indian_pincode(destination_pincode):
        destination_pincode = '560001'
    return get_location_for_pincode(destination_pincode)


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
    partners = list(
        users_collection.find(
            {'role': 'DELIVERY_ASSOCIATE', 'status': 'ACTIVE'},
            {'_id': 0, 'id': 1, 'email': 1, 'profile_details': 1, 'city': 1, 'state': 1},
        )
    )
    if not partners:
        return None, None

    for partner in partners:
        if is_demo_delivery_partner_account(partner):
            ensure_demo_partner_service_sync(partner, destination, destination_pincode)

    workload_map = get_delivery_partner_workload()
    ranked = sorted(
        partners,
        key=lambda partner: score_delivery_partner(partner, destination, destination_pincode, workload_map),
        reverse=True,
    )
    selected = ranked[0]
    if score_delivery_partner(selected, destination, destination_pincode, workload_map) <= -10_000:
        return None, None
    selected_id = str(selected.get('id') or '').strip() or None
    selected_email = str(selected.get('email') or '').strip().lower() or None
    return selected_id, selected_email


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
            # Existing indexes in live DB can differ by options (e.g., unique). Ignore conflict and continue.
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

        payload['merchant_id'] = str(payload.get('merchant_id') or 'USR-DEMO-ADMIN-01').strip() or 'USR-DEMO-ADMIN-01'
        payload['review_status'] = normalize_product_review_status(payload.get('review_status', 'APPROVED'))

        products_collection.update_one(
            {'id': product_id},
            {
                '$set': payload,
                '$setOnInsert': {'created_at': now_utc()},
            },
            upsert=True,
        )


def seed_users() -> None:
    for _, account in SEED_USERS.items():
        email = account['email'].strip().lower()
        profile_details = account.get('profile_details') if isinstance(account.get('profile_details'), dict) else {}
        bank_details = profile_details.get('bank_details') if isinstance(profile_details.get('bank_details'), dict) else {}
        users_collection.update_one(
            {'email': email},
            {
                '$set': {
                    'id': account.get('id') or f"USR-{uuid4().hex[:10].upper()}",
                    'name': account['full_name'],
                    'full_name': account['full_name'],
                    'email': email,
                    'provider': account.get('provider', 'email'),
                    'role': normalize_role(account.get('role', 'CUSTOMER')),
                    'status': normalize_account_status(account.get('status', 'ACTIVE')),
                    'merchant_status': normalize_merchant_status(
                        account.get('merchant_status', 'APPROVED' if normalize_role(account.get('role', 'CUSTOMER')) == 'ADMIN' else 'PENDING')
                    ),
                    'phone_number': str(account.get('phone_number') or '').strip(),
                    'profile_details': {
                        'store_name': str(profile_details.get('store_name') or '').strip(),
                        'gst_number': str(profile_details.get('gst_number') or '').strip(),
                        'logo_url': str(profile_details.get('logo_url') or '').strip(),
                        'bank_details': {
                            'account_holder_name': str(bank_details.get('account_holder_name') or '').strip(),
                            'bank_name': str(bank_details.get('bank_name') or '').strip(),
                            'account_number': str(bank_details.get('account_number') or '').strip(),
                            'ifsc_code': str(bank_details.get('ifsc_code') or '').strip(),
                        },
                    },
                    'password_hash': hash_password(account['password']),
                    'updated_at': now_utc(),
                },
                '$unset': {'password': ''},
                '$setOnInsert': {'created_at': now_utc()},
            },
            upsert=True,
        )


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
        {'role': {'$nin': ['ADMIN', 'MERCHANT']}, 'merchant_status': {'$exists': False}},
        {'$set': {'merchant_status': 'PENDING', 'updated_at': now_utc()}},
    )


def backfill_product_review_status() -> None:
    products_collection.update_many(
        {'review_status': {'$exists': False}},
        {'$set': {'review_status': 'APPROVED', 'updated_at': now_utc()}},
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
        order_payload = dict(order)
        order_created_at = order_payload.pop('created_at', None)
        orders_collection.update_one(
            {'order_id': order['order_id']},
            {'$set': order_payload, '$setOnInsert': {'created_at': order_created_at or now_utc()}},
            upsert=True,
        )


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
    projection = {'_id': 1, 'order_id': 1, 'status': 1, 'payment_method': 1, 'status_timestamps': 1}
    for order in orders_collection.find({}, projection):
        order_id = order.get('order_id')
        if not order_id:
            continue

        normalized_status = normalize_order_status(order.get('status', 'PLACED'))
        existing_timestamps = order.get('status_timestamps') or {}
        if not isinstance(existing_timestamps, dict):
            existing_timestamps = {}
        if normalized_status not in existing_timestamps:
            existing_timestamps[normalized_status] = now_utc().isoformat()

        payment_method = normalize_payment_method(order.get('payment_method') or 'COD')

        orders_collection.update_one(
            {'_id': order['_id']},
            {
                '$set': {
                    'status': normalized_status,
                    'status_timestamps': existing_timestamps,
                    'payment_method': payment_method,
                    'updated_at': now_utc(),
                }
            },
        )

        if payments_collection.count_documents({'order_id': order_id}) == 0:
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

        existing = merchant_shipping_settings_collection.find_one({'merchant_id': normalized_merchant_id}, {'_id': 1})
        if existing:
            continue

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

        serviceable = parse_serviceable_pincodes(settings.get('serviceable_pincodes') or [])
        blocked = parse_serviceable_pincodes(settings.get('blocked_pincodes') or [])

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
    seed_products()
    seed_users()
    seed_platform_defaults()
    backfill_merchant_statuses()
    backfill_product_merchant_ids()
    backfill_product_review_status()
    seed_shipments()
    seed_orders()
    seed_warehouses()
    backfill_product_warehouses()
    backfill_user_auth_shape()
    backfill_nationwide_delivery_coverage()
    seed_demo_merchant_shipping_settings()
    backfill_order_items_and_logs()
    backfill_orders_workflow_state()
    backfill_demo_seed_tracking_state()


# ============================================================================
# SHIPPING SYSTEM HELPERS
# ============================================================================

PINCODE_DISTANCE_CACHE = {}  # Simple in-memory cache for pincode distances


def sanitize_pincode(value: str) -> str:
    """Extract only digits from pincode input."""
    cleaned = ''.join(ch for ch in str(value or '').strip() if ch.isdigit())
    return cleaned[:6] if cleaned else ''


def parse_serviceable_pincodes(value: str | list) -> list[str]:
    """Parse pincode input (CSV string or list) and return valid pincodes."""
    if isinstance(value, list):
        pincodes = value
    else:
        pincodes = [p.strip() for p in str(value or '').split(',')]
    
    result = []
    for p in pincodes:
        cleaned = sanitize_pincode(p)
        if len(cleaned) == 6:
            result.append(cleaned)
    return result


def calculate_distance(pincode1: str, pincode2: str) -> float:
    """
    Calculate approximate distance between two pincodes using simple mapping.
    Uses cached values or internal pincode mapping table.
    
    In production, integrate Google Maps or OpenRoute API.
    """
    cache_key = f"{pincode1}:{pincode2}"
    if cache_key in PINCODE_DISTANCE_CACHE:
        return PINCODE_DISTANCE_CACHE[cache_key]
    
    # Reverse lookup also
    reverse_key = f"{pincode2}:{pincode1}"
    if reverse_key in PINCODE_DISTANCE_CACHE:
        return PINCODE_DISTANCE_CACHE[reverse_key]
    
    # Simple approximation: use pincode prefix as rough geography
    prefix1 = int(pincode1[:2]) if len(pincode1) >= 2 else 0
    prefix2 = int(pincode2[:2]) if len(pincode2) >= 2 else 0
    
    # Rough distance: difference in prefix * 100 km per state
    distance = abs(prefix1 - prefix2) * 100
    if distance == 0:
        distance = 10  # Same state, assume ~10km average
    
    PINCODE_DISTANCE_CACHE[cache_key] = float(distance)
    return float(distance)


def calculate_delivery_charge(
    distance_km: float,
    order_total: float,
) -> float:
    """Calculate the final customer-facing delivery charge."""
    return 0.0 if order_total >= 500 else 49.0


def estimate_delivery_timeframe(distance_km: float) -> tuple[int, int]:
    """Estimate delivery days based on distance."""
    if distance_km <= 50:
        return (1, 2)  # 1-2 days
    elif distance_km <= 200:
        return (2, 4)  # 2-4 days
    else:
        return (4, 7)  # 4-7 days


def is_pincode_serviceable(
    customer_pincode: str,
    merchant_id: str,
    allow_all_india: bool = True,
) -> bool:
    """Check if customer pincode is serviceable by merchant."""
    customer_pincode = sanitize_pincode(customer_pincode)
    if not customer_pincode:
        return False
    
    # Check blocked pincodes first
    if blocked_pincodes_collection.find_one({'merchant_id': merchant_id, 'pincode': customer_pincode}):
        return False
    
    # Check allow_all_india flag
    if allow_all_india:
        return True  # Serve all of India except blocked
    
    # Check serviceable pincodes list
    return bool(
        serviceable_pincodes_collection.find_one({'merchant_id': merchant_id, 'pincode': customer_pincode})
    )


def get_merchant_shipping_settings(merchant_id: str) -> dict | None:
    """Retrieve merchant shipping settings."""
    return merchant_shipping_settings_collection.find_one(
        {'merchant_id': merchant_id},
        {'_id': 0},
    )


@app.on_event('startup')
def ensure_database_ready() -> None:
    try:
        mongo_client.admin.command('ping')
        ensure_indexes()
        seed_collections()
    except (ConfigurationError, PyMongoError) as exc:
        if mongo_enable_fallback:
            activate_in_memory_database(str(exc))
            ensure_indexes()
            seed_collections()
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
    if account_status != 'ACTIVE':
        detail = 'Your account is pending approval' if account_status == 'PENDING' else 'Account is blocked. Please contact support.'
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

    return account


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

    base_url = str(request.base_url).rstrip('/')
    image_url = f'{base_url}/uploads/images/{file_name}'
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
    if account_status != 'ACTIVE':
        detail = 'Your account is pending approval' if account_status == 'PENDING' else 'Account is blocked. Please contact support.'
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

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
    merchant_id = get_default_merchant_id()
    if not merchant_id:
        return []

    products = list(
        products_collection.find(
            {'merchant_id': merchant_id, 'review_status': 'APPROVED'},
            {'_id': 0},
        )
    )
    return [serialize_product(product) for product in products]


@app.get('/product/{product_id}')
def get_product(product_id: int):
    merchant_id = get_default_merchant_id()
    if not merchant_id:
        return {'error': 'Product not found'}

    product = products_collection.find_one(
        {'id': product_id, 'merchant_id': merchant_id, 'review_status': 'APPROVED'},
        {'_id': 0},
    )
    if not product:
        return {'error': 'Product not found'}
    return serialize_product(product)


@app.get('/merchant/products')
def get_merchant_products(current_user: dict = Depends(require_roles('ADMIN'))):
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        return []

    products = list(
        products_collection.find(
            {'merchant_id': merchant_id},
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
    product['review_status'] = 'PENDING'
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

    existing_product = products_collection.find_one({'id': product_id, 'merchant_id': merchant_id}, {'_id': 0})
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
    product['merchant_id'] = merchant_id
    product['updated_at'] = now_utc()
    products_collection.update_one(
        {'id': product_id, 'merchant_id': merchant_id},
        {'$set': product},
    )

    updated = products_collection.find_one({'id': product_id, 'merchant_id': merchant_id}, {'_id': 0})
    return {'message': 'Product updated successfully.', 'product': serialize_product(updated)}


@app.delete('/merchant/products/{product_id}')
def delete_merchant_product(product_id: int, current_user: dict = Depends(require_roles('ADMIN'))):
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        raise HTTPException(status_code=400, detail='Merchant account is missing an id.')

    result = products_collection.delete_one({'id': product_id, 'merchant_id': merchant_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail='Product not found.')

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
    if account_status == 'PENDING':
        raise HTTPException(status_code=403, detail='Your account is pending approval')
    if account_status == 'BLOCKED':
        raise HTTPException(status_code=403, detail='Account is blocked. Please contact support.')

    role = normalize_role(account.get('role', 'CUSTOMER'))
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
    account_status = (
        'PENDING' if normalized_role in {'DELIVERY_ASSOCIATE', 'OPERATIONS_STAFF', 'ADMIN'} else 'ACTIVE'
    )
    merchant_status = 'PENDING' if normalized_role == 'ADMIN' else 'PENDING'

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

    return {
        'message': (
            'Your account will be activated after verification'
            if account_status == 'PENDING'
            else f"Account created for {account['full_name']}."
        ),
        'role': account['role'],
        'status': account_status,
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


@app.put('/api/merchant/profile')
def update_merchant_profile(
    payload: MerchantProfileUpdateRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'MERCHANT')),
):
    """Update merchant profile details (store info, phone, banking details)"""
    user_id = current_user.get('id')
    email = current_user.get('email', '').strip().lower()

    # Get current user document
    user = users_collection.find_one({'$or': [{'id': user_id}, {'email': email}]})
    if not user:
        raise HTTPException(status_code=404, detail='User not found.')

    # Merge profile details
    current_profile_details = user.get('profile_details', {}) or {}
    if payload.profile_details:
        current_profile_details.update(payload.profile_details)

    # Add phone number if provided
    if payload.phone_number:
        current_profile_details['phone_number'] = payload.phone_number.strip()

    # Merge bank details
    if payload.bank_details:
        current_bank_details = current_profile_details.get('bank_details', {}) or {}
        current_bank_details.update(payload.bank_details)
        current_profile_details['bank_details'] = current_bank_details

    # Update user document
    result = users_collection.update_one(
        {'id': user_id},
        {
            '$set': {
                'profile_details': current_profile_details,
                'updated_at': now_utc(),
            }
        },
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=400, detail='Failed to update profile.')

    # Return updated user
    updated_user = users_collection.find_one({'id': user_id})
    return {
        'message': 'Merchant profile updated successfully.',
        'user': serialize_user(updated_user),
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


# ============================================================================
# NEW: AMAZON-LIKE SHIPPING SYSTEM ENDPOINTS
# ============================================================================

@app.get('/admin/shipping-settings')
def get_merchant_shipping_config(current_user: dict = Depends(require_roles('ADMIN', 'MERCHANT'))):
    """Retrieve merchant shipping configuration."""
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        raise HTTPException(status_code=400, detail='Unable to resolve merchant ID.')
    
    settings = get_merchant_shipping_settings(merchant_id)
    if not settings:
        # Return default empty config
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
    
    # Count pincodes
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
    
    # Validate warehouse pincode
    warehouse_pincode = sanitize_pincode(payload.warehouse.pincode)
    if len(warehouse_pincode) != 6:
        raise HTTPException(status_code=400, detail='Warehouse pincode must be 6 digits.')
    
    # Validate pricing
    if payload.distance_pricing.base_charge < 0 or payload.distance_pricing.per_km_rate < 0:
        raise HTTPException(status_code=400, detail='Charges cannot be negative.')
    
    # Save main settings
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
    
    # Update serviceable pincodes
    if not payload.allow_all_india and payload.serviceable_pincodes:
        valid_pincodes = parse_serviceable_pincodes(payload.serviceable_pincodes)
        serviceable_pincodes_collection.delete_many({'merchant_id': merchant_id})
        if valid_pincodes:
            serviceable_pincodes_collection.insert_many([
                {'merchant_id': merchant_id, 'pincode': p, 'created_at': now}
                for p in valid_pincodes
            ])
    
    # Update blocked pincodes
    if payload.blocked_pincodes:
        valid_blocked = parse_serviceable_pincodes(payload.blocked_pincodes)
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
    current_user: dict = Depends(get_current_user),
):
    """
    Check delivery serviceability for a customer pincode.
    
    Returns:
    - is_serviceable: bool
    - estimated_days: str (e.g., "2-4 days")
    - delivery_charge: float
    - cod_available: bool
    """
    role = normalize_role(current_user.get('role', 'CUSTOMER'))
    merchant_id = str(current_user.get('id') or '').strip() if role in {'ADMIN', 'MERCHANT'} else ''
    if not merchant_id:
        merchant_id = get_default_merchant_id()
    
    if not merchant_id:
        raise HTTPException(status_code=400, detail='No merchant found.')
    
    customer_pincode = sanitize_pincode(customer_pincode)
    if len(customer_pincode) != 6:
        raise HTTPException(status_code=400, detail='Invalid customer pincode.')
    
    # Get settings
    settings = get_merchant_shipping_settings(merchant_id)
    if not settings:
        return {
            'is_serviceable': False,
            'estimated_days': 'Not available',
            'delivery_charge': 0,
            'cod_available': False,
            'error': 'Shipping settings not configured.',
        }
    
    # Check serviceability
    is_serviceable = is_pincode_serviceable(
        customer_pincode,
        merchant_id,
        settings.get('allow_all_india', True),
    )
    
    if not is_serviceable:
        return {
            'is_serviceable': False,
            'estimated_days': 'Not available',
            'delivery_charge': 0,
            'cod_available': False,
        }
    
    # Calculate distance and delivery charge
    warehouse_pincode = settings['warehouse']['pincode']
    distance = calculate_distance(warehouse_pincode, customer_pincode)
    
    delivery_charge = calculate_delivery_charge(
        distance,
        float(order_total or 0),
    )
    
    # Estimate delivery timeframe
    min_days, max_days = estimate_delivery_timeframe(distance)
    estimated_days = f'{min_days}-{max_days} days'
    
    # Check COD availability
    cod_available = settings['cod_rules']['cod_enabled']
    
    return {
        'is_serviceable': True,
        'estimated_days': estimated_days,
        'delivery_charge': delivery_charge,
        'free_delivery_threshold': 500,
        'standard_delivery_charge': 49,
        'cod_available': cod_available,
        'distance_km': round(distance, 2),
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

    if target_status in {'REJECTED', 'CANCELLED'} and current_status != 'PLACED':
        raise HTTPException(status_code=400, detail=f'{target_status} is only allowed when the order is PLACED.')

    if allowed_roles and normalized_role not in allowed_roles:
        allowed_roles_text = ', '.join(sorted(role.replace('_', ' ').lower() for role in allowed_roles))
        raise HTTPException(
            status_code=403,
            detail=f'Only {allowed_roles_text} can set {target_status}.',
        )

    if current_status != target_status and not can_progress_order(current_status, target_status):
        raise HTTPException(
            status_code=400,
            detail=f'Invalid status transition. Allowed next status from {current_status} is {ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.index(current_status) + 1] if current_status != ORDER_STATUS_FLOW[-1] else current_status}.',
        )

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
    
    # Create notification with title
    message = get_status_message(target_status)
    create_notification(
        event_type=target_status,
        order_id=order['order_id'],
        message=message,
        user_id=customer_id,
    )
    
    # Emit WebSocket event for real-time update
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
    return latest


def get_status_message(status: str) -> str:
    """Get customer-friendly message for status"""
    messages = {
        'PLACED': 'Your order has been placed successfully! 📝',
        'CONFIRMED': 'Your order is confirmed! ✅',
        'PACKED': 'Your order is being packed. 📦',
        'SHIPPED': 'Your order has been shipped! 🚚',
        'OUT_FOR_DELIVERY': 'Your order is out for delivery! 📍',
        'DELIVERED': 'Your order has been delivered successfully! 🎉',
        'REJECTED': 'Your order has been rejected by the merchant.',
        'CANCELLED': 'Your order has been cancelled.',
        'DELIVERY_FAILED': 'Delivery attempt failed. We will try again soon.',
    }
    return messages.get(status, f'Order status updated to {status.replace("_", " ")}')


@app.post('/orders')
def create_order(payload: CreateOrderRequest, current_user: dict = Depends(require_roles('CUSTOMER'))):
    if not payload.items:
        raise HTTPException(status_code=400, detail='At least one order item is required.')

    cleaned_pincode = sanitize_pincode(payload.pincode)
    if not is_valid_indian_pincode(cleaned_pincode):
        raise HTTPException(status_code=400, detail='Please enter a valid 6-digit Indian pincode.')

    total_amount = 0.0
    materialized_items = []
    for request_item in payload.items:
        if request_item.quantity <= 0:
            raise HTTPException(status_code=400, detail='Quantity must be greater than 0.')
        product = products_collection.find_one({'id': request_item.product_id}, {'_id': 0})
        product_exists = bool(product)
        if not product:
            product = {
                'id': request_item.product_id,
                'name': request_item.name or f'Product {request_item.product_id}',
                'price': float(request_item.price or 0),
            }

        line_total = float(product.get('price', 0)) * int(request_item.quantity)
        total_amount += line_total
        materialized_items.append(
            {
                'product_id': request_item.product_id,
                'quantity': int(request_item.quantity),
                'name': product.get('name', 'Product'),
                'price': float(product.get('price', 0)),
                'product_exists': product_exists,
            }
        )

    first_product_id = next((item['product_id'] for item in materialized_items if item.get('product_exists')), materialized_items[0]['product_id'])
    user_location = get_location_for_pincode(cleaned_pincode)
    selected_warehouse = choose_best_warehouse(first_product_id, user_location)

    shipping_payload = payload.shipping_details or {}
    shipping_details = {
        'full_name': str(shipping_payload.get('full_name') or current_user.get('full_name') or current_user.get('name') or '').strip(),
        'phone': sanitize_phone_number(str(shipping_payload.get('phone') or current_user.get('phone_number') or '').strip()),
        'city': str(shipping_payload.get('city') or user_location.get('city') or '').strip(),
        'address': str(shipping_payload.get('address') or '').strip(),
        'pincode': cleaned_pincode,
    }

    order_id = f"ORD-{uuid4().hex[:10].upper()}"
    raw_payment_method = str(payload.payment_method or 'COD').strip().upper()
    if raw_payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail='Unsupported payment method.')
    payment_method = normalize_payment_method(raw_payment_method)

    payment_details = sanitize_payment_details(payment_method, payload.payment_details)

    order_document = {
        'id': order_id,
        'order_id': order_id,
        'user_id': current_user.get('id') or current_user.get('email'),
        'customer_email': current_user.get('email', '').strip().lower(),
        'total_amount': round(total_amount, 2),
        'status': 'PLACED',
        'status_timestamps': build_initial_status_timestamps('PLACED'),
        'assigned_delivery_id': None,
        'assigned_delivery_partner': None,
        'warehouse_id': selected_warehouse.get('warehouse_id'),
        'shipment_id': None,
        'destination_pincode': cleaned_pincode,
        'shipping_details': shipping_details,
        'payment_method': payment_method,
        'updated_by': current_user.get('id') or current_user.get('email'),
        'updated_by_role': 'CUSTOMER',
        'updated_by_email': current_user.get('email', '').strip().lower(),
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    orders_collection.insert_one(order_document)

    for item in materialized_items:
        order_items_collection.insert_one(
            {
                'id': f"OI-{uuid4().hex[:12].upper()}",
                'order_id': order_id,
                'product_id': item['product_id'],
                'quantity': item['quantity'],
            }
        )

    append_order_status_history(
        order_id,
        'PLACED',
        current_user.get('id') or current_user.get('email', 'customer'),
        performer_role='CUSTOMER',
        performer_email=current_user.get('email', '').strip().lower(),
        location='Order placed',
    )
    append_delivery_log(order_id, 'PLACED', current_user.get('id') or current_user.get('email', 'customer'))

    # Notify merchant/admin channels about newly placed orders for real-time dashboard sync.
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            order_created_event = {
                'type': 'order_created',
                'data': {
                    'order_id': order_id,
                    'status': 'PLACED',
                    'customer_email': current_user.get('email', '').strip().lower(),
                    'created_at': now_utc().isoformat(),
                },
            }
            for merchant_id in get_active_registered_merchant_ids():
                asyncio.create_task(manager.broadcast_to_user(merchant_id, order_created_event))
    except:
        pass

    create_notification(
        event_type='ORDER_PLACED',
        order_id=order_id,
        message=f'Order {order_id} placed successfully.',
        user_id=str(current_user.get('id') or current_user.get('email') or ''),
    )

    if payment_method in ONLINE_PAYMENT_METHODS:
        online_status = 'SUCCESS' if random.random() >= 0.15 else 'FAILED'
        set_payment_status(order_id, online_status, method=payment_method, payment_details=payment_details)
        if online_status == 'SUCCESS':
            create_notification(
                event_type='PAYMENT_SUCCESS',
                order_id=order_id,
                message=f'Payment received for order {order_id}. Awaiting merchant confirmation.',
                user_id=str(current_user.get('id') or current_user.get('email') or ''),
            )
        else:
            create_notification(
                event_type='PAYMENT_FAILED',
                order_id=order_id,
                message=f'Payment failed for order {order_id}.',
                user_id=str(current_user.get('id') or current_user.get('email') or ''),
            )
    else:
        set_payment_status(order_id, 'PENDING', method='COD', payment_details=payment_details)
        create_notification(
            event_type='PLACED',
            order_id=order_id,
            message=f'Order {order_id} placed successfully and is awaiting merchant confirmation.',
            user_id=str(current_user.get('id') or current_user.get('email') or ''),
        )

    latest = orders_collection.find_one({'order_id': order_id})
    return {'message': 'Order placed successfully.', 'order': serialize_order(latest, include_shipment=True)}


@app.get('/orders/my')
def get_my_orders(current_user: dict = Depends(require_roles('CUSTOMER'))):
    user_id = current_user.get('id')
    email = current_user['email'].strip().lower()
    orders = list(
        orders_collection.find(
            {'$or': [{'user_id': user_id}, {'user_id': email}, {'customer_email': email}]}
        ).sort('created_at', -1)
    )
    payload = [serialize_order(order, include_shipment=True) for order in orders]
    return {'orders': payload, 'timeline_steps': ORDER_STATUS_FLOW}


@app.get('/orders/{order_id}')
def get_order_by_id(order_id: str, current_user: dict = Depends(get_current_user)):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    actor_role = normalize_role(current_user.get('role', 'CUSTOMER'))
    actor_email = str(current_user.get('email', '')).strip().lower()
    actor_id = str(current_user.get('id', '')).strip()
    is_owner = order.get('customer_email') == actor_email or order.get('user_id') in {actor_id, actor_email}
    is_delivery_assignee = order.get('assigned_delivery_partner') == actor_email or order.get('assigned_delivery_id') == actor_id
    if actor_role == 'CUSTOMER' and not is_owner:
        raise HTTPException(status_code=403, detail='Access denied.')
    if actor_role == 'DELIVERY_ASSOCIATE' and not is_delivery_assignee:
        raise HTTPException(status_code=403, detail='Access denied.')

    return {'order': serialize_order(order, include_shipment=True)}


@app.websocket('/ws/orders/{user_id}')
async def websocket_order_updates(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time order status updates"""
    try:
        await manager.connect(user_id, websocket)
        # Keep connection open and listen for client messages
        while True:
            data = await websocket.receive_text()
            # Optional: handle ping/pong or custom messages from client
            if data == 'ping':
                await websocket.send_json({'type': 'pong'})
    except WebSocketDisconnect:
        await manager.disconnect(user_id, websocket)
    except Exception as e:
        try:
            await manager.disconnect(user_id, websocket)
        except:
            pass


@app.get('/orders/{order_id}/tracking-status')
def get_order_tracking_status(order_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed order tracking information with status history"""
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')
    
    # Verify access
    actor_email = str(current_user.get('email', '')).strip().lower()
    actor_id = str(current_user.get('id', '')).strip()
    actor_role = normalize_role(current_user.get('role', 'CUSTOMER'))
    
    is_owner = order.get('customer_email') == actor_email or order.get('user_id') in {actor_id, actor_email}
    is_delivery_assignee = order.get('assigned_delivery_partner') == actor_email or order.get('assigned_delivery_id') == actor_id
    is_staff = actor_role in {'ADMIN', 'OPERATIONS_STAFF', 'MERCHANT'}
    
    if actor_role == 'CUSTOMER' and not is_owner:
        raise HTTPException(status_code=403, detail='Access denied.')
    if actor_role == 'DELIVERY_ASSOCIATE' and not is_delivery_assignee and not is_staff:
        raise HTTPException(status_code=403, detail='Access denied.')
    
    # Get status history from the dedicated history collection.
    status_history = get_order_status_history(order_id)
    
    # Get delivery logs
    delivery_logs = list(delivery_logs_collection.find({'order_id': order_id}).sort('timestamp', 1))
    
    return {
        'order_id': order_id,
        'current_status': normalize_order_status(order.get('status', 'PLACED')),
        'updated_by_role': order.get('updated_by_role'),
        'updated_by_email': order.get('updated_by_email'),
        'status_history': [
            {
                'id': h.get('id'),
                'status': h.get('status'),
                'timestamp': h.get('timestamp'),
                'updated_by': h.get('updated_by'),
                'updated_by_role': h.get('updated_by_role'),
                'updated_by_email': h.get('updated_by_email'),
                'location': h.get('location'),
            }
            for h in status_history
        ],
        'delivery_logs': [
            {
                'id': log.get('id'),
                'status': log.get('status'),
                'timestamp': log.get('timestamp').isoformat() if isinstance(log.get('timestamp'), datetime) else log.get('timestamp'),
                'updated_by': log.get('updated_by'),
                'performer_role': log.get('performer_role'),
                'performer_email': log.get('performer_email'),
                'location': log.get('location'),
            }
            for log in delivery_logs
        ],
        'status_timeline_steps': ORDER_STATUS_FLOW,
        'created_at': order.get('created_at').isoformat() if isinstance(order.get('created_at'), datetime) else order.get('created_at'),
        'updated_at': order.get('updated_at').isoformat() if isinstance(order.get('updated_at'), datetime) else order.get('updated_at'),
    }


@app.put('/orders/{order_id}/status')
def update_order_status(
    order_id: str,
    payload: UpdateOrderStatusRequest,
    current_user: dict = Depends(get_current_user),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    actor_role = normalize_role(current_user.get('role', 'CUSTOMER'))
    target_status = normalize_order_status(payload.status)
    actor_id = current_user.get('id') or current_user.get('email', 'system')
    performer_email = current_user.get('email', 'system@local').strip().lower()

    if target_status not in STATUS_PERFORMER_ROLE_MAP:
        raise HTTPException(status_code=403, detail='Only staff can update order statuses.')

    if actor_role == 'DELIVERY_ASSOCIATE' and order.get('assigned_delivery_id') not in {current_user.get('id'), None} and order.get('assigned_delivery_partner') != current_user.get('email', '').strip().lower():
        raise HTTPException(status_code=403, detail='Order is not assigned to this delivery partner.')

    latest = apply_order_status_update(
        order, 
        target_status, 
        str(actor_id),
        location=(payload.current_location or '').strip(),
        performer_role=actor_role,
        performer_email=performer_email
    )
    return {'message': f'Order moved to {target_status}.', 'order': serialize_order(latest, include_shipment=True)}


@app.patch('/orders/{order_id}/confirm')
def confirm_order(
    order_id: str,
    payload: OrderActionRequest | None = None,
    current_user: dict = Depends(require_roles('ADMIN')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    location_value = (payload.current_location if payload and payload.current_location else 'Merchant confirmation').strip() if payload else 'Merchant confirmation'
    latest = apply_order_status_update(
        order,
        'CONFIRMED',
        str(current_user.get('id') or current_user.get('email', 'merchant')),
        location=location_value or 'Merchant confirmation',
        performer_role=normalize_role(current_user.get('role', 'ADMIN')),
        performer_email=str(current_user.get('email', 'system@local')).strip().lower(),
    )
    return {'message': 'Order confirmed.', 'order': serialize_order(latest, include_shipment=True)}


@app.patch('/orders/{order_id}/reject')
def reject_order(
    order_id: str,
    payload: OrderActionRequest | None = None,
    current_user: dict = Depends(require_roles('ADMIN')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    location_value = (payload.current_location if payload and payload.current_location else 'Merchant rejection').strip() if payload else 'Merchant rejection'
    latest = apply_order_status_update(
        order,
        'REJECTED',
        str(current_user.get('id') or current_user.get('email', 'merchant')),
        location=location_value or 'Merchant rejection',
        performer_role=normalize_role(current_user.get('role', 'ADMIN')),
        performer_email=str(current_user.get('email', 'system@local')).strip().lower(),
    )
    orders_collection.update_one(
        {'order_id': order_id},
        {'$set': {'rejection_reason': str(payload.reason if payload and payload.reason else '').strip(), 'updated_at': now_utc()}},
    )
    return {'message': 'Order rejected.', 'order': serialize_order(latest, include_shipment=True)}


@app.patch('/orders/{order_id}/pack')
def pack_order(
    order_id: str,
    payload: OrderActionRequest | None = None,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    location_value = (payload.current_location if payload and payload.current_location else 'Warehouse packing unit').strip() if payload else 'Warehouse packing unit'
    latest = apply_order_status_update(
        order,
        'PACKED',
        str(current_user.get('id') or current_user.get('email', 'ops')),
        location=location_value or 'Warehouse packing unit',
        performer_role=normalize_role(current_user.get('role', 'OPERATIONS_STAFF')),
        performer_email=str(current_user.get('email', 'system@local')).strip().lower(),
    )
    return {'message': 'Order packed.', 'order': serialize_order(latest, include_shipment=True)}


@app.patch('/orders/{order_id}/ship')
def ship_order(
    order_id: str,
    payload: ShipmentUpdateRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    shipment_id = order.get('shipment_id') or f'SHP-{uuid4().hex[:10].upper()}'
    shipments_collection.update_one(
        {'shipment_id': shipment_id},
        {
            '$set': {
                'id': shipment_id,
                'shipment_id': shipment_id,
                'warehouse_id': order.get('warehouse_id'),
                'courier_name': payload.courier_name.strip(),
                'tracking_id': payload.tracking_id.strip() or f'TRK-{uuid4().hex[:12].upper()}',
                'status': 'DISPATCHED',
                'current_location': payload.current_location.strip() or 'Warehouse',
                'updated_at': now_utc(),
            },
            '$setOnInsert': {'created_at': now_utc()},
        },
        upsert=True,
    )

    latest = apply_order_status_update(
        order,
        'SHIPPED',
        str(current_user.get('id') or current_user.get('email', 'ops')),
        location=payload.current_location.strip() or 'Warehouse dispatch',
        performer_role=normalize_role(current_user.get('role', 'OPERATIONS_STAFF')),
        performer_email=str(current_user.get('email', 'system@local')).strip().lower(),
    )
    orders_collection.update_one(
        {'order_id': order_id},
        {'$set': {'shipment_id': shipment_id, 'updated_at': now_utc()}},
    )
    latest = orders_collection.find_one({'order_id': order_id}) or latest
    return {'message': 'Order shipped.', 'order': serialize_order(latest, include_shipment=True)}


@app.patch('/orders/{order_id}/out-for-delivery')
def mark_out_for_delivery(
    order_id: str,
    payload: OrderActionRequest | None = None,
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    if order.get('assigned_delivery_id') not in {current_user.get('id'), None} and order.get('assigned_delivery_partner') != str(current_user.get('email', '')).strip().lower():
        raise HTTPException(status_code=403, detail='Order is not assigned to this delivery partner.')

    current_status = normalize_order_status(order.get('status', 'PLACED'))
    if current_status == 'OUT_FOR_DELIVERY':
        raise HTTPException(status_code=409, detail='Order is already out for delivery.')
    if current_status != 'SHIPPED':
        raise HTTPException(status_code=400, detail='Order can only move to out for delivery from SHIPPED status.')

    location_value = (payload.current_location if payload and payload.current_location else 'Last mile route').strip() if payload else 'Last mile route'
    latest = apply_order_status_update(
        order,
        'OUT_FOR_DELIVERY',
        str(current_user.get('id') or current_user.get('email', 'delivery')),
        location=location_value or 'Last mile route',
        performer_role='DELIVERY_ASSOCIATE',
        performer_email=str(current_user.get('email', 'system@local')).strip().lower(),
    )
    orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'delivery_meta.out_for_delivery_at': now_utc().isoformat(),
                'delivery_meta.last_action': 'OUT_FOR_DELIVERY',
                'updated_at': now_utc(),
            }
        },
    )
    latest = orders_collection.find_one({'order_id': order_id}) or latest
    return {'message': 'Order marked out for delivery.', 'order': serialize_order(latest, include_shipment=True)}


@app.patch('/orders/{order_id}/deliver')
def mark_delivered(
    order_id: str,
    payload: OrderActionRequest | None = None,
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    if order.get('assigned_delivery_id') not in {current_user.get('id'), None} and order.get('assigned_delivery_partner') != str(current_user.get('email', '')).strip().lower():
        raise HTTPException(status_code=403, detail='Order is not assigned to this delivery partner.')

    current_status = normalize_order_status(order.get('status', 'PLACED'))
    if current_status == 'DELIVERED':
        raise HTTPException(status_code=409, detail='Order is already delivered.')
    if current_status != 'OUT_FOR_DELIVERY':
        raise HTTPException(status_code=400, detail='Order can only be delivered from OUT_FOR_DELIVERY status.')

    location_value = (payload.current_location if payload and payload.current_location else 'Customer address').strip() if payload else 'Customer address'
    latest = apply_order_status_update(
        order,
        'DELIVERED',
        str(current_user.get('id') or current_user.get('email', 'delivery')),
        location=location_value or 'Customer address',
        performer_role='DELIVERY_ASSOCIATE',
        performer_email=str(current_user.get('email', 'system@local')).strip().lower(),
    )
    orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'delivery_meta.delivered_at': now_utc().isoformat(),
                'delivery_meta.last_action': 'DELIVERED',
                'updated_at': now_utc(),
            }
        },
    )
    latest = orders_collection.find_one({'order_id': order_id}) or latest
    return {'message': 'Order delivered.', 'order': serialize_order(latest, include_shipment=True)}


@app.post('/orders/{order_id}/delivered')
def mark_delivered_alias(
    order_id: str,
    payload: OrderActionRequest | None = None,
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE')),
):
    return mark_delivered(order_id, payload, current_user)


@app.post('/orders/{order_id}/start-delivery')
def mark_out_for_delivery_alias(
    order_id: str,
    payload: OrderActionRequest | None = None,
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    current_status = normalize_order_status(order.get('status', 'PLACED'))
    if current_status != 'SHIPPED':
        raise HTTPException(status_code=400, detail='Order not ready for delivery')

    return mark_out_for_delivery(order_id, payload, current_user)


@app.get('/admin/orders')
def get_admin_orders(current_user: dict = Depends(require_roles('admin', 'merchant'))):
    _ = current_user
    orders = list(orders_collection.find().sort('created_at', -1))
    return {'orders': [serialize_order(order, include_shipment=True) for order in orders]}


@app.post('/admin/orders/purge')
def purge_orders(
    payload: PurgeOrdersRequest,
    current_user: dict = Depends(require_roles('admin', 'merchant')),
):
    _ = current_user

    requested_statuses = [str(value or '').strip().upper() for value in (payload.statuses or []) if str(value or '').strip()]
    normalized_statuses = []
    for status_value in requested_statuses:
        if status_value == 'COMPLETED':
            normalized_statuses.append('DELIVERED')
            continue
        normalized_statuses.append(normalize_order_status(status_value, fallback=status_value))
    normalized_statuses = sorted(set(normalized_statuses))

    delete_all = bool(payload.delete_all)
    if not delete_all and not normalized_statuses:
        raise HTTPException(status_code=400, detail='Provide statuses or set delete_all=true.')

    query = {} if delete_all else {'status': {'$in': normalized_statuses}}
    orders = list(orders_collection.find(query, {'_id': 0, 'order_id': 1, 'shipment_id': 1, 'status': 1}))
    order_ids = [order.get('order_id') for order in orders if order.get('order_id')]

    deleted = {
        'orders': 0,
        'order_items': 0,
        'delivery_logs': 0,
        'order_status_history': 0,
        'payments': 0,
        'returns': 0,
        'notifications': 0,
        'shipment_items': 0,
        'shipments': 0,
    }

    if order_ids:
        deleted['order_items'] = order_items_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count
        deleted['delivery_logs'] = delivery_logs_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count
        deleted['order_status_history'] = order_status_history_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count
        deleted['payments'] = payments_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count
        deleted['returns'] = returns_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count
        deleted['notifications'] = notifications_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count
        deleted['shipment_items'] = shipment_items_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count
        deleted['orders'] = orders_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count

    orphaned_shipments = []
    for shipment in shipments_collection.find({}, {'_id': 0, 'shipment_id': 1}):
        shipment_id = shipment.get('shipment_id')
        if not shipment_id:
            continue
        if shipment_items_collection.count_documents({'shipment_id': shipment_id}) == 0:
            orphaned_shipments.append(shipment_id)

    if orphaned_shipments:
        deleted['shipments'] = shipments_collection.delete_many({'shipment_id': {'$in': orphaned_shipments}}).deleted_count

    return {
        'message': 'Orders purged successfully.',
        'delete_all': delete_all,
        'requested_statuses': requested_statuses,
        'normalized_statuses': normalized_statuses,
        'matched_orders': len(order_ids),
        'deleted': deleted,
    }


@app.post('/admin/orders/data-cleanup')
def cleanup_order_and_shipment_data(
    payload: OrderDataCleanupRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'SUPER_ADMIN')),
):
    _ = current_user
    mode = str(payload.mode or 'RESET').strip().upper()
    demo_only = bool(payload.demo_only)

    if mode not in {'RESET', 'DELETE'}:
        raise HTTPException(status_code=400, detail='mode must be RESET or DELETE.')

    order_filter = {'customer_email': 'customer.demo@veloura.com'} if demo_only else {}
    orders = list(orders_collection.find(order_filter, {'_id': 0, 'order_id': 1, 'created_at': 1}))
    order_ids = [str(order.get('order_id') or '').strip() for order in orders if str(order.get('order_id') or '').strip()]
    related_shipment_ids = []
    if order_ids:
        related_shipment_ids = [
            str(entry.get('shipment_id') or '').strip()
            for entry in shipment_items_collection.find({'order_id': {'$in': order_ids}}, {'_id': 0, 'shipment_id': 1})
            if str(entry.get('shipment_id') or '').strip()
        ]
        related_shipment_ids = sorted(set(related_shipment_ids))

    if mode == 'DELETE':
        deleted = {
            'order_items': order_items_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count if order_ids else 0,
            'delivery_logs': delivery_logs_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count if order_ids else 0,
            'order_status_history': order_status_history_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count if order_ids else 0,
            'payments': payments_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count if order_ids else 0,
            'returns': returns_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count if order_ids else 0,
            'notifications': notifications_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count if order_ids else 0,
            'shipment_items': shipment_items_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count if order_ids else 0,
            'orders': orders_collection.delete_many({'order_id': {'$in': order_ids}}).deleted_count if order_ids else 0,
        }

        orphaned_shipments = []
        for shipment in shipments_collection.find({}, {'_id': 0, 'shipment_id': 1}):
            shipment_id = str(shipment.get('shipment_id') or '').strip()
            if not shipment_id:
                continue
            if shipment_items_collection.count_documents({'shipment_id': shipment_id}) == 0:
                orphaned_shipments.append(shipment_id)

        deleted['shipments'] = shipments_collection.delete_many({'shipment_id': {'$in': orphaned_shipments}}).deleted_count if orphaned_shipments else 0
        return {
            'message': 'Order and shipment data deleted successfully.',
            'mode': mode,
            'demo_only': demo_only,
            'matched_orders': len(order_ids),
            'deleted': deleted,
        }

    reset_count = 0
    for order in orders:
        order_id = str(order.get('order_id') or '').strip()
        if not order_id:
            continue

        created_at = order.get('created_at') or now_utc()
        placed_iso = created_at.isoformat() if isinstance(created_at, datetime) else now_utc().isoformat()
        orders_collection.update_one(
            {'order_id': order_id},
            {
                '$set': {
                    'status': 'PLACED',
                    'status_timestamps': {'PLACED': placed_iso},
                    'shipment_id': None,
                    'assigned_delivery_partner': None,
                    'assigned_delivery_id': None,
                    'updated_at': now_utc(),
                    'updated_by': 'admin-cleanup',
                    'updated_by_role': 'SYSTEM',
                    'updated_by_email': 'system@local',
                }
            },
        )
        order_status_history_collection.delete_many({'order_id': order_id})
        delivery_logs_collection.delete_many({'order_id': order_id})
        append_order_status_history(
            order_id,
            'PLACED',
            'admin-cleanup',
            performer_role='SYSTEM',
            performer_email='system@local',
            location='Order reset cleanup',
        )
        append_delivery_log(
            order_id,
            'PLACED',
            'admin-cleanup',
            location='Order reset cleanup',
            performer_role='SYSTEM',
            performer_email='system@local',
        )
        reset_count += 1

    updated_shipments = 0
    if not demo_only or related_shipment_ids:
        shipment_filter = {'shipment_id': {'$in': related_shipment_ids}} if demo_only else {}
        updated_shipments = shipments_collection.update_many(
            shipment_filter,
            {
                '$set': {
                    'status': 'CREATED',
                    'updated_at': now_utc(),
                }
            },
        ).modified_count

    if order_ids:
        shipment_items_collection.delete_many({'order_id': {'$in': order_ids}})

    return {
        'message': 'Order and shipment data reset successfully.',
        'mode': mode,
        'demo_only': demo_only,
        'orders_reset': reset_count,
        'shipments_updated': updated_shipments,
    }


@app.get('/operations/orders')
def get_operations_orders(current_user: dict = Depends(require_roles('OPERATIONS_STAFF'))):
    _ = current_user
    orders = list(orders_collection.find({'status': 'CONFIRMED'}).sort('created_at', -1))
    return {'orders': [serialize_order(order, include_shipment=True) for order in orders]}


@app.put('/admin/orders/{order_id}/assign')
def assign_delivery_partner(
    order_id: str,
    payload: AssignDeliveryRequest,
    current_user: dict = Depends(require_roles('admin', 'merchant')),
):
    _ = current_user
    delivery_email = payload.delivery_partner_email.strip().lower()
    partner = users_collection.find_one({'email': delivery_email})

    if (
        not partner
        or normalize_role(partner.get('role', '')) != 'DELIVERY_ASSOCIATE'
        or normalize_account_status(partner.get('status', 'ACTIVE')) != 'ACTIVE'
    ):
        raise HTTPException(status_code=404, detail='Delivery partner account not found.')

    result = orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'assigned_delivery_partner': delivery_email,
                'assigned_delivery_id': partner.get('id'),
                'updated_at': now_utc(),
            }
        },
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail='Order not found.')

    order = orders_collection.find_one({'order_id': order_id})
    return {'message': 'Delivery partner assigned.', 'order': serialize_order(order, include_shipment=True)}


@app.post('/shipments')
def create_shipment(payload: CreateShipmentRequest, current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF'))):
    if not payload.order_ids:
        raise HTTPException(status_code=400, detail='Select at least one order.')

    unique_order_ids = list(dict.fromkeys(payload.order_ids))
    orders = list(orders_collection.find({'order_id': {'$in': unique_order_ids}}))
    if len(orders) != len(unique_order_ids):
        raise HTTPException(status_code=404, detail='One or more orders were not found.')

    invalid_orders = [
        str(order.get('order_id') or '').strip()
        for order in orders
        if normalize_order_status(order.get('status', 'PLACED')) != 'PACKED'
    ]
    if invalid_orders:
        raise HTTPException(
            status_code=400,
            detail=f"Shipment creation only supports PACKED orders. Invalid order(s): {', '.join(invalid_orders)}",
        )

    already_assigned_orders = [
        str(order.get('order_id') or '').strip()
        for order in orders
        if str(order.get('shipment_id') or '').strip()
    ]
    if already_assigned_orders:
        raise HTTPException(
            status_code=409,
            detail=f"These orders are already attached to a shipment: {', '.join(already_assigned_orders)}",
        )

    max_orders = normalize_max_orders_per_shipment(payload.max_orders_per_shipment)
    order_batches = group_orders_for_shipments(orders, max_orders)
    if not order_batches:
        raise HTTPException(status_code=400, detail='Unable to group selected orders for shipment creation.')

    shipment_entity_status = 'CREATED'

    manual_partner = find_user_by_id_or_email(payload.assigned_delivery_id or '') if payload.assigned_delivery_id else None
    manual_partner_email = manual_partner.get('email').strip().lower() if manual_partner else None
    manual_partner_id = manual_partner.get('id') if manual_partner else None
    explicit_courier = str(payload.courier_name or '').strip()
    explicit_tracking = str(payload.tracking_id or '').strip()
    explicit_vehicle_type = normalize_shipment_vehicle_type(payload.vehicle_type, fallback='VAN')
    explicit_notes = str(payload.shipment_notes or '').strip()
    requested_destination_state = str(payload.destination_state or '').strip()
    requested_destination_city = str(payload.destination_city or '').strip()

    created_shipments = []
    for batch_index, batch_orders in enumerate(order_batches):
        primary_order = batch_orders[0]
        destination = get_order_destination_location(primary_order)
        destination_pincode = sanitize_pincode(primary_order.get('destination_pincode', ''))
        warehouse = get_warehouse_location(primary_order)
        destination_state = requested_destination_state or str(destination.get('state') or '').strip()
        destination_city = requested_destination_city or str(destination.get('city') or '').strip()
        destination_label = ', '.join([part for part in [destination_city, destination_state] if part])

        shipment_id = f"SHP-{uuid4().hex[:10].upper()}"
        tracking_id = build_tracking_id_for_batch(explicit_tracking, batch_index)
        courier_name = explicit_courier if explicit_courier and explicit_courier != 'Assigned courier' else choose_courier_name(warehouse, destination)

        auto_partner_id, auto_partner_email = auto_assign_delivery_partner(destination, destination_pincode)
        assigned_partner_id = manual_partner_id or auto_partner_id
        assigned_partner_email = manual_partner_email or auto_partner_email

        shipments_collection.insert_one(
            {
                'id': shipment_id,
                'shipment_id': shipment_id,
                'tracking_id': tracking_id,
                'warehouse_id': payload.warehouse_id or warehouse.get('warehouse_id'),
                'status': shipment_entity_status,
                'courier_name': courier_name,
                'destination_state': destination_state,
                'destination_city': destination_city,
                'destination': destination_label,
                'vehicle_type': explicit_vehicle_type,
                'shipment_notes': explicit_notes,
                'route_city': destination_city,
                'route_state': destination_state,
                'created_at': now_utc(),
                'updated_at': now_utc(),
                'updated_by': current_user.get('id') or current_user.get('email', 'admin'),
            }
        )

        batch_order_ids = []
        for order in batch_orders:
            batch_order_ids.append(order['order_id'])
            shipment_items_collection.update_one(
                {'shipment_id': shipment_id, 'order_id': order['order_id']},
                {
                    '$set': {
                        'id': f"SI-{uuid4().hex[:12].upper()}",
                        'shipment_id': shipment_id,
                        'order_id': order['order_id'],
                    }
                },
                upsert=True,
            )

            orders_collection.update_one(
                {'order_id': order['order_id']},
                {
                    '$set': {
                        'shipment_id': shipment_id,
                        'assigned_delivery_partner': assigned_partner_email,
                        'assigned_delivery_id': assigned_partner_id,
                        'updated_at': now_utc(),
                    }
                },
            )

        shipment = shipments_collection.find_one({'shipment_id': shipment_id})
        created_shipments.append(
            {
                'shipment': serialize_shipment(shipment),
                'order_ids': batch_order_ids,
            }
        )

    first_shipment = created_shipments[0]['shipment'] if created_shipments else None
    return {
        'message': f'Shipment records created. Created {len(created_shipments)} shipment(s). Dispatch separately to mark orders as SHIPPED.',
        'shipment': first_shipment,
        'shipments': created_shipments,
        'order_ids': unique_order_ids,
        'shipments_created': len(created_shipments),
    }


@app.post('/shipments/{shipment_id}/dispatch')
def dispatch_shipment(
    shipment_id: str,
    payload: OrderActionRequest | None = None,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    shipment = shipments_collection.find_one({'shipment_id': shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail='Shipment not found.')

    shipment_status = normalize_order_status(shipment.get('status', 'CREATED'))
    if shipment_status == 'DISPATCHED':
        raise HTTPException(status_code=409, detail='Shipment is already dispatched.')
    if shipment_status != 'CREATED':
        raise HTTPException(status_code=400, detail='Shipment can only be dispatched from CREATED status.')

    shipment_orders = list(shipment_items_collection.find({'shipment_id': shipment_id}, {'_id': 0, 'order_id': 1}))
    order_ids = [str(item.get('order_id') or '').strip() for item in shipment_orders if str(item.get('order_id') or '').strip()]
    if not order_ids:
        raise HTTPException(status_code=400, detail='No orders attached to this shipment.')

    location_value = (payload.current_location if payload and payload.current_location else '').strip()
    if not location_value:
        location_value = str(shipment.get('current_location') or '').strip() or 'Warehouse dispatch'

    dispatched_order_ids: list[str] = []
    skipped_order_ids: list[str] = []
    for order_id in order_ids:
        order = orders_collection.find_one({'order_id': order_id})
        if not order:
            skipped_order_ids.append(order_id)
            continue

        current_status = normalize_order_status(order.get('status', 'PLACED'))
        if current_status in {'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'}:
            dispatched_order_ids.append(order_id)
            continue

        if current_status != 'PACKED':
            skipped_order_ids.append(order_id)
            continue

        apply_order_status_update(
            order,
            'SHIPPED',
            str(current_user.get('id') or current_user.get('email', 'ops')),
            location=location_value,
            performer_role=normalize_role(current_user.get('role', 'OPERATIONS_STAFF')),
            performer_email=str(current_user.get('email', 'system@local')).strip().lower(),
        )
        orders_collection.update_one(
            {'order_id': order_id},
            {
                '$set': {
                    'shipment_id': shipment_id,
                    'updated_at': now_utc(),
                }
            },
        )
        dispatched_order_ids.append(order_id)

    if not dispatched_order_ids:
        raise HTTPException(status_code=400, detail='No PACKED orders available in this shipment for dispatch.')

    shipments_collection.update_one(
        {'shipment_id': shipment_id},
        {
            '$set': {
                'status': 'DISPATCHED',
                'current_location': location_value,
                'updated_at': now_utc(),
                'updated_by': current_user.get('id') or current_user.get('email', 'admin'),
            }
        },
    )

    for order_id in dispatched_order_ids:
        create_notification(
            event_type='SHIPPED',
            order_id=order_id,
            message=f'Order {order_id} has been dispatched and is now on the way.',
            user_id=str(current_user.get('id') or current_user.get('email') or ''),
        )

    return {
        'message': f"Shipment dispatched. {len(dispatched_order_ids)} order(s) moved to SHIPPED.",
        'shipment_id': shipment_id,
        'dispatched_order_ids': dispatched_order_ids,
        'skipped_order_ids': skipped_order_ids,
    }


@app.post('/shipments/auto')
def auto_create_shipments(payload: AutoCreateShipmentRequest, current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF'))):
    packed_orders = list(orders_collection.find({'status': 'PACKED'}).sort('created_at', 1))
    if not packed_orders:
        return {
            'message': 'No packed orders available for auto shipment creation.',
            'shipments': [],
            'shipments_created': 0,
            'order_ids': [],
        }

    order_ids = [order['order_id'] for order in packed_orders]
    request_payload = CreateShipmentRequest(
        order_ids=order_ids,
        status='CREATED',
        courier_name='Assigned courier',
        tracking_id='',
        assigned_delivery_id=None,
        max_orders_per_shipment=payload.max_orders_per_shipment,
    )
    return create_shipment(request_payload, current_user)


@app.get('/operations/packed-orders')
def get_operations_packed_orders(current_user: dict = Depends(require_roles('OPERATIONS_STAFF'))):
    _ = current_user
    orders = list(
        orders_collection.find(
            {
                'status': 'PACKED',
                '$or': [
                    {'shipment_id': {'$exists': False}},
                    {'shipment_id': None},
                    {'shipment_id': ''},
                ],
            }
        ).sort('updated_at', -1)
    )
    return {'orders': [serialize_order(order, include_shipment=True) for order in orders]}


@app.get('/operations/shipments')
def get_operations_shipments(current_user: dict = Depends(require_roles('OPERATIONS_STAFF'))):
    _ = current_user
    shipments = list(shipments_collection.find({}).sort('created_at', -1))
    enriched_shipments = []
    for shipment in shipments:
        payload = serialize_shipment(shipment) or {}
        order_ids = get_shipment_order_ids(str(payload.get('shipment_id') or ''))
        payload['order_ids'] = order_ids
        payload['order_count'] = len(order_ids)
        enriched_shipments.append(payload)
    return {'shipments': enriched_shipments}


@app.put('/admin/orders/{order_id}/shipment')
def update_shipment_by_admin(
    order_id: str,
    payload: ShipmentUpdateRequest,
    current_user: dict = Depends(require_roles('admin', 'merchant')),
):
    _ = current_user
    status_value = normalize_order_status(payload.status)

    if status_value != 'SHIPPED':
        raise HTTPException(status_code=400, detail='Shipment update endpoint only supports transition to SHIPPED.')

    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    shipment_id = order.get('shipment_id') or f'SHP-{uuid4().hex[:10].upper()}'
    shipment_payload = {
        'id': shipment_id,
        'shipment_id': shipment_id,
        'warehouse_id': order.get('warehouse_id'),
        'courier_name': payload.courier_name.strip(),
        'tracking_id': payload.tracking_id.strip() or f'TRK-{uuid4().hex[:12].upper()}',
        'status': 'DISPATCHED' if status_value == 'SHIPPED' else 'IN_TRANSIT',
        'current_location': payload.current_location.strip() or 'Warehouse',
        'updated_at': now_utc(),
    }

    shipments_collection.update_one(
        {'shipment_id': shipment_id},
        {'$set': shipment_payload, '$setOnInsert': {'created_at': now_utc()}},
        upsert=True,
    )

    latest = apply_order_status_update(
        order,
        status_value,
        str(current_user.get('id') or current_user.get('email', 'admin')),
        location=(payload.current_location or '').strip() or 'Shipment update',
        performer_role=normalize_role(current_user.get('role', 'ADMIN')),
        performer_email=current_user.get('email', 'system@local').strip().lower(),
    )

    orders_collection.update_one(
        {'order_id': order_id},
        {'$set': {'shipment_id': shipment_id, 'updated_at': now_utc()}},
    )
    latest = orders_collection.find_one({'order_id': order_id})
    return {'message': 'Shipment updated.', 'order': serialize_order(latest, include_shipment=True)}


@app.get('/delivery/orders')
@app.get('/delivery/assigned')
def get_delivery_orders(current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE'))):
    email = current_user['email'].strip().lower()
    user_id = current_user.get('id')
    orders = list(
        orders_collection.find(
            {
                '$or': [
                    {'assigned_delivery_partner': email},
                    {'assigned_delivery_id': user_id},
                ]
                ,
                'status': {'$in': ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED']},
            }
        ).sort('updated_at', -1)
    )
    enriched_orders = []
    for order in orders:
        payload = serialize_order(order, include_shipment=True)
        shipping = payload.get('shipping_details') if isinstance(payload.get('shipping_details'), dict) else {}
        customer = users_collection.find_one({'email': str(payload.get('customer_email') or '').strip().lower()}, {'_id': 0}) or {}
        customer_profile = customer.get('profile_details') if isinstance(customer.get('profile_details'), dict) else {}

        customer_name = str(shipping.get('full_name') or customer.get('full_name') or customer.get('name') or '').strip()
        customer_phone = sanitize_phone_number(str(shipping.get('phone') or customer.get('phone_number') or customer_profile.get('phone_number') or '').strip())
        delivery_address = ', '.join(
            [
                str(shipping.get('address') or '').strip(),
                str(shipping.get('city') or '').strip(),
                str(shipping.get('pincode') or payload.get('destination_pincode') or '').strip(),
            ]
        ).strip(', ').strip()

        payload['customer_name'] = customer_name or str(payload.get('customer_email') or 'Customer').split('@')[0]
        payload['customer_phone'] = customer_phone
        payload['delivery_address'] = delivery_address
        payload['order_value'] = float(payload.get('total_amount') or 0)

        delivery_meta = payload.get('delivery_meta') if isinstance(payload.get('delivery_meta'), dict) else {}
        payload['delivery_meta'] = {
            'accepted_at': delivery_meta.get('accepted_at'),
            'picked_at': delivery_meta.get('picked_at'),
            'out_for_delivery_at': delivery_meta.get('out_for_delivery_at'),
            'delivered_at': delivery_meta.get('delivered_at'),
            'failed_at': delivery_meta.get('failed_at'),
            'rejected_at': delivery_meta.get('rejected_at'),
        }
        if payload.get('status') == 'DELIVERED':
            payload['delivery_queue_state'] = 'COMPLETED'
        elif payload.get('status') == 'DELIVERY_FAILED':
            payload['delivery_queue_state'] = 'FAILED'
        elif delivery_meta.get('accepted_at') or payload.get('status') in {'OUT_FOR_DELIVERY'}:
            payload['delivery_queue_state'] = 'ACTIVE'
        else:
            payload['delivery_queue_state'] = 'ASSIGNED'
        enriched_orders.append(payload)

    return {'orders': enriched_orders}


@app.get('/delivery/profile')
def get_delivery_profile(current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE'))):
    profile_details = normalize_delivery_profile_details(current_user.get('profile_details') or {})
    return {
        'user': serialize_user(current_user),
        'profile_details': profile_details,
    }


@app.put('/delivery/profile')
def update_delivery_profile(
    payload: DeliveryProfileUpdateRequest,
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE')),
):
    profile_details = dict(current_user.get('profile_details') or {})
    is_demo_partner = is_demo_delivery_partner_account(current_user)

    if payload.full_name is not None:
        full_name = str(payload.full_name).strip()
        if not full_name:
            raise HTTPException(status_code=400, detail='Full name is required.')
        profile_details['full_name'] = full_name

    if payload.phone_number is not None:
        cleaned_phone = sanitize_phone_number(payload.phone_number)
        if len(cleaned_phone) != 10:
            raise HTTPException(status_code=400, detail='Phone number must be exactly 10 digits.')
        profile_details['phone_number'] = cleaned_phone

    if payload.vehicle_type is not None:
        vehicle_type = str(payload.vehicle_type).strip().upper()
        if vehicle_type not in {'BIKE', 'CYCLE', 'VAN'}:
            raise HTTPException(status_code=400, detail='Vehicle type must be Bike, Cycle, or Van.')
        profile_details['vehicle_type'] = vehicle_type

    if payload.vehicle_number is not None:
        vehicle_number = str(payload.vehicle_number).strip().upper()
        if not vehicle_number:
            raise HTTPException(status_code=400, detail='Vehicle number is required.')
        profile_details['vehicle_number'] = vehicle_number

    if payload.driving_license_number is not None:
        driving_license_number = str(payload.driving_license_number).strip().upper()
        if not driving_license_number:
            raise HTTPException(status_code=400, detail='Driving license number is required.')
        profile_details['driving_license_number'] = driving_license_number

    if payload.availability is not None:
        availability = str(payload.availability).strip().upper().replace('-', '_')
        if availability not in {'FULL_TIME', 'PART_TIME'}:
            raise HTTPException(status_code=400, detail='Availability must be Full-time or Part-time.')
        profile_details['availability'] = availability

    if payload.profile_image_url is not None:
        profile_details['profile_image_url'] = str(payload.profile_image_url).strip()

    if payload.city is not None:
        profile_details['city'] = str(payload.city).strip()

    if payload.state is not None:
        profile_details['state'] = str(payload.state).strip()

    if payload.allow_all_india:
        if not is_demo_partner:
            raise HTTPException(status_code=403, detail='All-India delivery is reserved for the demo delivery partner only.')
        profile_details['allow_all_india'] = True
        profile_details['service_scope'] = 'ALL_INDIA'
        profile_details['service_pincodes'] = []
    else:
        service_pincodes = parse_service_pincodes(payload.service_pincodes)
        if service_pincodes:
            for service_pincode in service_pincodes:
                if not is_valid_indian_pincode(service_pincode):
                    raise HTTPException(status_code=400, detail='Each service pincode must be a valid 6-digit pincode.')
            profile_details['allow_all_india'] = False
            profile_details['service_scope'] = 'LOCAL'
            profile_details['service_pincodes'] = service_pincodes
            profile_details['service_pincode'] = service_pincodes[0]

    profile_details = normalize_delivery_partner_profile_for_scope(profile_details, is_demo_partner)
    users_collection.update_one(
        {'id': current_user.get('id')},
        {
            '$set': {
                'full_name': profile_details.get('full_name') or current_user.get('full_name'),
                'phone_number': profile_details.get('phone_number') or current_user.get('phone_number'),
                'city': profile_details.get('city') or current_user.get('city'),
                'state': profile_details.get('state') or current_user.get('state'),
                'profile_details': profile_details,
                'updated_at': now_utc(),
            }
        },
    )
    updated_user = users_collection.find_one({'id': current_user.get('id')}, {'_id': 0}) or {}
    return {
        'message': 'Delivery profile updated successfully.',
        'user': serialize_user(updated_user),
        'profile_details': normalize_delivery_profile_details(updated_user.get('profile_details') or {}),
    }


@app.post('/delivery/orders/{order_id}/reject')
def reject_delivery_order(order_id: str, current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE'))):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    email = current_user['email'].strip().lower()
    user_id = current_user.get('id')
    if order.get('assigned_delivery_partner') != email and order.get('assigned_delivery_id') != user_id:
        raise HTTPException(status_code=403, detail='Order is not assigned to this delivery partner.')

    orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'assigned_delivery_partner': None,
                'assigned_delivery_id': None,
                'delivery_meta.rejected_at': now_utc().isoformat(),
                'delivery_meta.last_action': 'REJECTED',
                'updated_at': now_utc(),
            }
        },
    )
    append_delivery_log(order_id, order.get('status', 'SHIPPED'), current_user.get('id'), location='Order rejected by delivery partner')
    create_notification('DELIVERY_REJECTED', order_id, f'Order {order_id} was rejected by the assigned delivery partner.')
    latest = orders_collection.find_one({'order_id': order_id})
    return {'message': 'Order rejected and unassigned.', 'order': serialize_order(latest or {}, include_shipment=True)}


@app.get('/delivery/estimate')
def get_delivery_estimate(product_id: int, pincode: str | None = None, user_pincode: str | None = None, express: bool = False):
    incoming_pincode = pincode or user_pincode or ''
    cleaned_pincode = sanitize_pincode(incoming_pincode)
    if not is_valid_indian_pincode(cleaned_pincode):
        raise HTTPException(status_code=400, detail='Please enter a valid 6-digit Indian pincode.')

    product = products_collection.find_one({'id': product_id}, {'_id': 0, 'id': 1, 'name': 1})
    if not product:
        # Frontend can contain additional catalog ids not yet persisted in Mongo.
        # Keep delivery estimate functional by using a synthetic product descriptor.
        product = {'id': product_id, 'name': f'Product {product_id}'}

    user_location = get_location_for_pincode(cleaned_pincode)
    coverage = get_merchant_delivery_coverage()
    delivery_available = is_delivery_allowed_for_location(coverage, user_location)

    if not delivery_available:
        return {
            'product_id': product_id,
            'delivery_available': False,
            'deliverable': False,
            'delivery_text': 'Sorry, delivery not available',
            'availability_text': 'Sorry, delivery not available',
            'location_text': f"{user_location.get('city', 'Unknown City')}, {user_location.get('state', 'Unknown State')} - {cleaned_pincode}",
            'coverage_scope': coverage.get('delivery_scope', 'NATIONWIDE'),
        }

    warehouse = choose_best_warehouse(product_id, user_location)
    bucket = delivery_bucket(user_location, warehouse)
    courier_type = choose_courier_name(warehouse, user_location)
    if courier_type == 'Local Express':
        min_days = 1
        max_days = 1
    elif courier_type == 'Regional Courier':
        min_days = 2
        max_days = 3
    else:
        min_days = 4
        max_days = 6

    if express and bool(warehouse.get('express_enabled')):
        min_days = 1
        max_days = 1

    delivery_date = (now_utc() + timedelta(days=max_days)).date()
    delivery_datetime = datetime.combine(delivery_date, datetime.min.time(), tzinfo=UTC)

    response_payload = {
        'product_id': product_id,
        'delivery_available': True,
        'deliverable': True,
        'estimated_days': max_days,
        'estimated_days_min': min_days,
        'estimated_days_max': max_days,
        'delivery_date': delivery_datetime.isoformat(),
        'delivery_text': f"Delivery by {format_delivery_date(delivery_datetime)}",
        'availability_text': 'Delivery available in your area',
        'location_text': f'Delivering to {cleaned_pincode}',
        'delivery_charge': 49,
        'standard_delivery_charge': 49,
        'free_delivery_threshold': 500,
        'warehouse': {
            'warehouse_id': warehouse.get('warehouse_id'),
            'pincode': warehouse.get('pincode'),
            'city': warehouse.get('city'),
            'state': warehouse.get('state'),
        },
        'courier_type': courier_type,
        'free_delivery': True,
        'is_express': bool(express and warehouse.get('express_enabled')),
    }

    if min_days == 1 and max_days == 1:
        response_payload['delivery_hint'] = 'Get it by Tomorrow'

    cutoff_hours = compute_same_day_cutoff_hours()
    if cutoff_hours > 0 and bucket == 0:
        response_payload['order_within_text'] = f'Order within {cutoff_hours} hrs for same-day shipping'

    return response_payload


@app.put('/delivery/update-status')
@app.post('/delivery/update-status')
def update_delivery_status(
    payload: DeliveryStatusUpdateRequest,
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE')),
):
    email = current_user['email'].strip().lower()
    requested_status = str(payload.status or '').strip().upper()
    delivery_actions = {'ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'}
    if requested_status not in delivery_actions:
        raise HTTPException(status_code=400, detail='Delivery status must be one of ACCEPTED, PICKED_UP, OUT_FOR_DELIVERY, DELIVERED, FAILED.')

    status_value = normalize_order_status('DELIVERY_FAILED' if requested_status == 'FAILED' else requested_status)

    order = orders_collection.find_one({'order_id': payload.order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    if order.get('assigned_delivery_partner') != email and order.get('assigned_delivery_id') != current_user.get('id'):
        raise HTTPException(status_code=403, detail='Order is not assigned to this delivery partner.')

    shipment_id = order.get('shipment_id')
    if not shipment_id:
        shipment_id = f'SHP-{uuid4().hex[:10].upper()}'
        orders_collection.update_one({'order_id': payload.order_id}, {'$set': {'shipment_id': shipment_id}})

    shipments_collection.update_one(
        {'shipment_id': shipment_id},
        {
            '$set': {
                'id': shipment_id,
                'shipment_id': shipment_id,
                'status': 'ARRIVED' if status_value == 'DELIVERED' else 'IN_TRANSIT',
                'current_location': (payload.current_location or '').strip() or 'Customer address',
                'updated_at': now_utc(),
            },
            '$setOnInsert': {
                'tracking_id': f'TRK-{uuid4().hex[:12].upper()}',
                'warehouse_id': order.get('warehouse_id'),
                'courier_name': 'Assigned courier',
                'created_at': now_utc(),
            },
        },
        upsert=True,
    )

    actor = str(current_user.get('id') or current_user.get('email', 'delivery'))
    location_value = (payload.current_location or '').strip() or 'Last mile route'

    if requested_status == 'ACCEPTED':
        orders_collection.update_one(
            {'order_id': payload.order_id},
            {
                '$set': {
                    'delivery_meta.accepted_at': now_utc().isoformat(),
                    'delivery_meta.last_action': 'ACCEPTED',
                    'updated_at': now_utc(),
                }
            },
        )
        append_delivery_log(payload.order_id, order.get('status', 'SHIPPED'), actor, location='Order accepted by delivery partner')
        create_notification('DELIVERY_ACCEPTED', payload.order_id, f'Order {payload.order_id} has been accepted by the delivery partner.')
        latest = orders_collection.find_one({'order_id': payload.order_id})
        return {'message': 'Order accepted successfully.', 'order': serialize_order(latest, include_shipment=True)}

    if requested_status == 'PICKED_UP':
        orders_collection.update_one(
            {'order_id': payload.order_id},
            {
                '$set': {
                    'delivery_meta.picked_at': now_utc().isoformat(),
                    'delivery_meta.last_action': 'PICKED_UP',
                    'updated_at': now_utc(),
                }
            },
        )
        append_delivery_log(payload.order_id, order.get('status', 'SHIPPED'), actor, location='Order picked up from warehouse')
        create_notification('DELIVERY_PICKED_UP', payload.order_id, f'Order {payload.order_id} has been picked up for delivery.')
        latest = orders_collection.find_one({'order_id': payload.order_id})
        return {'message': 'Order marked as picked up.', 'order': serialize_order(latest, include_shipment=True)}

    if requested_status == 'FAILED':
        orders_collection.update_one(
            {'order_id': payload.order_id},
            {
                '$set': {
                    'status': 'DELIVERY_FAILED',
                    'delivery_meta.failed_at': now_utc().isoformat(),
                    'delivery_meta.last_action': 'FAILED',
                    'updated_at': now_utc(),
                }
            },
        )
        append_delivery_log(payload.order_id, 'DELIVERY_FAILED', actor, location=location_value)
        create_notification('DELIVERY_FAILED', payload.order_id, f'Order {payload.order_id} marked as delivery failed.')
        latest = orders_collection.find_one({'order_id': payload.order_id})
        return {'message': 'Order marked as failed.', 'order': serialize_order(latest, include_shipment=True)}

    latest = apply_order_status_update(
        order,
        status_value,
        actor,
        location=location_value,
        performer_role='DELIVERY_ASSOCIATE',
        performer_email=email,
    )

    orders_collection.update_one(
        {'order_id': payload.order_id},
        {
            '$set': {
                'delivery_meta.last_action': requested_status,
                'delivery_meta.out_for_delivery_at': now_utc().isoformat() if requested_status == 'OUT_FOR_DELIVERY' else order.get('delivery_meta', {}).get('out_for_delivery_at'),
                'delivery_meta.delivered_at': now_utc().isoformat() if requested_status == 'DELIVERED' else order.get('delivery_meta', {}).get('delivered_at'),
                'updated_at': now_utc(),
            }
        },
    )
    latest = orders_collection.find_one({'order_id': payload.order_id})
    return {'message': 'Delivery status updated.', 'order': serialize_order(latest or {}, include_shipment=True)}


def calculate_delivery_commission(order: dict) -> float:
    total = float(order.get('total_amount') or 0)
    return round(max(30.0, total * 0.08), 2)


@app.get('/delivery/earnings')
def get_delivery_earnings(current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE'))):
    email = str(current_user.get('email') or '').strip().lower()
    user_id = str(current_user.get('id') or '').strip()
    assigned_filter = {'$or': [{'assigned_delivery_partner': email}, {'assigned_delivery_id': user_id}]}
    now = now_utc()
    start_today = datetime(now.year, now.month, now.day, tzinfo=UTC)
    start_week = start_today - timedelta(days=start_today.weekday())

    delivered_orders = list(
        orders_collection.find(
            {
                **assigned_filter,
                'status': 'DELIVERED',
            },
            {'_id': 0},
        )
    )

    today_deliveries = 0
    total_deliveries_today = 0
    weekly_earnings = 0.0

    for order in delivered_orders:
        commission = calculate_delivery_commission(order)
        delivered_at_iso = str((order.get('delivery_meta') or {}).get('delivered_at') or order.get('updated_at') or '')
        try:
            delivered_at = datetime.fromisoformat(delivered_at_iso.replace('Z', '+00:00')) if delivered_at_iso else None
        except ValueError:
            delivered_at = None

        if delivered_at and delivered_at >= start_week:
            weekly_earnings += commission

        if delivered_at and delivered_at >= start_today:
            total_deliveries_today += 1
            today_deliveries += commission

    return {
        'today_earnings': round(today_deliveries, 2),
        'today_deliveries': total_deliveries_today,
        'weekly_earnings': round(weekly_earnings, 2),
    }


@app.get('/tracking/{order_id}')
def get_tracking(order_id: str, current_user: dict = Depends(get_current_user)):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    actor_role = normalize_role(current_user.get('role', 'CUSTOMER'))
    actor_email = str(current_user.get('email', '')).strip().lower()
    if actor_role == 'CUSTOMER' and order.get('customer_email') != actor_email:
        raise HTTPException(status_code=403, detail='Access denied.')

    logs = get_tracking_logs(order_id)
    return {
        'order_id': order_id,
        'current_status': normalize_order_status(order.get('status', 'PLACED')),
        'timeline_steps': ORDER_STATUS_FLOW,
        'logs': logs,
        'order': serialize_order(order, include_shipment=True),
    }


@app.get('/orders/{order_id}/tracking')
def get_order_tracking(order_id: str, current_user: dict = Depends(get_current_user)):
    return get_tracking(order_id, current_user)


@app.get('/admin/tracking-logs')
def get_admin_tracking_logs(order_id: str, current_user: dict = Depends(require_roles('ADMIN'))):
    _ = current_user
    logs = get_tracking_logs(order_id)
    return {'order_id': order_id, 'logs': logs}


@app.put('/orders/{order_id}/cancel')
def cancel_order(order_id: str, payload: CancelOrderRequest, current_user: dict = Depends(require_roles('CUSTOMER'))):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    actor_email = str(current_user.get('email', '')).strip().lower()
    actor_id = str(current_user.get('id', '')).strip()
    is_owner = order.get('customer_email') == actor_email or order.get('user_id') in {actor_id, actor_email}
    if not is_owner:
        raise HTTPException(status_code=403, detail='Access denied.')

    current_status = normalize_order_status(order.get('status', 'PLACED'))
    if current_status != 'PLACED':
        raise HTTPException(status_code=400, detail='Order can only be cancelled while it is PLACED.')
    if current_status == 'CANCELLED':
        raise HTTPException(status_code=400, detail='Order is already cancelled.')

    latest = apply_order_status_update(
        order,
        'CANCELLED',
        actor_id or actor_email or 'customer',
        location='Order cancelled by customer',
        performer_role='CUSTOMER',
        performer_email=actor_email,
    )
    orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'cancellation_reason': str(payload.reason or '').strip(),
                'updated_at': now_utc(),
            }
        },
    )
    append_delivery_log(order_id, 'CANCELLED', actor_id or actor_email or 'customer', location='Order cancelled by customer')
    set_payment_status(order_id, 'REFUNDED', reason='Order cancelled before shipping')
    create_notification('ORDER_CANCELLED', order_id, f'Order {order_id} cancelled by customer.', user_id=actor_id or actor_email)
    latest = orders_collection.find_one({'order_id': order_id}) or latest
    return {'message': 'Order cancelled successfully.', 'order': serialize_order(latest, include_shipment=True)}


@app.post('/orders/{order_id}/return-request')
def request_order_return(
    order_id: str,
    payload: ReturnRequestCreateRequest | None = None,
    current_user: dict = Depends(require_roles('CUSTOMER')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    actor_email = str(current_user.get('email', '')).strip().lower()
    actor_id = str(current_user.get('id', '')).strip()
    is_owner = order.get('customer_email') == actor_email or order.get('user_id') in {actor_id, actor_email}
    if not is_owner:
        raise HTTPException(status_code=403, detail='Access denied.')
    if normalize_order_status(order.get('status', 'PLACED')) != 'DELIVERED':
        raise HTTPException(status_code=400, detail='Return can only be requested after delivery.')

    existing_return = returns_collection.find_one({'order_id': order_id})
    if existing_return:
        raise HTTPException(status_code=400, detail='Return request already exists for this order.')

    proof_images = []
    raw_images = (payload.proof_images if payload else None) or []
    for image in raw_images:
        normalized = str(image or '').strip()
        if normalized:
            proof_images.append(normalized)
    proof_images = proof_images[:5]

    returns_collection.insert_one(
        {
            'id': f"RET-{uuid4().hex[:12].upper()}",
            'order_id': order_id,
            'status': 'RETURN_REQUESTED',
            'reason': str((payload.reason if payload else '') or '').strip(),
            'issue_details': str((payload.issue_details if payload else '') or '').strip(),
            'proof_images': proof_images,
            'timestamps': {'RETURN_REQUESTED': now_utc().isoformat()},
            'created_by': actor_id or actor_email,
            'created_at': now_utc(),
            'updated_at': now_utc(),
        }
    )
    create_notification('RETURN_REQUESTED', order_id, f'Return requested for order {order_id}.', user_id=actor_id or actor_email)
    return {'message': 'Return request submitted successfully.', 'return_request': serialize_return_for_order(order_id)}


@app.put('/returns/{order_id}/status')
def update_return_status(
    order_id: str,
    payload: ReturnUpdateRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    request = returns_collection.find_one({'order_id': order_id})
    if not request:
        raise HTTPException(status_code=404, detail='Return request not found.')

    current_status = normalize_return_status(request.get('status', 'RETURN_REQUESTED'))
    target_status = normalize_return_status(payload.status)
    if not is_valid_return_transition(current_status, target_status):
        raise HTTPException(status_code=400, detail='Invalid return status transition.')

    actor = str(current_user.get('id') or current_user.get('email') or 'staff')
    returns_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'status': target_status,
                f'timestamps.{target_status}': now_utc().isoformat(),
                'updated_at': now_utc(),
                'location': str(payload.location or '').strip(),
                'updated_by': actor,
            }
        },
    )

    if target_status == 'REFUNDED':
        set_payment_status(order_id, 'REFUNDED', reason='Return refunded')

    create_notification(target_status, order_id, f'Return status for {order_id} updated to {target_status}.')
    return {'message': 'Return status updated.', 'return_request': serialize_return_for_order(order_id)}


@app.get('/admin/returns')
def get_admin_returns(
    status_filter: str = 'RETURN_REQUESTED',
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    _ = current_user
    query = {'status': normalize_return_status(status_filter, fallback='RETURN_REQUESTED')}
    results = []
    for return_request in returns_collection.find(query, {'_id': 0}).sort('created_at', -1):
        order_id = str(return_request.get('order_id') or '').strip()
        order = orders_collection.find_one({'order_id': order_id}, {'_id': 0}) if order_id else None

        payload = dict(return_request)
        if isinstance(payload.get('created_at'), datetime):
            payload['created_at'] = payload['created_at'].isoformat()
        if isinstance(payload.get('updated_at'), datetime):
            payload['updated_at'] = payload['updated_at'].isoformat()

        payload['status'] = normalize_return_status(payload.get('status', 'RETURN_REQUESTED'))
        payload['proof_images'] = [str(item).strip() for item in (payload.get('proof_images') or []) if str(item).strip()]
        payload['order'] = serialize_order(order, include_shipment=True) if order else None
        results.append(payload)

    return {'returns': results}


@app.put('/admin/returns/{order_id}/decision')
def decide_return_request(
    order_id: str,
    payload: ReturnDecisionRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    request = returns_collection.find_one({'order_id': order_id})
    if not request:
        raise HTTPException(status_code=404, detail='Return request not found.')

    current_status = normalize_return_status(request.get('status', 'RETURN_REQUESTED'))
    if current_status != 'RETURN_REQUESTED':
        raise HTTPException(status_code=400, detail='Only RETURN_REQUESTED items can be approved or rejected.')

    decision = str(payload.decision or '').strip().upper()
    if decision not in {'APPROVE', 'REJECT'}:
        raise HTTPException(status_code=400, detail='Decision must be APPROVE or REJECT.')

    target_status = 'PICKUP' if decision == 'APPROVE' else 'RETURN_REJECTED'
    actor = str(current_user.get('id') or current_user.get('email') or 'staff').strip() or 'staff'
    review_note = str(payload.review_note or '').strip()

    returns_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'status': target_status,
                f'timestamps.{target_status}': now_utc().isoformat(),
                'review_note': review_note,
                'reviewed_by': actor,
                'updated_at': now_utc(),
            }
        },
    )

    if target_status == 'RETURN_REJECTED':
        create_notification('RETURN_REJECTED', order_id, f'Return request for {order_id} was rejected.')
        return {'message': 'Return request rejected.', 'return_request': serialize_return_for_order(order_id)}

    create_notification('RETURN_APPROVED', order_id, f'Return request for {order_id} approved. Pickup initiated.')
    return {'message': 'Return request approved.', 'return_request': serialize_return_for_order(order_id)}


@app.put('/orders/{order_id}/payment')
def update_payment_status(
    order_id: str,
    payload: PaymentUpdateRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'OPERATIONS_STAFF')),
):
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        raise HTTPException(status_code=404, detail='Order not found.')

    payment = set_payment_status(order_id, payload.status, method=order.get('payment_method'))
    create_notification(
        'PAYMENT_STATUS',
        order_id,
        f"Payment status for {order_id} updated to {normalize_payment_status(payload.status)}.",
        user_id=str(order.get('user_id') or order.get('customer_email') or ''),
    )
    return {'message': 'Payment status updated.', 'payment': payment}


@app.get('/notifications/my')
def get_my_notifications(current_user: dict = Depends(get_current_user)):
    actor_id = str(current_user.get('id') or '').strip()
    actor_email = str(current_user.get('email') or '').strip().lower()
    notifications = list(
        notifications_collection.find(
            {'$or': [{'user_id': actor_id}, {'user_id': actor_email}, {'user_id': None}]},
            {'_id': 0},
        ).sort('created_at', -1)
    )
    for note in notifications:
        if isinstance(note.get('created_at'), datetime):
            note['created_at'] = note['created_at'].isoformat()
        note['is_read'] = bool(note.get('is_read', False))
        note['type'] = str(note.get('type') or 'GENERAL').strip().upper() or 'GENERAL'
    return {'notifications': notifications}


@app.put('/notifications/mark-all-read')
def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    actor_id = str(current_user.get('id') or '').strip()
    actor_email = str(current_user.get('email') or '').strip().lower()
    notifications_collection.update_many(
        {'$or': [{'user_id': actor_id}, {'user_id': actor_email}, {'user_id': None}], 'is_read': {'$ne': True}},
        {'$set': {'is_read': True, 'updated_at': now_utc()}},
    )
    return {'message': 'Notifications marked as read.'}


@app.put('/notifications/{notification_id}/read')
def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    actor_id = str(current_user.get('id') or '').strip()
    actor_email = str(current_user.get('email') or '').strip().lower()
    result = notifications_collection.update_one(
        {
            'id': str(notification_id or '').strip(),
            '$or': [{'user_id': actor_id}, {'user_id': actor_email}, {'user_id': None}],
        },
        {'$set': {'is_read': True, 'updated_at': now_utc()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail='Notification not found.')
    return {'message': 'Notification marked as read.'}


# ============================================================================
# PAYMENT METHODS MANAGEMENT
# ============================================================================

@app.get('/payment-methods')
def get_payment_methods(current_user: dict = Depends(require_roles('CUSTOMER'))):
    """Get all saved payment methods for the current user."""
    user_email = current_user['email'].strip().lower()
    user = users_collection.find_one({'email': user_email}, {'_id': 0})
    
    if not user:
        raise HTTPException(status_code=404, detail='User not found.')
    
    profile_details = user.get('profile_details', {})
    if not isinstance(profile_details, dict):
        profile_details = {}
    
    saved_methods = profile_details.get('saved_payment_methods', [])
    if not isinstance(saved_methods, list):
        saved_methods = []
    
    # Return sanitized payment methods (no sensitive data)
    return {'payment_methods': saved_methods}


@app.post('/payment-methods')
def save_payment_method(
    payload: SavePaymentMethodRequest,
    current_user: dict = Depends(require_roles('CUSTOMER'))
):
    """Save a new payment method for the user."""
    method_type = str(payload.method_type or '').strip().upper()
    if method_type not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail=f'Invalid payment method type: {method_type}')
    
    nickname = str(payload.nickname or '').strip() or f'{method_type} Payment'
    
    # Validate and sanitize based on method type
    method_id = f"PM-{uuid4().hex[:12].upper()}"
    saved_method = {
        'id': method_id,
        'method_type': method_type,
        'nickname': nickname,
        'is_default': bool(payload.is_default),
        'created_at': now_utc().isoformat(),
    }
    
    if method_type == 'UPI':
        upi_id = str(payload.upi_id or '').strip()
        if not upi_id:
            raise HTTPException(status_code=400, detail='UPI ID is required for UPI payments.')
        if not re.match(r'^[a-zA-Z0-9._-]+@[a-zA-Z]{3,}$', upi_id):
            raise HTTPException(status_code=400, detail='Invalid UPI ID format.')
        saved_method['upi_id'] = upi_id
    
    elif method_type == 'CARD':
        card_number = str(payload.card_number or '').strip().replace(' ', '')
        if not card_number or len(card_number) < 13 or len(card_number) > 19:
            raise HTTPException(status_code=400, detail='Invalid card number.')
        if not card_number.isdigit():
            raise HTTPException(status_code=400, detail='Card number must contain only digits.')
        
        card_holder = str(payload.card_holder_name or '').strip()
        if not card_holder:
            raise HTTPException(status_code=400, detail='Card holder name is required.')
        
        expiry = str(payload.card_expiry or '').strip()
        if not re.match(r'^\d{2}/\d{2}$', expiry):
            raise HTTPException(status_code=400, detail='Expiry must be in MM/YY format.')
        
        # Store only last 4 digits for security
        saved_method['card_last4'] = card_number[-4:]
        saved_method['card_holder_name'] = card_holder
        saved_method['card_expiry'] = expiry
    
    elif method_type == 'NETBANKING':
        bank_name = str(payload.bank_name or '').strip()
        if not bank_name:
            raise HTTPException(status_code=400, detail='Bank name is required for Net Banking.')
        saved_method['bank_name'] = bank_name
    
    elif method_type == 'WALLET':
        wallet_provider = str(payload.wallet_provider or '').strip()
        if not wallet_provider:
            raise HTTPException(status_code=400, detail='Wallet provider is required.')
        saved_method['wallet_provider'] = wallet_provider
    
    # Get current user and update profile
    user = users_collection.find_one({'email': current_user['email'].strip().lower()}, {'_id': 0})
    profile_details = user.get('profile_details', {}) if user else {}
    if not isinstance(profile_details, dict):
        profile_details = {}
    
    saved_methods = profile_details.get('saved_payment_methods', [])
    if not isinstance(saved_methods, list):
        saved_methods = []
    
    # If marking as default, unmark other defaults
    if saved_method['is_default']:
        for method in saved_methods:
            method['is_default'] = False
    
    saved_methods.append(saved_method)
    profile_details['saved_payment_methods'] = saved_methods
    
    users_collection.update_one(
        {'email': current_user['email'].strip().lower()},
        {'$set': {'profile_details': profile_details, 'updated_at': now_utc()}},
    )
    
    return {'message': 'Payment method saved successfully.', 'payment_method': saved_method}


@app.put('/payment-methods/{method_id}')
def update_payment_method(
    method_id: str,
    payload: UpdatePaymentMethodRequest,
    current_user: dict = Depends(require_roles('CUSTOMER'))
):
    """Update a saved payment method."""
    user = users_collection.find_one({'email': current_user['email'].strip().lower()}, {'_id': 0})
    if not user:
        raise HTTPException(status_code=404, detail='User not found.')
    
    profile_details = user.get('profile_details', {})
    if not isinstance(profile_details, dict):
        profile_details = {}
    
    saved_methods = profile_details.get('saved_payment_methods', [])
    if not isinstance(saved_methods, list):
        raise HTTPException(status_code=404, detail='Payment method not found.')
    
    # Find the payment method
    method_index = None
    for idx, method in enumerate(saved_methods):
        if method.get('id') == method_id:
            method_index = idx
            break
    
    if method_index is None:
        raise HTTPException(status_code=404, detail='Payment method not found.')
    
    # Update fields
    if payload.nickname is not None:
        saved_methods[method_index]['nickname'] = str(payload.nickname or '').strip()
    
    if payload.is_default is not None and payload.is_default:
        # Unmark other defaults
        for method in saved_methods:
            method['is_default'] = False
        saved_methods[method_index]['is_default'] = True
    elif payload.is_default is False:
        saved_methods[method_index]['is_default'] = False
    
    profile_details['saved_payment_methods'] = saved_methods
    
    users_collection.update_one(
        {'email': current_user['email'].strip().lower()},
        {'$set': {'profile_details': profile_details, 'updated_at': now_utc()}},
    )
    
    return {'message': 'Payment method updated successfully.', 'payment_method': saved_methods[method_index]}


@app.delete('/payment-methods/{method_id}')
def delete_payment_method(
    method_id: str,
    current_user: dict = Depends(require_roles('CUSTOMER'))
):
    """Delete a saved payment method."""
    user = users_collection.find_one({'email': current_user['email'].strip().lower()}, {'_id': 0})
    if not user:
        raise HTTPException(status_code=404, detail='User not found.')
    
    profile_details = user.get('profile_details', {})
    if not isinstance(profile_details, dict):
        profile_details = {}
    
    saved_methods = profile_details.get('saved_payment_methods', [])
    if not isinstance(saved_methods, list):
        raise HTTPException(status_code=404, detail='Payment method not found.')
    
    # Find and remove the payment method
    updated_methods = [m for m in saved_methods if m.get('id') != method_id]
    
    if len(updated_methods) == len(saved_methods):
        raise HTTPException(status_code=404, detail='Payment method not found.')
    
    profile_details['saved_payment_methods'] = updated_methods
    
    users_collection.update_one(
        {'email': current_user['email'].strip().lower()},
        {'$set': {'profile_details': profile_details, 'updated_at': now_utc()}},
    )
    
    return {'message': 'Payment method deleted successfully.'}


def get_platform_branding_document() -> dict:
    branding = platform_settings_collection.find_one({'key': 'branding'}, {'_id': 0})
    if branding:
        return branding
    return {
        'key': 'branding',
        'platform_name': 'Movi Fashion',
        'logo_url': '/movicloud%20logo.png',
        'updated_at': now_utc().isoformat(),
    }


@app.get('/public/platform-settings')
def get_public_platform_settings():
    branding = get_platform_branding_document()
    return {
        'platform_name': str(branding.get('platform_name') or 'Movi Fashion').strip() or 'Movi Fashion',
        'logo_url': str(branding.get('logo_url') or '/movicloud%20logo.png').strip() or '/movicloud%20logo.png',
        'updated_at': branding.get('updated_at'),
    }


@app.get('/public/banners')
def get_public_banners():
    approved = list(
        banners_collection.find({'status': 'APPROVED'}, {'_id': 0}).sort('updated_at', -1)
    )
    return {'banners': approved}


@app.get('/public/global-offer')
def get_public_global_offer():
    offer = global_offers_collection.find_one({'key': 'global'}, {'_id': 0})
    if not offer:
        return {'offer': None}
    if not bool(offer.get('active')):
        return {'offer': None}
    return {'offer': offer}


@app.post('/merchant/banner-requests')
def create_banner_request(
    payload: BannerRequestCreateRequest,
    current_user: dict = Depends(require_roles('ADMIN', 'MERCHANT')),
):
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        raise HTTPException(status_code=400, detail='Unable to resolve merchant account id.')

    banner = {
        'id': f"BNR-{uuid4().hex[:10].upper()}",
        'merchant_id': merchant_id,
        'merchant_email': str(current_user.get('email') or '').strip().lower(),
        'title': str(payload.title or '').strip(),
        'subtitle': str(payload.subtitle or '').strip(),
        'image_url': str(payload.image_url or '').strip(),
        'target_path': str(payload.target_path or '/products').strip() or '/products',
        'offer_text': str(payload.offer_text or '').strip(),
        'status': 'PENDING',
        'rejection_reason': '',
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }

    if not banner['title']:
        raise HTTPException(status_code=400, detail='Banner title is required.')
    if not banner['image_url']:
        raise HTTPException(status_code=400, detail='Banner image URL is required.')

    banners_collection.insert_one(banner)
    banner.pop('_id', None)
    return {'message': 'Banner request submitted for review.', 'banner': banner}


@app.get('/merchant/banner-requests')
def get_merchant_banner_requests(
    current_user: dict = Depends(require_roles('ADMIN', 'MERCHANT')),
):
    merchant_id = str(current_user.get('id') or '').strip()
    if not merchant_id:
        return {'banners': []}
    banners = list(banners_collection.find({'merchant_id': merchant_id}, {'_id': 0}).sort('created_at', -1))
    return {'banners': banners}


@app.get('/super-admin/overview')
def get_super_admin_overview(current_user: dict = Depends(require_roles('SUPER_ADMIN'))):
    _ = current_user
    total_orders = orders_collection.count_documents({})
    total_users = users_collection.count_documents({})
    total_merchants = users_collection.count_documents({'role': {'$in': ['ADMIN', 'MERCHANT']}})
    pending_merchants = users_collection.count_documents(
        {'role': {'$in': ['ADMIN', 'MERCHANT']}, 'merchant_status': 'PENDING'}
    )
    pending_banners = banners_collection.count_documents({'status': 'PENDING'})
    pending_products = products_collection.count_documents({'review_status': 'PENDING'})

    revenue_sum = 0.0
    for order in orders_collection.find({}, {'_id': 0, 'total_amount': 1}):
        revenue_sum += float(order.get('total_amount') or 0)

    return {
        'analytics': {
            'orders': total_orders,
            'users': total_users,
            'merchants': total_merchants,
            'pending_merchants': pending_merchants,
            'pending_banners': pending_banners,
            'pending_products': pending_products,
            'revenue': round(revenue_sum, 2),
        },
        'secret_path_configured': bool(str(SUPER_ADMIN_SECRET_PATH or '').strip()),
    }


@app.get('/super-admin/merchants')
def get_super_admin_merchants(current_user: dict = Depends(require_roles('SUPER_ADMIN'))):
    _ = current_user
    merchants = list(
        users_collection.find(
            {'role': {'$in': ['ADMIN', 'MERCHANT']}},
            {'_id': 0},
        ).sort('created_at', -1)
    )
    return {'merchants': [serialize_user(item) for item in merchants]}


@app.put('/super-admin/merchants/{merchant_id}/decision')
def decide_super_admin_merchant(
    merchant_id: str,
    payload: SuperAdminMerchantDecisionRequest,
    current_user: dict = Depends(require_roles('SUPER_ADMIN')),
):
    _ = current_user
    next_merchant_status = normalize_merchant_status(payload.merchant_status, fallback='PENDING')
    next_status = 'ACTIVE' if payload.active else 'BLOCKED'
    if next_merchant_status == 'REJECTED':
        next_status = 'BLOCKED'

    result = users_collection.update_one(
        {'id': merchant_id, 'role': {'$in': ['ADMIN', 'MERCHANT']}},
        {
            '$set': {
                'merchant_status': next_merchant_status,
                'status': next_status,
                'updated_at': now_utc(),
            }
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail='Merchant account not found.')

    updated = users_collection.find_one({'id': merchant_id})
    return {'message': 'Merchant review decision saved.', 'merchant': serialize_user(updated)}


@app.get('/super-admin/products/pending')
def get_super_admin_pending_products(current_user: dict = Depends(require_roles('SUPER_ADMIN'))):
    _ = current_user
    products = list(products_collection.find({'review_status': {'$in': ['PENDING', 'REJECTED']}}, {'_id': 0}).sort('updated_at', -1))
    return {'products': [serialize_product(item) for item in products]}


@app.put('/super-admin/products/{product_id}/decision')
def decide_super_admin_product(
    product_id: int,
    payload: SuperAdminProductDecisionRequest,
    current_user: dict = Depends(require_roles('SUPER_ADMIN')),
):
    _ = current_user
    next_status = normalize_product_review_status(payload.status, fallback='PENDING')
    result = products_collection.update_one(
        {'id': product_id},
        {'$set': {'review_status': next_status, 'updated_at': now_utc()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail='Product not found.')

    updated = products_collection.find_one({'id': product_id}, {'_id': 0})
    return {'message': 'Product review decision saved.', 'product': serialize_product(updated)}


@app.get('/super-admin/banner-requests')
def get_super_admin_banner_requests(current_user: dict = Depends(require_roles('SUPER_ADMIN'))):
    _ = current_user
    banners = list(banners_collection.find({}, {'_id': 0}).sort('created_at', -1))
    return {'banners': banners}


@app.put('/super-admin/banner-requests/{banner_id}/decision')
def decide_super_admin_banner(
    banner_id: str,
    payload: SuperAdminBannerDecisionRequest,
    current_user: dict = Depends(require_roles('SUPER_ADMIN')),
):
    _ = current_user
    next_status = normalize_banner_status(payload.status, fallback='PENDING')
    rejection_reason = str(payload.rejection_reason or '').strip()
    result = banners_collection.update_one(
        {'id': banner_id},
        {
            '$set': {
                'status': next_status,
                'rejection_reason': rejection_reason if next_status == 'REJECTED' else '',
                'updated_at': now_utc(),
            }
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail='Banner request not found.')

    updated = banners_collection.find_one({'id': banner_id}, {'_id': 0})
    return {'message': 'Banner review decision saved.', 'banner': updated}


@app.get('/super-admin/platform-branding')
def get_super_admin_platform_branding(current_user: dict = Depends(require_roles('SUPER_ADMIN'))):
    _ = current_user
    branding = get_platform_branding_document()
    branding.pop('_id', None)
    return {'branding': branding}


@app.put('/super-admin/platform-branding')
def update_super_admin_platform_branding(
    payload: PlatformBrandingUpdateRequest,
    current_user: dict = Depends(require_roles('SUPER_ADMIN')),
):
    _ = current_user
    name = str(payload.platform_name or '').strip()
    logo_url = str(payload.logo_url or '').strip()
    if not name:
        raise HTTPException(status_code=400, detail='Platform name is required.')
    if not logo_url:
        raise HTTPException(status_code=400, detail='Logo URL is required.')

    now = now_utc()
    platform_settings_collection.update_one(
        {'key': 'branding'},
        {
            '$set': {
                'platform_name': name,
                'logo_url': logo_url,
                'updated_at': now,
            },
            '$setOnInsert': {
                'key': 'branding',
                'created_at': now,
            },
        },
        upsert=True,
    )
    return {'message': 'Platform branding updated successfully.', 'branding': get_platform_branding_document()}


@app.get('/super-admin/offers/global')
def get_super_admin_global_offer(current_user: dict = Depends(require_roles('SUPER_ADMIN'))):
    _ = current_user
    offer = global_offers_collection.find_one({'key': 'global'}, {'_id': 0})
    if not offer:
        offer = {
            'key': 'global',
            'title': '',
            'description': '',
            'discount_percent': 0,
            'code': '',
            'active': False,
        }
    return {'offer': offer}


@app.put('/super-admin/offers/global')
def update_super_admin_global_offer(
    payload: GlobalOfferUpdateRequest,
    current_user: dict = Depends(require_roles('SUPER_ADMIN')),
):
    _ = current_user
    discount_percent = float(payload.discount_percent or 0)
    if discount_percent < 0 or discount_percent > 90:
        raise HTTPException(status_code=400, detail='Discount percent must be between 0 and 90.')

    now = now_utc()
    global_offers_collection.update_one(
        {'key': 'global'},
        {
            '$set': {
                'title': str(payload.title or '').strip(),
                'description': str(payload.description or '').strip(),
                'discount_percent': discount_percent,
                'code': str(payload.code or '').strip(),
                'active': bool(payload.active),
                'updated_at': now,
            },
            '$setOnInsert': {
                'key': 'global',
                'created_at': now,
            },
        },
        upsert=True,
    )

    offer = global_offers_collection.find_one({'key': 'global'}, {'_id': 0})
    return {'message': 'Global offer updated successfully.', 'offer': offer}

