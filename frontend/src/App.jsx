import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
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
import AdminDashboard from './pages/AdminDashboard'
import ManageProducts from './pages/ManageProducts'
import { getStoredUser } from './utils/auth'

function App() {
  const [currentUser, setCurrentUser] = useState(getStoredUser())
  const isMerchantUser = (currentUser?.role || '').toLowerCase() === 'merchant'

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

  return (
    <PageLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/products" element={<Products />} />
        <Route path="/product/:id" element={<ProductDetails />} />
        <Route path="/cart" element={isMerchantUser ? <Navigate to="/admin" replace /> : <Cart />} />
        <Route path="/wishlist" element={isMerchantUser ? <Navigate to="/admin" replace /> : <Wishlist />} />
        <Route path="/checkout" element={isMerchantUser ? <Navigate to="/admin" replace /> : <Checkout />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/merchant-register" element={<MerchantRegister />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/products" element={<ManageProducts />} />
      </Routes>
    </PageLayout>
  )
}

export default App
