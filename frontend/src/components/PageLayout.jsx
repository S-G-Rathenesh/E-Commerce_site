import Navbar from './Navbar'
import Footer from './Footer'
import BottomNav from './BottomNav'

export default function PageLayout({ children }) {
  return (
    <>
      <Navbar />
      <main className="main-shell shell">{children}</main>
      <Footer />
      <BottomNav />
    </>
  )
}
