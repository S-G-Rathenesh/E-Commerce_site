import Navbar from './Navbar'
import Footer from './Footer'

export default function PageLayout({ children }) {
  return (
    <>
      <Navbar />
      <main className="main-shell shell">{children}</main>
      <Footer />
    </>
  )
}
