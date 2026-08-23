import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StatsProvider } from './context/StatsContext';
import AdminRoute from './components/AdminRoute/AdminRoute';
import RouteProgress from './components/RouteProgress/RouteProgress';
import InstallPrompt from './components/InstallPrompt/InstallPrompt';

/* Guest layout */
import Navbar  from './components/Navbar/Navbar';
import Footer  from './components/Footer/Footer';
import Home    from './pages/Home/Home';
import About   from './pages/About/About';
import Clubs   from './pages/Clubs/Clubs';
import Events     from './pages/Events/Events';
import LiveGames  from './pages/LiveGames/LiveGames';
import Explore    from './pages/Explore/Explore';
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
import AdminReports        from './pages/Admin/AdminReports';
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
import ClubsFeed from './pages/Student/ClubsFeed';
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
import CoordReports   from './pages/Coordinator/CoordReports';

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

/* ── Auth loading splash ──
   Three red dots pulse in sequence, one dot after another — a full "cycle"
   is all three dots pulsing once. The splash stays up for at least two full
   cycles even if auth resolves sooner (a deliberate branded intro rather
   than an abrupt flash), and for longer than that if auth genuinely takes
   longer — the dot animation itself runs indefinitely (never freezes mid-
   cycle), a plain iteration counter just gates when it's safe to dismiss. */
function LoadingSplash({ onIntroDone, fadingOut }) {
  const cycleCountRef = useRef(0);
  const firedRef = useRef(false);

  const handleCycle = () => {
    cycleCountRef.current += 1;
    if (cycleCountRef.current >= 2 && !firedRef.current) {
      firedRef.current = true;
      onIntroDone();
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 24, zIndex: 9999,
      animation: fadingOut ? 'splashOut 0.4s ease both' : 'splashIn 0.2s ease both',
      pointerEvents: fadingOut ? 'none' : 'auto',
    }}>
      <style>{`
        @keyframes splashIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes splashOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes dotPulse  { 0%, 80%, 100% { transform: scale(0.75); opacity: 0.55 } 40% { transform: scale(1); opacity: 1 } }
      `}</style>
      <img
        src="/images/asset-44.png"
        alt="SOAC"
        style={{ width: 96, height: 96, objectFit: 'contain', filter: 'contrast(1.15) saturate(1.1)' }}
      />
      <div style={{ display: 'flex', gap: 12 }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            onAnimationIteration={i === 2 ? handleCycle : undefined}
            style={{
              width: 16, height: 16, borderRadius: '50%', background: '#C81E1E',
              boxShadow: '0 1px 3px rgba(200,30,30,0.35)',
              animation: `dotPulse 0.9s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Inner app — reads auth loading state ── */
function AppInner() {
  const { loading } = useAuth();
  const [introDone, setIntroDone]   = useState(false);
  const [splashFading, setSplashFading] = useState(false);
  const [splashGone,   setSplashGone]   = useState(false);

  /* Once both the real auth check and the minimum 2-cycle intro are done,
     the Router mounts UNDERNEATH the still-fully-opaque splash and gets a
     brief head start to actually paint before the splash fades away — a
     hard cut here (splash unmounts the instant it's "ready") let a mostly-
     blank page (Navbar rendered, hero content not painted yet) flash
     through as a jarring second screen before real content appeared. */
  const ready = !loading && introDone;
  const fadeStartedRef = useRef(false);
  useEffect(() => {
    /* fadeStartedRef (not splashFading state) guards this — putting the
       state itself in the dependency array made setting it re-trigger this
       same effect, whose cleanup then cancelled the very timeout it had
       just scheduled, so splashGone never actually flipped: the splash div
       sat at opacity 0 but stayed mounted, invisibly eating every click on
       the real page underneath since a position:fixed full-viewport overlay
       with no pointer-events:none still captures the pointer regardless of
       opacity. */
    if (!ready || fadeStartedRef.current) return;
    fadeStartedRef.current = true;
    setSplashFading(true);
    const t = setTimeout(() => setSplashGone(true), 400);
    return () => clearTimeout(t);
  }, [ready]);

  /* InstallPrompt is mounted unconditionally, before the splash-done check —
     the browser can fire beforeinstallprompt at any point after page load,
     including during the ~2s splash window, and it only fires once. Gating
     this component's mount on the splash being done would mean no listener
     is attached yet when an early event arrives, silently losing it for the
     rest of the session. The splash's higher z-index already covers the
     banner visually for as long as it's up, so mounting early costs nothing. */
  return (
    <>
      <InstallPrompt />
      {!splashGone && (
        <LoadingSplash onIntroDone={() => setIntroDone(true)} fadingOut={splashFading} />
      )}
      {ready && (
      <Router>
      <ScrollToTop />
      <RouteProgress />
      <Routes>
        {/* ── Guest routes ── */}
        <Route path="/"        element={<GuestLayout><Home    /></GuestLayout>} />
        <Route path="/about"   element={<GuestLayout><About   /></GuestLayout>} />
        <Route path="/clubs"   element={<GuestLayout><Clubs   /></GuestLayout>} />
        <Route path="/clubs/:id"   element={<GuestLayout><Clubs   /></GuestLayout>} />
        <Route path="/events"      element={<GuestLayout><Events    /></GuestLayout>} />
        <Route path="/events/live" element={<GuestLayout><LiveGames /></GuestLayout>} />
        <Route path="/events/:id"  element={<GuestLayout><Events    /></GuestLayout>} />
        <Route path="/explore"     element={<GuestLayout><Explore   /></GuestLayout>} />
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
          <Route path="reports"         element={<AdminReports />} />
          <Route path="audit"           element={<AdminAuditLog />} />
        </Route>

        {/* ── Student routes (protected) ── */}
        <Route path="/student" element={<StudentRoute><StudentLayout /></StudentRoute>}>
          <Route index                element={<StudentDashboard />} />
          <Route path="events"        element={<StudentEvents />} />
          <Route path="clubs"           element={<StudentClubs />} />
          <Route path="clubs/:id"       element={<StudentClubDetail />} />
          <Route path="soac-updates"  element={<StudentSOACUpdates />} />
          <Route path="clubs-feed"    element={<ClubsFeed />} />
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
          <Route path="reports"      element={<CoordReports />} />
        </Route>
      </Routes>
    </Router>
      )}
    </>
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
