import os
import random
import re
from datetime import UTC, datetime, timedelta
from typing import Callable
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
import mongomock
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

JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'veloura-dev-secret-change-me')
JWT_ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv('JWT_ACCESS_TOKEN_EXPIRE_HOURS', '12'))

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
SHIPMENT_ENTITY_STATUSES = ['CREATED', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED']
DELIVERY_FINAL_STATES = {'OUT_FOR_DELIVERY', 'DELIVERED'}
ADMIN_ALLOWED_STATES = {'CONFIRMED', 'SHIPPED'}
OPERATIONS_ALLOWED_STATES = {'PACKED'}
DELIVERY_ALLOWED_STATES = {'OUT_FOR_DELIVERY', 'DELIVERED'}
PAYMENT_STATUSES = {'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'}
RETURN_STATUS_FLOW = ['RETURN_REQUESTED', 'PICKUP', 'RETURNED', 'REFUNDED']
SPECIAL_ORDER_STATUSES = {'CANCELLED'}
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


class OrderItemCreateRequest(BaseModel):
    product_id: int
    quantity: int


class CreateOrderRequest(BaseModel):
    items: list[OrderItemCreateRequest]
    pincode: str
    payment_method: str = 'COD'


class UpdateOrderStatusRequest(BaseModel):
    status: str
    current_location: str | None = None


class PaymentUpdateRequest(BaseModel):
    status: str


class ReturnUpdateRequest(BaseModel):
    status: str
    location: str | None = None


class CancelOrderRequest(BaseModel):
    reason: str | None = None


class CreateShipmentRequest(BaseModel):
    order_ids: list[str]
    warehouse_id: str | None = None
    status: str = 'CREATED'
    courier_name: str = 'Assigned courier'
    tracking_id: str | None = None
    assigned_delivery_id: str | None = None
    max_orders_per_shipment: int | None = None


class AutoCreateShipmentRequest(BaseModel):
    max_orders_per_shipment: int | None = None


class AccountStatusUpdateRequest(BaseModel):
    status: str = 'ACTIVE'


class DeliveryCoverageCity(BaseModel):
    state: str
    city: str


class DeliveryCoverageRequest(BaseModel):
    delivery_scope: str = 'NATIONWIDE'
    states: list[str] | None = None
    cities: list[DeliveryCoverageCity] | None = None
    deliver_all_cities_in_selected_states: bool = False


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

SEED_USERS = {
    'admin.demo@veloura.com': {
        'id': 'USR-DEMO-ADMIN-01',
        'full_name': 'Demo Admin',
        'email': 'admin.demo@veloura.com',
        'password': 'Admin#Demo2026',
        'provider': 'email',
        'role': 'ADMIN',
        'status': 'ACTIVE',
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

SEED_SHIPMENTS = [
    {
        'shipment_id': 'SHIP-1001',
        'courier_name': 'Delhivery',
        'tracking_id': 'DLV1001',
        'status': 'SHIPPED',
        'current_location': 'Mumbai Hub',
        'updated_at': datetime.now(UTC),
    },
    {
        'shipment_id': 'SHIP-1002',
        'courier_name': 'BlueDart',
        'tracking_id': 'BLD1002',
        'status': 'OUT_FOR_DELIVERY',
        'current_location': 'Bengaluru Hub',
        'updated_at': datetime.now(UTC),
    },
]

SEED_ORDERS = [
    {
        'order_id': 'ORD-1001',
        'customer_email': 'customer.demo@veloura.com',
        'items': [{'product_id': 1, 'name': 'Architectural Blazer', 'quantity': 1, 'price': 450.0}],
        'total_amount': 450.0,
        'status': 'SHIPPED',
        'shipment_id': 'SHIP-1001',
        'assigned_delivery_partner': 'delivery.demo@veloura.com',
        'created_at': datetime.now(UTC),
        'updated_at': datetime.now(UTC),
    },
    {
        'order_id': 'ORD-1002',
        'customer_email': 'customer.demo@veloura.com',
        'items': [{'product_id': 2, 'name': 'Atelier Cashmere Crew', 'quantity': 1, 'price': 295.0}],
        'total_amount': 295.0,
        'status': 'OUT_FOR_DELIVERY',
        'shipment_id': 'SHIP-1002',
        'assigned_delivery_partner': 'delivery.demo@veloura.com',
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

mongo_client = MongoClient(mongo_uri, **mongo_client_options)
database = mongo_client[mongo_db_name]
products_collection = database['products']
users_collection = database['users']
orders_collection = database['orders']
order_items_collection = database['order_items']
shipments_collection = database['shipments']
shipment_items_collection = database['shipment_items']
delivery_logs_collection = database['delivery_logs']
warehouses_collection = database['warehouses']
delivery_coverage_collection = database['delivery_coverage']
payments_collection = database['payments']
returns_collection = database['returns']
notifications_collection = database['notifications']
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
    global warehouses_collection
    global delivery_coverage_collection
    global payments_collection
    global returns_collection
    global notifications_collection
    global database_mode

    mongo_client = mongomock.MongoClient()
    database = mongo_client[mongo_db_name]
    products_collection = database['products']
    users_collection = database['users']
    orders_collection = database['orders']
    order_items_collection = database['order_items']
    shipments_collection = database['shipments']
    shipment_items_collection = database['shipment_items']
    delivery_logs_collection = database['delivery_logs']
    warehouses_collection = database['warehouses']
    delivery_coverage_collection = database['delivery_coverage']
    payments_collection = database['payments']
    returns_collection = database['returns']
    notifications_collection = database['notifications']
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
    }
    canonical = role_aliases.get(role, role)
    if canonical in {'CUSTOMER', 'ADMIN', 'DELIVERY_ASSOCIATE', 'OPERATIONS_STAFF'}:
        return canonical
    return 'CUSTOMER'


def normalize_account_status(value: str, fallback: str = 'ACTIVE') -> str:
    status_value = (value or fallback).strip().upper()
    if status_value in {'ACTIVE', 'PENDING', 'BLOCKED'}:
        return status_value
    return fallback


def hash_password(password: str) -> str:
    return PASSWORD_CONTEXT.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return PASSWORD_CONTEXT.verify(plain, hashed)


def create_access_token(subject_email: str, role: str) -> str:
    expires_at = now_utc() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        'sub': subject_email,
        'role': normalize_role(role),
        'exp': expires_at,
        'iat': now_utc(),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def serialize_product(document: dict) -> dict:
    payload = dict(document)
    payload.pop('_id', None)
    return payload


def serialize_user(document: dict) -> dict:
    payload = dict(document)
    payload.pop('_id', None)
    payload.pop('password', None)
    payload.pop('password_hash', None)
    payload['id'] = payload.get('id') or payload.get('user_id') or ''
    payload['name'] = payload.get('name') or payload.get('full_name') or ''
    payload['role'] = normalize_role(payload.get('role', 'CUSTOMER'))
    payload['status'] = normalize_account_status(payload.get('status', 'ACTIVE'))
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
    if candidate in ORDER_STATUS_FLOW or candidate in SPECIAL_ORDER_STATUSES:
        return candidate
    return fallback


def normalize_shipment_entity_status(value: str, fallback: str = 'CREATED') -> str:
    candidate = (value or fallback).strip().upper()
    if candidate in SHIPMENT_ENTITY_STATUSES:
        return candidate
    return fallback


def can_progress_order(current_status: str, next_status: str) -> bool:
    current = normalize_order_status(current_status)
    nxt = normalize_order_status(next_status)
    if current in SPECIAL_ORDER_STATUSES or nxt in SPECIAL_ORDER_STATUSES:
        return False
    current_index = ORDER_STATUS_FLOW.index(current)
    next_index = ORDER_STATUS_FLOW.index(nxt)
    return next_index == current_index + 1


def append_delivery_log(order_id: str, status_value: str, updated_by: str, location: str = '') -> None:
    delivery_logs_collection.insert_one(
        {
            'id': f"DLOG-{uuid4().hex[:12].upper()}",
            'order_id': order_id,
            'status': normalize_order_status(status_value),
            'updated_by': updated_by,
            'location': location,
            'timestamp': now_utc(),
        }
    )


def get_order_items(order_id: str) -> list[dict]:
    items = list(order_items_collection.find({'order_id': order_id}, {'_id': 0}))
    return items


def get_tracking_logs(order_id: str) -> list[dict]:
    logs = list(delivery_logs_collection.find({'order_id': order_id}).sort('timestamp', 1))
    return [serialize_delivery_log(log) for log in logs]


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


def normalize_return_status(value: str, fallback: str = 'RETURN_REQUESTED') -> str:
    candidate = str(value or fallback).strip().upper()
    if candidate in RETURN_STATUS_FLOW:
        return candidate
    return fallback


def build_initial_status_timestamps(initial_status: str) -> dict:
    normalized = normalize_order_status(initial_status)
    return {normalized: now_utc().isoformat()}


def append_status_timestamp(order_id: str, status_value: str) -> None:
    normalized = normalize_order_status(status_value)
    orders_collection.update_one(
        {'order_id': order_id},
        {'$set': {f'status_timestamps.{normalized}': now_utc().isoformat()}},
    )


def create_notification(event_type: str, order_id: str, message: str, user_id: str | None = None) -> None:
    notifications_collection.insert_one(
        {
            'id': f"NOTIF-{uuid4().hex[:12].upper()}",
            'event_type': str(event_type or '').strip().upper(),
            'order_id': order_id,
            'user_id': user_id,
            'message': message,
            'created_at': now_utc(),
        }
    )


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


def set_payment_status(order_id: str, status_value: str, method: str | None = None, reason: str | None = None) -> dict:
    normalized = normalize_payment_status(status_value)
    existing = payments_collection.find_one({'order_id': order_id})
    payment_method = str(method or (existing or {}).get('method') or 'COD').strip().upper()
    payload = {
        'order_id': order_id,
        'payment_id': (existing or {}).get('payment_id') or f"PAY-{uuid4().hex[:12].upper()}",
        'method': payment_method,
        'status': normalized,
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
    profile = partner.get('profile_details') or {}
    availability = str(profile.get('availability') or '').strip().upper().replace('-', '_')
    if availability == 'FULL_TIME':
        score += 4
    elif availability == 'PART_TIME':
        score += 2

    service_pincodes = parse_service_pincodes(profile.get('service_pincodes') or profile.get('service_pincode'))
    if destination_pincode in service_pincodes:
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

    workload_map = get_delivery_partner_workload()
    ranked = sorted(
        partners,
        key=lambda partner: score_delivery_partner(partner, destination, destination_pincode, workload_map),
        reverse=True,
    )
    selected = ranked[0]
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
    users_collection.create_index('email', unique=True)
    users_collection.create_index([('role', 1), ('status', 1)])
    orders_collection.create_index('order_id', unique=True)
    orders_collection.create_index([('user_id', 1), ('created_at', -1)])
    orders_collection.create_index([('status', 1), ('updated_at', -1)])
    shipments_collection.create_index('shipment_id', unique=True)
    shipments_collection.create_index('tracking_id', unique=True)
    order_items_collection.create_index([('order_id', 1), ('product_id', 1)])
    shipment_items_collection.create_index([('shipment_id', 1), ('order_id', 1)], unique=True)
    delivery_logs_collection.create_index([('order_id', 1), ('timestamp', 1)])
    warehouses_collection.create_index('warehouse_id', unique=True)
    warehouses_collection.create_index([('product_id', 1), ('pincode', 1)])
    delivery_coverage_collection.create_index('merchant_id', unique=True)
    payments_collection.create_index('order_id', unique=True)
    returns_collection.create_index('order_id', unique=True)
    notifications_collection.create_index([('order_id', 1), ('created_at', -1)])


def seed_products() -> None:
    if products_collection.count_documents({}) == 0:
        products_collection.insert_many(SEED_PRODUCTS)


def seed_users() -> None:
    for _, account in SEED_USERS.items():
        email = account['email'].strip().lower()
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
                    'password_hash': hash_password(account['password']),
                    'updated_at': now_utc(),
                },
                '$unset': {'password': ''},
                '$setOnInsert': {'created_at': now_utc()},
            },
            upsert=True,
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

        payment_method = str(order.get('payment_method') or 'COD').strip().upper()
        if payment_method not in {'COD', 'ONLINE'}:
            payment_method = 'COD'

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


def backfill_user_auth_shape() -> None:
    projection = {'_id': 1, 'id': 1, 'role': 1, 'status': 1, 'full_name': 1, 'name': 1}
    for account in users_collection.find({}, projection):
        users_collection.update_one(
            {'_id': account['_id']},
            {
                '$set': {
                    'id': account.get('id') or f"USR-{uuid4().hex[:10].upper()}",
                    'role': normalize_role(account.get('role', 'CUSTOMER')),
                    'status': normalize_account_status(account.get('status', 'ACTIVE')),
                    'name': account.get('name') or account.get('full_name') or 'User',
                    'updated_at': now_utc(),
                }
            },
        )


def seed_collections() -> None:
    seed_products()
    seed_users()
    seed_shipments()
    seed_orders()
    seed_warehouses()
    backfill_product_warehouses()
    backfill_user_auth_shape()
    backfill_nationwide_delivery_coverage()
    backfill_order_items_and_logs()
    backfill_orders_workflow_state()


@app.on_event('startup')
def ensure_database_ready() -> None:
    try:
        mongo_client.admin.command('ping')
        ensure_indexes()
        seed_collections()
    except PyMongoError as exc:
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
    products = list(products_collection.find({}, {'_id': 0}))
    return [serialize_product(product) for product in products]


@app.get('/product/{product_id}')
def get_product(product_id: int):
    product = products_collection.find_one({'id': product_id}, {'_id': 0})
    if not product:
        return {'error': 'Product not found'}
    return serialize_product(product)


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

    return {
        'message': f"Welcome back, {account['full_name']}!",
        'role': role,
        'status': account_status,
        'token': token,
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

    normalized_role = normalize_role(payload.role)
    account_status = 'PENDING' if normalized_role in {'DELIVERY_ASSOCIATE', 'OPERATIONS_STAFF'} else 'ACTIVE'

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

    token = create_access_token(email, normalize_role(account.get('role', 'CUSTOMER')))
    return {
        'message': f"Signed in with Google as {account['full_name']}.",
        'role': normalize_role(account.get('role', 'CUSTOMER')),
        'status': normalize_account_status(account.get('status', 'ACTIVE')),
        'token': token,
        'user': serialize_user(account),
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


def apply_order_status_update(order: dict, next_status: str, actor_id: str, location: str = '') -> dict:
    current_status = normalize_order_status(order.get('status', 'PLACED'))
    target_status = normalize_order_status(next_status)

    if current_status != target_status and not can_progress_order(current_status, target_status):
        raise HTTPException(
            status_code=400,
            detail=f'Invalid status transition. Allowed next status from {current_status} is {ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.index(current_status) + 1] if current_status != ORDER_STATUS_FLOW[-1] else current_status}.',
        )

    orders_collection.update_one(
        {'order_id': order['order_id']},
        {
            '$set': {
                'status': target_status,
                'updated_at': now_utc(),
            }
        },
    )
    append_status_timestamp(order['order_id'], target_status)
    append_delivery_log(order['order_id'], target_status, actor_id, location=location)

    customer_id = str(order.get('user_id') or order.get('customer_email') or '').strip() or None
    create_notification(
        event_type=target_status,
        order_id=order['order_id'],
        message=f"Order {order['order_id']} moved to {target_status.replace('_', ' ')}.",
        user_id=customer_id,
    )

    if target_status == 'PACKED':
        # Real-world style automation: packed orders are eligible for immediate shipment generation.
        admin_user = users_collection.find_one({'role': 'ADMIN'}, {'_id': 0, 'id': 1, 'email': 1}) or {}
        auto_actor = str(admin_user.get('id') or admin_user.get('email') or actor_id)
        create_shipment(
            CreateShipmentRequest(
                order_ids=[order['order_id']],
                status='DISPATCHED',
                courier_name='Assigned courier',
                tracking_id='',
            ),
            {'id': auto_actor, 'email': str(admin_user.get('email') or 'system@local')},
        )

    if target_status == 'CONFIRMED':
        reduce_inventory_for_order(order['order_id'], order.get('warehouse_id'))

    if target_status == 'DELIVERED':
        payment = payments_collection.find_one({'order_id': order['order_id']}, {'_id': 0}) or {}
        method = str(payment.get('method') or 'COD').upper()
        if method == 'COD':
            set_payment_status(order['order_id'], 'SUCCESS', method='COD')

    latest = orders_collection.find_one({'order_id': order['order_id']})
    return latest


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
        if not product:
            raise HTTPException(status_code=404, detail=f'Product {request_item.product_id} not found.')

        line_total = float(product.get('price', 0)) * int(request_item.quantity)
        total_amount += line_total
        materialized_items.append(
            {
                'product_id': request_item.product_id,
                'quantity': int(request_item.quantity),
                'name': product.get('name', 'Product'),
                'price': float(product.get('price', 0)),
            }
        )

    first_product_id = materialized_items[0]['product_id']
    user_location = get_location_for_pincode(cleaned_pincode)
    selected_warehouse = choose_best_warehouse(first_product_id, user_location)

    order_id = f"ORD-{uuid4().hex[:10].upper()}"
    payment_method = str(payload.payment_method or 'COD').strip().upper()
    if payment_method not in {'COD', 'ONLINE'}:
        raise HTTPException(status_code=400, detail='Payment method must be COD or ONLINE.')

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
        'payment_method': payment_method,
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

    append_delivery_log(order_id, 'PLACED', current_user.get('id') or current_user.get('email', 'customer'))

    create_notification(
        event_type='ORDER_PLACED',
        order_id=order_id,
        message=f'Order {order_id} placed successfully.',
        user_id=str(current_user.get('id') or current_user.get('email') or ''),
    )

    if payment_method == 'ONLINE':
        online_status = 'SUCCESS' if random.random() >= 0.15 else 'FAILED'
        set_payment_status(order_id, online_status, method='ONLINE')
        if online_status == 'SUCCESS':
            latest_for_confirm = orders_collection.find_one({'order_id': order_id})
            if latest_for_confirm:
                apply_order_status_update(
                    latest_for_confirm,
                    'CONFIRMED',
                    str(current_user.get('id') or current_user.get('email', 'customer')),
                    location='Payment gateway confirmation',
                )
        else:
            create_notification(
                event_type='PAYMENT_FAILED',
                order_id=order_id,
                message=f'Payment failed for order {order_id}.',
                user_id=str(current_user.get('id') or current_user.get('email') or ''),
            )
    else:
        set_payment_status(order_id, 'PENDING', method='COD')
        latest_for_confirm = orders_collection.find_one({'order_id': order_id})
        if latest_for_confirm:
            apply_order_status_update(
                latest_for_confirm,
                'CONFIRMED',
                str(current_user.get('id') or current_user.get('email', 'customer')),
                location='Order confirmation',
            )

    latest = orders_collection.find_one({'order_id': order_id})
    return {'message': 'Order placed successfully.', 'order': serialize_order(latest, include_shipment=True)}


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

    if actor_role == 'OPERATIONS_STAFF':
        if target_status not in OPERATIONS_ALLOWED_STATES:
            raise HTTPException(status_code=403, detail='Only operations staff can mark orders as PACKED.')
    elif actor_role == 'ADMIN':
        if target_status not in ADMIN_ALLOWED_STATES:
            raise HTTPException(status_code=403, detail='Only CONFIRMED and SHIPPED can be set by admin.')
    elif actor_role == 'DELIVERY_ASSOCIATE':
        if target_status not in DELIVERY_ALLOWED_STATES:
            raise HTTPException(status_code=403, detail='Delivery associates can only set OUT_FOR_DELIVERY and DELIVERED.')
        if order.get('assigned_delivery_id') not in {current_user.get('id'), None} and order.get('assigned_delivery_partner') != current_user.get('email', '').strip().lower():
            raise HTTPException(status_code=403, detail='Order is not assigned to this delivery partner.')
    else:
        raise HTTPException(status_code=403, detail='Only staff can update order statuses.')

    latest = apply_order_status_update(order, target_status, str(actor_id), location=(payload.current_location or '').strip())
    return {'message': f'Order moved to {target_status}.', 'order': serialize_order(latest, include_shipment=True)}


@app.get('/admin/orders')
def get_admin_orders(current_user: dict = Depends(require_roles('admin', 'merchant'))):
    _ = current_user
    orders = list(orders_collection.find().sort('created_at', -1))
    return {'orders': [serialize_order(order, include_shipment=True) for order in orders]}


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
def create_shipment(payload: CreateShipmentRequest, current_user: dict = Depends(require_roles('ADMIN'))):
    if not payload.order_ids:
        raise HTTPException(status_code=400, detail='Select at least one order.')

    unique_order_ids = list(dict.fromkeys(payload.order_ids))
    orders = list(orders_collection.find({'order_id': {'$in': unique_order_ids}}))
    if len(orders) != len(unique_order_ids):
        raise HTTPException(status_code=404, detail='One or more orders were not found.')

    max_orders = normalize_max_orders_per_shipment(payload.max_orders_per_shipment)
    order_batches = group_orders_for_shipments(orders, max_orders)
    if not order_batches:
        raise HTTPException(status_code=400, detail='Unable to group selected orders for shipment creation.')

    shipment_entity_status = normalize_shipment_entity_status(payload.status, fallback='CREATED')

    manual_partner = find_user_by_id_or_email(payload.assigned_delivery_id or '') if payload.assigned_delivery_id else None
    manual_partner_email = manual_partner.get('email').strip().lower() if manual_partner else None
    manual_partner_id = manual_partner.get('id') if manual_partner else None
    explicit_courier = str(payload.courier_name or '').strip()
    explicit_tracking = str(payload.tracking_id or '').strip()

    created_shipments = []
    for batch_index, batch_orders in enumerate(order_batches):
        primary_order = batch_orders[0]
        destination = get_order_destination_location(primary_order)
        destination_pincode = sanitize_pincode(primary_order.get('destination_pincode', ''))
        warehouse = get_warehouse_location(primary_order)

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
                'route_city': destination.get('city'),
                'route_state': destination.get('state'),
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

            latest_order = orders_collection.find_one({'order_id': order['order_id']})
            if not latest_order:
                continue

            if normalize_order_status(latest_order.get('status', 'PLACED')) != 'SHIPPED':
                latest_order = apply_order_status_update(
                    latest_order,
                    'SHIPPED',
                    str(current_user.get('id') or current_user.get('email', 'admin')),
                    location='Warehouse dispatch',
                )

            orders_collection.update_one(
                {'order_id': order['order_id']},
                {
                    '$set': {
                        'shipment_id': shipment_id,
                        'assigned_delivery_partner': assigned_partner_email or latest_order.get('assigned_delivery_partner'),
                        'assigned_delivery_id': assigned_partner_id or latest_order.get('assigned_delivery_id'),
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
        'message': f'Shipment automation complete. Created {len(created_shipments)} shipment(s).',
        'shipment': first_shipment,
        'shipments': created_shipments,
        'order_ids': unique_order_ids,
        'shipments_created': len(created_shipments),
    }


@app.post('/shipments/auto')
def auto_create_shipments(payload: AutoCreateShipmentRequest, current_user: dict = Depends(require_roles('ADMIN'))):
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
        status='DISPATCHED',
        courier_name='Assigned courier',
        tracking_id='',
        assigned_delivery_id=None,
        max_orders_per_shipment=payload.max_orders_per_shipment,
    )
    return create_shipment(request_payload, current_user)


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
            }
        ).sort('updated_at', -1)
    )
    return {'orders': [serialize_order(order, include_shipment=True) for order in orders]}


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
def update_delivery_status(
    payload: DeliveryStatusUpdateRequest,
    current_user: dict = Depends(require_roles('DELIVERY_ASSOCIATE')),
):
    email = current_user['email'].strip().lower()
    status_value = normalize_order_status(payload.status)

    if status_value not in DELIVERY_FINAL_STATES:
        raise HTTPException(status_code=400, detail='Delivery status must be OUT_FOR_DELIVERY or DELIVERED.')

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

    latest = apply_order_status_update(
        order,
        status_value,
        str(current_user.get('id') or current_user.get('email', 'delivery')),
        location=(payload.current_location or '').strip() or 'Last mile route',
    )
    return {'message': 'Delivery status updated.', 'order': serialize_order(latest, include_shipment=True)}


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
    if current_status in {'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'}:
        raise HTTPException(status_code=400, detail='Order cannot be cancelled after shipping.')
    if current_status == 'CANCELLED':
        raise HTTPException(status_code=400, detail='Order is already cancelled.')

    orders_collection.update_one(
        {'order_id': order_id},
        {
            '$set': {
                'status': 'CANCELLED',
                'cancellation_reason': str(payload.reason or '').strip(),
                'updated_at': now_utc(),
                'status_timestamps.CANCELLED': now_utc().isoformat(),
            }
        },
    )
    append_delivery_log(order_id, 'CANCELLED', actor_id or actor_email or 'customer', location='Order cancelled by customer')
    set_payment_status(order_id, 'REFUNDED', reason='Order cancelled before shipping')
    create_notification('ORDER_CANCELLED', order_id, f'Order {order_id} cancelled by customer.', user_id=actor_id or actor_email)
    latest = orders_collection.find_one({'order_id': order_id})
    return {'message': 'Order cancelled successfully.', 'order': serialize_order(latest, include_shipment=True)}


@app.post('/orders/{order_id}/return-request')
def request_order_return(order_id: str, current_user: dict = Depends(require_roles('CUSTOMER'))):
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

    returns_collection.insert_one(
        {
            'id': f"RET-{uuid4().hex[:12].upper()}",
            'order_id': order_id,
            'status': 'RETURN_REQUESTED',
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
    if current_status != target_status:
        current_index = RETURN_STATUS_FLOW.index(current_status)
        target_index = RETURN_STATUS_FLOW.index(target_status)
        if target_index != current_index + 1:
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
    return {'notifications': notifications}


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
