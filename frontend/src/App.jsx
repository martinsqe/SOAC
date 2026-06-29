import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StatsProvider } from './context/StatsContext';
import AdminRoute from './components/AdminRoute/AdminRoute';
import RouteProgress from './components/RouteProgress/RouteProgress';

/* Guest layout */
import Navbar  from './components/Navbar/Navbar';
import Footer  from './components/Footer/Footer';
import Home    from './pages/Home/Home';
import About   from './pages/About/About';
import Clubs   from './pages/Clubs/Clubs';
import Events     from './pages/Events/Events';
import LiveGames  from './pages/LiveGames/LiveGames';
import Login   from './pages/Login/Login';
import ResetPassword from './pages/ResetPassword/ResetPassword';

/* Admin layout + pages */
import AdminLayout    from './pages/Admin/AdminLayout';
import AdminDashboard from './pages/Admin/AdminDashboard';
import AdminClubs     from './pages/Admin/AdminClubs';
import AdminEvents    from './pages/Admin/AdminEvents';
import AdminMembers   from './pages/Admin/AdminMembers';
import AdminComingSoon  from './pages/Admin/AdminComingSoon';
import AdminAuditLog   from './pages/Admin/AdminAuditLog';
import AdminBroadcast  from './pages/Admin/AdminBroadcast';
import AdminApprovals      from './pages/Admin/AdminApprovals';
import AdminFame           from './pages/Admin/AdminFame';
import AdminMonitorChats   from './pages/Admin/AdminMonitorChats';
import AdminCoins          from './pages/Admin/AdminCoins';
import GuestGallery   from './pages/Guest/GuestGallery';
import GuestContact   from './pages/Guest/GuestContact';

/* Student layout + pages */
import StudentRoute     from './components/StudentRoute/StudentRoute';
import StudentLayout    from './pages/Student/StudentLayout';
import StudentDashboard from './pages/Student/StudentDashboard';
import StudentClubs       from './pages/Student/StudentClubs';
import StudentClubDetail  from './pages/Student/StudentClubDetail';
import StudentEvents    from './pages/Student/StudentEvents';
import StudentProfile   from './pages/Student/StudentProfile';
import {
  StudentSOACUpdates,
  StudentFame,
} from './pages/Student/StudentPages';
import StudentMessages from './pages/Student/StudentMessages';
import WallOfFame from './pages/WallOfFame/WallOfFame';

/* Coordinator layout + pages */
import CoordRoute     from './components/CoordRoute/CoordRoute';
import CoordLayout    from './pages/Coordinator/CoordLayout';
import CoordDashboard from './pages/Coordinator/CoordDashboard';
import CoordMembers   from './pages/Coordinator/CoordMembers';
import CoordRequests  from './pages/Coordinator/CoordRequests';
import CoordEvents    from './pages/Coordinator/CoordEvents';
import CoordLeaders   from './pages/Coordinator/CoordLeaders';
import CoordSOAC      from './pages/Coordinator/CoordSOAC';
import CoordMessages  from './pages/Coordinator/CoordMessages';
import CoordMyClub    from './pages/Coordinator/CoordMyClub';

/* Shared calendar view (student + coordinator) */
import CalendarView from './components/CalendarView/CalendarView';

const Gallery = () => <GuestGallery />;
const Contact = () => <GuestContact />;

function GuestLayout({ children }) {
  const location = useLocation();
  return (
    <>
      <Navbar />
      <main key={location.pathname} className="page-enter">{children}</main>
      <Footer />
    </>
  );
}

function NavOnlyLayout({ children }) {
  const location = useLocation();
  return (
    <>
      <Navbar />
      <main key={location.pathname} className="page-enter">{children}</main>
    </>
  );
}

/* ── Coordinators page → reuse AdminMembers (has coordinator overview built-in) ── */
const COORDINATORS_PAGE = () => <AdminMembers />;
const APPROVALS_PAGE = () => <AdminApprovals />;
const BROADCAST_PAGE = () => <AdminBroadcast />;
const SUSPENSIONS_PAGE = () => (
  <AdminComingSoon
    icon="🚫" title="Suspensions"
    description="Manage account suspensions and violations. Review reports, issue warnings, and take action on policy breaches."
    features={[
      { icon: '⚠️', name: 'Violation Reports', sub: 'Review flagged content and behavior reports' },
      { icon: '🔒', name: 'Account Actions', sub: 'Suspend, warn, or reinstate user accounts' },
      { icon: '📜', name: 'Suspension Log', sub: 'Track history of all moderation actions' },
    ]}
  />
);

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

/* ── Auth loading splash ── */
function LoadingSplash() {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 20, zIndex: 9999,
      animation: 'splashIn 0.2s ease both',
    }}>
      <style>{`
        @keyframes splashIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes splashOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes barSlide  { 0%,100% { transform: translateX(-100%) } 50% { transform: translateX(200%) } }
        @keyframes logoPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }
      `}</style>
      <img
        src="/images/asset-44.png"
        alt="SOAC"
        style={{ width: 72, height: 72, objectFit: 'contain', animation: 'logoPulse 1.2s ease-in-out infinite' }}
      />
      <div style={{ width: 48, height: 3, borderRadius: 2, background: '#f0f0f5', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: '50%', background: '#0f766e', borderRadius: 2,
          animation: 'barSlide 1s ease-in-out infinite',
        }} />
      </div>
    </div>
  );
}

/* ── Inner app — reads auth loading state ── */
function AppInner() {
  const { loading } = useAuth();

  if (loading) return <LoadingSplash />;

  return (
    <Router>
      <ScrollToTop />
      <RouteProgress />
      <Routes>
        {/* ── Guest routes ── */}
        <Route path="/"        element={<GuestLayout><Home    /></GuestLayout>} />
        <Route path="/about"   element={<GuestLayout><About   /></GuestLayout>} />
        <Route path="/clubs"   element={<GuestLayout><Clubs   /></GuestLayout>} />
        <Route path="/events"      element={<GuestLayout><Events    /></GuestLayout>} />
        <Route path="/events/live" element={<GuestLayout><LiveGames /></GuestLayout>} />
        <Route path="/gallery" element={<GuestLayout><Gallery /></GuestLayout>} />
        <Route path="/contact" element={<GuestLayout><Contact /></GuestLayout>} />
        <Route path="/login"   element={<NavOnlyLayout><Login /></NavOnlyLayout>} />
        <Route path="/reset-password" element={<NavOnlyLayout><ResetPassword /></NavOnlyLayout>} />

        {/* ── Admin routes (protected) ── */}
        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index                  element={<AdminDashboard />} />
          <Route path="clubs"           element={<AdminClubs />} />
          <Route path="members"         element={<AdminMembers />} />
          <Route path="events"          element={<AdminEvents />} />
          <Route path="coordinators"    element={<COORDINATORS_PAGE />} />
          <Route path="approvals"       element={<APPROVALS_PAGE />} />
          <Route path="fame"            element={<AdminFame />} />
          <Route path="broadcast"       element={<BROADCAST_PAGE />} />
          <Route path="coins"           element={<AdminCoins />} />
          <Route path="suspensions"     element={<SUSPENSIONS_PAGE />} />
          <Route path="chats"           element={<AdminMonitorChats />} />
          <Route path="audit"           element={<AdminAuditLog />} />
        </Route>

        {/* ── Student routes (protected) ── */}
        <Route path="/student" element={<StudentRoute><StudentLayout /></StudentRoute>}>
          <Route index                element={<StudentDashboard />} />
          <Route path="events"        element={<StudentEvents />} />
          <Route path="clubs"           element={<StudentClubs />} />
          <Route path="clubs/:id"       element={<StudentClubDetail />} />
          <Route path="soac-updates"  element={<StudentSOACUpdates />} />
          <Route path="fame"          element={<WallOfFame />} />
          <Route path="messages"      element={<StudentMessages />} />
          <Route path="profile"       element={<StudentProfile />} />
          <Route path="calendar"      element={<CalendarView />} />
        </Route>

        {/* ── Coordinator routes (protected) ── */}
        <Route path="/coordinator" element={<CoordRoute><CoordLayout /></CoordRoute>}>
          <Route index               element={<CoordDashboard />} />
          <Route path="members"      element={<CoordMembers />} />
          <Route path="requests"     element={<CoordRequests />} />
          <Route path="messages"     element={<CoordMessages />} />
          <Route path="events"       element={<CoordEvents />} />
          <Route path="leaders"      element={<CoordLeaders />} />
          <Route path="soac"         element={<CoordSOAC />} />
          <Route path="fame"         element={<WallOfFame />} />
          <Route path="my-club"      element={<CoordMyClub />} />
          <Route path="calendar"     element={<CalendarView />} />
        </Route>
      </Routes>
    </Router>
  );
}

function App() {
  return (
    <StatsProvider>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </StatsProvider>
  );
}

export default App;
