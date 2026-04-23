import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import PageLayout from './components/PageLayout'
import Home from './pages/Home'
import Products from './pages/Products'
import ProductDetails from './pages/ProductDetails'
import Cart from './pages/Cart'
import Wishlist from './pages/Wishlist'
import Checkout from './pages/Checkout'
import Login from './pages/Login'
import Signup from './pages/Signup'
import MerchantRegister from './pages/MerchantRegister'
import DeliveryRegister from './pages/DeliveryRegister'
import DeliveryProfile from './pages/DeliveryProfile'
import OperationsRegister from './pages/OperationsRegister'
import AdminDashboard from './pages/AdminDashboard'
import ManageProducts from './pages/ManageProducts'
import DeliveryDashboard from './pages/DeliveryDashboard'
import OperationsDashboard from './pages/OperationsDashboard'
import OrdersTracking from './pages/OrdersTracking'
import Profile from './pages/Profile'
import AdminOrdersPage from './pages/AdminOrdersPage'
import AdminShippingSettings from './pages/AdminShippingSettings'
import AdminCustomersPage from './pages/AdminCustomersPage'
import AdminAnalyticsPage from './pages/AdminAnalyticsPage'
import AdminProfilePage from './pages/AdminProfilePage'
import SuperAdminDashboard from './pages/SuperAdminDashboard'
import { getStoredUser } from './utils/auth'
import { getSuperAdminSecretPath } from './utils/platform'

function normalizeRole(role) {
  const next = String(role || '').trim().toLowerCase()
  if (next === 'super_admin' || next === 'superadmin') {
    return 'super_admin'
  }
  if (next === 'merchant' || next === 'admin') {
    return 'admin'
  }
  if (next === 'customer' || next === 'user') {
    return 'user'
  }
  if (next === 'delivery' || next === 'delivery_associate') {
    return 'delivery'
  }
  if (next === 'operations_staff' || next === 'operations' || next === 'staff') {
    return 'operations'
  }
  return 'user'
}

function redirectByRole(user) {
  const role = normalizeRole(user?.role)
  const superAdminSecretPath = getSuperAdminSecretPath()
  if (role === 'super_admin') {
    return superAdminSecretPath
  }
  if (role === 'admin') {
    return '/admin/dashboard'
  }
  if (role === 'delivery') {
    return '/delivery'
  }
  if (role === 'operations') {
    return '/operations'
  }
  if (role === 'user') {
    return '/'
  }
  return '/login'
}

function RequireAuth({ user, children }) {
  if (!user) {
    return <Navigate to="/login" replace />
  }
  return children
}

function RequireRole({ user, allowedRoles, children }) {
  const role = normalizeRole(user?.role)
  if (!user) {
    return <Navigate to="/login" replace />
  }
  if (!allowedRoles.includes(role)) {
    return <Navigate to={redirectByRole(user)} replace />
  }
  return children
}

function App() {
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const location = useLocation()
  const superAdminSecretPath = getSuperAdminSecretPath()
  const role = normalizeRole(currentUser?.role)
  const isCustomerUser = role === 'user'

  const resolveUiTheme = () => {
    const pathname = String(location.pathname || '').toLowerCase()

    if (
      pathname === '/login' ||
      pathname === '/signup' ||
      pathname === '/merchant-register' ||
      pathname === '/delivery-register' ||
      pathname === '/operations-register'
    ) {
      return 'auth'
    }

    if (pathname.startsWith('/delivery')) {
      return 'delivery'
    }

    if (pathname.startsWith('/operations')) {
      return 'operations'
    }

    if (
      pathname.startsWith(superAdminSecretPath) ||
      pathname.startsWith('/admin/dashboard') ||
      pathname.startsWith('/admin/orders') ||
      pathname.startsWith('/admin/customers') ||
      pathname.startsWith('/admin/analytics')
    ) {
      return 'admin'
    }

    if (
      pathname.startsWith('/admin/products') ||
      pathname.startsWith('/admin/profile') ||
      pathname.startsWith('/admin/shipping') ||
      pathname.startsWith('/admin/settings')
    ) {
      return 'merchant'
    }

    return 'customer'
  }

  useEffect(() => {
    const syncAuthState = () => {
      setCurrentUser(getStoredUser())
    }

    window.addEventListener('auth-changed', syncAuthState)
    window.addEventListener('storage', syncAuthState)

    return () => {
      window.removeEventListener('auth-changed', syncAuthState)
      window.removeEventListener('storage', syncAuthState)
    }
  }, [])

  useEffect(() => {
    const nextTheme = resolveUiTheme()
    document.body.dataset.uiTheme = nextTheme
    document.documentElement.dataset.uiTheme = nextTheme
    document.body.classList.remove(
      'ui-theme-auth',
      'ui-theme-customer',
      'ui-theme-merchant',
      'ui-theme-admin',
      'ui-theme-delivery',
      'ui-theme-operations',
    )
    document.body.classList.add(`ui-theme-${nextTheme}`)
  }, [location.pathname, currentUser?.role, superAdminSecretPath])

  return (
    <PageLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/products" element={<Products />} />
        <Route path="/product/:id" element={<ProductDetails />} />
        <Route
          path="/cart"
          element={isCustomerUser ? <Cart /> : <Navigate to={redirectByRole(currentUser)} replace />}
        />
        <Route
          path="/wishlist"
          element={isCustomerUser ? <Wishlist /> : <Navigate to={redirectByRole(currentUser)} replace />}
        />
        <Route
          path="/checkout"
          element={isCustomerUser ? <Checkout /> : <Navigate to={redirectByRole(currentUser)} replace />}
        />
        <Route path="/profile" element={<RequireAuth user={currentUser}><Profile /></RequireAuth>} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/merchant-register" element={<MerchantRegister />} />
        <Route path="/delivery-register" element={<DeliveryRegister />} />
        <Route path="/operations-register" element={<OperationsRegister />} />
        <Route path="/orders" element={<Navigate to="/orders/tracking" replace />} />
        <Route path="/orders/tracking" element={<RequireRole user={currentUser} allowedRoles={['user']}><OrdersTracking /></RequireRole>} />
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/delivery" element={<Navigate to="/delivery/dashboard" replace />} />
        <Route path="/operations" element={<Navigate to="/operations/dashboard" replace />} />
        <Route path="/admin/dashboard" element={<RequireRole user={currentUser} allowedRoles={['admin']}><AdminDashboard /></RequireRole>} />
        <Route path="/admin/products" element={<RequireRole user={currentUser} allowedRoles={['admin']}><ManageProducts /></RequireRole>} />
        <Route path="/admin/orders" element={<RequireRole user={currentUser} allowedRoles={['admin']}><AdminOrdersPage /></RequireRole>} />
        <Route path="/admin/shipping" element={<RequireRole user={currentUser} allowedRoles={['admin']}><AdminShippingSettings /></RequireRole>} />
        <Route path="/admin/settings" element={<RequireRole user={currentUser} allowedRoles={['admin']}><AdminShippingSettings /></RequireRole>} />
        <Route path="/admin/customers" element={<RequireRole user={currentUser} allowedRoles={['admin']}><AdminCustomersPage /></RequireRole>} />
        <Route path="/admin/analytics" element={<RequireRole user={currentUser} allowedRoles={['admin']}><AdminAnalyticsPage /></RequireRole>} />
        <Route path="/admin/profile" element={<RequireRole user={currentUser} allowedRoles={['admin']}><AdminProfilePage /></RequireRole>} />
        <Route
          path={superAdminSecretPath}
          element={<RequireRole user={currentUser} allowedRoles={['super_admin']}><SuperAdminDashboard /></RequireRole>}
        />
        <Route path="/delivery/dashboard" element={<RequireRole user={currentUser} allowedRoles={['delivery']}><DeliveryDashboard /></RequireRole>} />
        <Route path="/delivery/profile" element={<RequireRole user={currentUser} allowedRoles={['delivery']}><DeliveryProfile /></RequireRole>} />
        <Route path="/operations/dashboard" element={<RequireRole user={currentUser} allowedRoles={['operations']}><OperationsDashboard /></RequireRole>} />
        <Route path="*" element={<RequireAuth user={currentUser}><Navigate to={redirectByRole(currentUser)} replace /></RequireAuth>} />
      </Routes>
    </PageLayout>
  )
}

export default App
