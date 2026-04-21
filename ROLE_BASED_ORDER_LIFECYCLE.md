# Role-Based Order Lifecycle System with Real-Time Updates

## Overview
This document describes the complete implementation of a strict role-based order lifecycle system with real-time WebSocket-based updates across merchant, operations, delivery, and customer interfaces.

## System Architecture

### Order Status Flow (Immutable Sequence)
```
PLACED → CONFIRMED → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED
```

Special Statuses:
- `CANCELLED` - Can be set from PLACED, CONFIRMED, or PACKED
- `DELIVERY_FAILED` - Can be set during delivery phase

### Role-Based Permissions

#### Customer
- **Permissions**: Read-only access to own orders
- **Actions**: 
  - View order tracking
  - Request return (only on DELIVERED orders)
  - Cancel order (only on PLACED, CONFIRMED, PACKED)
- **Receives**: Real-time notifications on status changes

#### Merchant/Admin
- **Permissions**: Update CONFIRMED and SHIPPED statuses
- **Actions**:
  - Confirm orders (PLACED → CONFIRMED)
  - Update to SHIPPED status
  - View all orders
  - Generate shipments
- **Audit**: All actions logged with timestamp, performer role, and performer email

#### Operations Staff
- **Permissions**: Mark orders as PACKED
- **Actions**:
  - Update order status to PACKED
  - View assigned orders
- **Audit**: All actions logged with timestamp and performer role

#### Delivery Partner
- **Permissions**: Update OUT_FOR_DELIVERY and DELIVERED statuses
- **Actions**:
  - Accept delivery
  - Mark as OUT_FOR_DELIVERY
  - Mark as DELIVERED
  - Report DELIVERY_FAILED
  - Can only act on assigned orders
- **Audit**: All actions logged with location and performer details

---

## Backend Implementation

### 1. Enhanced Data Models

#### OrderStatusHistoryEntry
```python
{
    'status': str,              # Current status
    'timestamp': str,           # ISO format timestamp
    'performed_by': str,        # User ID/Email
    'performer_role': str,      # CUSTOMER, ADMIN, OPERATIONS_STAFF, DELIVERY_ASSOCIATE
    'performer_email': str,     # User email
    'location': str             # Optional location for delivery partners
}
```

#### OrderStatusUpdateEvent (WebSocket)
```python
{
    'event_type': 'order_status_updated',
    'order_id': str,
    'new_status': str,
    'previous_status': str,
    'timestamp': str,
    'performed_by': str,
    'performer_role': str,
    'performer_email': str,
    'location': str | None,
    'message': str
}
```

### 2. Status Update Validation

The system enforces strict sequential transitions:
```python
def can_progress_order(current_status: str, next_status: str) -> bool:
    # Returns True only if next_status is immediately after current_status
    current_index = ORDER_STATUS_FLOW.index(current_status)
    next_index = ORDER_STATUS_FLOW.index(nxt)
    return next_index == current_index + 1
```

### 3. WebSocket Connection Manager

```python
class ConnectionManager:
    async def connect(user_id: str, websocket: WebSocket)
    async def disconnect(user_id: str, websocket: WebSocket)
    async def broadcast_to_user(user_id: str, message: dict)
```

**Endpoint**: `ws://localhost:8000/ws/orders/{user_id}`

### 4. Status Update Endpoint

**Route**: `PUT /orders/{order_id}/status`

**Request Body**:
```json
{
    "status": "CONFIRMED",
    "current_location": "Warehouse A"  // Optional, for delivery updates
}
```

**Response**:
```json
{
    "message": "Order moved to CONFIRMED.",
    "order": { ...order_details }
}
```

**Features**:
- ✅ Role-based validation
- ✅ Strict status flow enforcement
- ✅ Automatic WebSocket event emission
- ✅ Status history tracking
- ✅ Delivery log creation
- ✅ Notification generation
- ✅ Audit trail (performer role, email, timestamp)

### 5. Tracking Status Endpoint

**Route**: `GET /orders/{order_id}/tracking-status`

**Response**:
```json
{
    "order_id": "ORD-XXXXX",
    "current_status": "SHIPPED",
    "status_history": [
        {
            "status": "PLACED",
            "timestamp": "2026-04-21T10:00:00Z",
            "performed_by": "system",
            "performer_role": "CUSTOMER",
            "performer_email": "customer@example.com",
            "location": ""
        },
        {
            "status": "CONFIRMED",
            "timestamp": "2026-04-21T10:05:00Z",
            "performed_by": "admin-id",
            "performer_role": "ADMIN",
            "performer_email": "admin@example.com",
            "location": "Warehouse A"
        }
    ],
    "delivery_logs": [...],
    "status_timeline_steps": ["PLACED", "CONFIRMED", ...],
    "created_at": "2026-04-21T10:00:00Z",
    "updated_at": "2026-04-21T10:05:00Z"
}
```

### 6. Notification System

Notifications are created automatically on status changes with:
- Event type (status)
- Order ID
- Customer-friendly message
- Title with emoji
- Is_read flag for UI

**Notification Titles**:
- PLACED: ✅ Order Confirmed
- CONFIRMED: 📦 Order Confirmed
- PACKED: 📦 Order Packed
- SHIPPED: 🚚 Order Shipped
- OUT_FOR_DELIVERY: 🚚 Out for Delivery
- DELIVERED: ✅ Order Delivered

---

## Frontend Implementation

### 1. WebSocket Connection

The OrdersTracking component automatically:

1. Extracts user ID from JWT token
2. Establishes WebSocket connection
3. Listens for real-time events
4. Auto-reconnects on disconnect

```javascript
const userId = extractUserIdFromToken()  // From JWT
const wsUrl = `ws://localhost:8000/ws/orders/${userId}`
const ws = new WebSocket(wsUrl)
```

### 2. Real-Time Event Handling

**Event Types**:
- `order_status_updated`: Order status changed
- `notification`: System notification

```javascript
ws.onmessage = (event) => {
  const eventData = JSON.parse(event.data)
  
  if (eventData.type === 'order_status_updated') {
    // Update order status in UI
    // Show notification toast
    // Trigger animation
  }
}
```

### 3. UI Animations

- **Status Transition**: Pulse animation on status change
- **Card Animation**: Slide-in animation for updated orders
- **Notifications**: Toast notifications with 6-second timeout
- **Live Toggle**: Real-time updates every 10 seconds when enabled

### 4. Notification Toasts

Automatic toast notifications display:
- Title (with emoji based on status)
- Detailed message
- Auto-dismiss after 6 seconds
- Fixed position (top-right)

---

## Testing Guide

### Test Scenario 1: Complete Order Lifecycle

1. **Login as customer**: `customer.demo@veloura.com`
   - Password: `Customer#Demo2026`
   
2. **Place an order**
   - Add products to cart
   - Checkout
   - Verify order appears in tracking page with PLACED status

3. **Login as admin**: `admin.demo@veloura.com`
   - Password: `Admin#Demo2026`
   - View all orders
   - Update customer's order to CONFIRMED
   - Open WebSocket connection to test real-time updates

4. **Login as operations**: `ops.demo@veloura.com`
   - Password: `Ops#Demo2026`
   - Update order to PACKED
   - Verify automatic shipment creation

5. **Back to admin**
   - Update order to SHIPPED
   - Verify shipment tracking ID

6. **Login as delivery**: `delivery.demo@veloura.com`
   - Password: `Delivery#Demo2026`
   - Accept delivery assignment
   - Update to OUT_FOR_DELIVERY
   - Update to DELIVERED
   - Verify payment status changes to SUCCESS (for COD)

7. **Back to customer**
   - Verify all status updates appeared in real-time
   - Check all notifications were received
   - Verify tracking timeline is fully completed

### Test Scenario 2: Role-Based Permission Validation

- **Customer tries to update order to CONFIRMED**: ❌ 403 Forbidden
- **Operations tries to update to SHIPPED**: ❌ 403 Forbidden (can only PACK)
- **Delivery partner updates non-assigned order**: ❌ 403 Forbidden
- **Admin tries invalid transition (PLACED → SHIPPED)**: ❌ 400 Bad Request

### Test Scenario 3: Real-Time WebSocket Updates

1. Open order tracking page in two browser tabs (same customer)
2. Update order status from admin panel
3. **Expected**: Both tabs update simultaneously without manual refresh
4. **Toast notification**: Appears with status change message

### Test Scenario 4: Order Cancellation

1. Customer places order (PLACED status)
2. Customer cancels order → status becomes CANCELLED
3. Verify notification is sent
4. Verify order can no longer be updated

### Test Scenario 5: Return Request

1. Deliver an order to customer
2. Customer requests return
3. Verify return status history is created
4. Verify notifications are sent to admin and customer

---

## Audit Trail & Compliance

Every order status update records:

```json
{
    "performer_id": "user-123",
    "performer_role": "DELIVERY_ASSOCIATE",
    "performer_email": "delivery@example.com",
    "action": "ORDER_STATUS_UPDATE",
    "previous_status": "OUT_FOR_DELIVERY",
    "new_status": "DELIVERED",
    "timestamp": "2026-04-21T14:30:00Z",
    "location": "Customer Address",
    "order_id": "ORD-XXXXX"
}
```

This enables:
- ✅ Complete audit trail
- ✅ Performance analytics
- ✅ Compliance reporting
- ✅ Fraud detection
- ✅ User accountability

---

## Performance Considerations

1. **WebSocket Connections**: Connection pooling handles multiple concurrent users
2. **Status History**: Stored in order document as array (max 6 entries)
3. **Delivery Logs**: Separate collection for scalability
4. **Indexes**: 
   - Orders: `order_id`, `user_id`, `status`, `created_at`
   - Delivery Logs: `order_id`, `timestamp`

---

## API Endpoints Summary

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/orders/my` | CUSTOMER | Get user's orders |
| GET | `/orders/{order_id}` | Any | Get order details |
| GET | `/orders/{order_id}/tracking-status` | Any | Get tracking info with history |
| PUT | `/orders/{order_id}/status` | STAFF | Update order status |
| PUT | `/orders/{order_id}/cancel` | CUSTOMER | Cancel order |
| WS | `/ws/orders/{user_id}` | Any | WebSocket for real-time updates |
| POST | `/delivery/update-status` | DELIVERY_ASSOCIATE | Delivery status update |
| GET | `/admin/orders` | ADMIN | Get all orders |

---

## Key Features Implemented

✅ **Strict Role-Based Access Control**
- Each role can only perform specific status updates
- Assignment validation (delivery partners)

✅ **Immutable Status Flow**
- Cannot skip statuses
- Cannot move backwards
- Special statuses (CANCELLED, DELIVERY_FAILED)

✅ **Real-Time Updates**
- WebSocket-based instant updates
- No polling required
- Automatic reconnection

✅ **Complete Audit Trail**
- Performer role, ID, and email logged
- Timestamps for every change
- Location tracking for delivery

✅ **Notifications**
- Automatic on status change
- Custom messages by role
- Toast notifications on frontend

✅ **Status Tracking**
- Complete history with performer details
- Delivery logs
- Timeline visualization

---

## Environment Variables

```
JWT_SECRET_KEY=veloura-dev-secret-change-me
JWT_ACCESS_TOKEN_EXPIRE_HOURS=12
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=digital_atelier
```

---

## Troubleshooting

### WebSocket Not Connecting
- Check backend is running on correct port
- Verify WebSocket URL format: `ws://host:port/ws/orders/{user_id}`
- Check browser console for errors

### Status Updates Not Real-Time
- Verify WebSocket connection is established
- Check network tab for WebSocket frames
- Ensure Live toggle is ON in UI

### Role-Based Updates Failing
- Verify user role is correct (check token)
- Verify status transition is valid (check ORDER_STATUS_FLOW)
- Check user assignment (delivery partners must be assigned)

---

## Future Enhancements

1. **Event Sourcing**: Store all events in event log
2. **Webhooks**: Notify external systems on status changes
3. **Batch Updates**: Update multiple orders simultaneously
4. **Analytics**: Real-time dashboard with order metrics
5. **Push Notifications**: Mobile push on status changes
6. **SLA Tracking**: Monitor status transition times
