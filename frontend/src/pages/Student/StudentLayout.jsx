import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import AnimatedOutlet from '../../components/AnimatedOutlet/AnimatedOutlet';
import ProfileModal from '../../components/ProfileModal/ProfileModal';
import s from './StudentLayout.module.css';

const AVATAR_BASE = '/uploads/avatars/';

const NAV_MAIN = [
  { to: '/student',              icon: '▣',  label: 'Dashboard',  end: true },
  { to: '/student/events',       icon: '📅', label: 'Events'                },
  { to: '/student/clubs',        icon: '🏆', label: 'My Clubs'              },
  { to: '/student/calendar',     icon: '🗓️', label: 'Calendar'             },
  { to: '/student/news',         icon: '🌐', label: 'News Feed'             },
  { to: '/student/soac-updates', icon: '🏛️', label: 'SOAC Updates'         },
];

const NAV_COMMUNITY = [
  { to: '/student/fame',     icon: '⭐', label: 'Wall of Fame' },
  { to: '/student/messages', icon: '💬', label: 'Messages'    },
];

export default function StudentLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unreadMsgs,  setUnreadMsgs]  = useState(0);

  /* Poll unread DM count every 30 s */
  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get('/messages/conversations');
        const total = (data.dms || []).reduce((sum, d) => sum + (d.unread_count || 0), 0);
        setUnreadMsgs(total);
      } catch (_) {}
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  /* Clear badge immediately when the user navigates to /messages */
  useEffect(() => {
    if (location.pathname.includes('/messages')) setUnreadMsgs(0);
  }, [location.pathname]);

  const avatarUrl = user?.avatar ? (user.avatar.startsWith('http') ? user.avatar : AVATAR_BASE + user.avatar) : null;
  const initial   = user?.name?.charAt(0)?.toUpperCase() || 'S';

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const SidebarContent = () => (
    <div className={s.sidebarInner}>
      <div className={s.brand}>
        <div className={s.brandBadge}>S</div>
        <div>
          <div className={s.brandName}>Student Portal</div>
          <div className={s.brandSub}>SOAC · RK University</div>
        </div>
      </div>

      <nav className={s.nav}>
        <div className={s.navGroupLabel}>My Space</div>
        {NAV_MAIN.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => `${s.navLink} ${isActive ? s.navLinkActive : ''}`}
          >
            <span className={s.navLabel}>{label}</span>
          </NavLink>
        ))}

        <div className={s.navGroupLabel} style={{ marginTop: 10 }}>Community</div>
        {NAV_COMMUNITY.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => `${s.navLink} ${isActive ? s.navLinkActive : ''}`}
          >
            <span className={s.navLabel}>{label}</span>
            {to === '/student/messages' && unreadMsgs > 0 && (
              <span className={s.navBadge}>{unreadMsgs > 99 ? '99+' : unreadMsgs}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={s.sidebarFooter}>
        <NavLink
          to="/student/profile"
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) => `${s.userCard} ${isActive ? s.userCardActive : ''}`}
          title="Profile & Settings"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={user?.name} className={s.userAvatarImg} />
          ) : (
            <div className={s.userAvatar}>{initial}</div>
          )}
          <div className={s.userInfo}>
            <div className={s.userName}>{user?.name || 'Student'}</div>
            <div className={s.userRole}>Profile & Settings</div>
          </div>
        </NavLink>
        <button className={s.logoutBtn} onClick={handleLogout}>
          Logout
        </button>
      </div>
    </div>
  );

  return (
    <div className={s.shell}>
      <aside className={s.sidebar}><SidebarContent /></aside>

      {mobileOpen && <div className={s.mobileOverlay} onClick={() => setMobileOpen(false)} />}
      <aside className={`${s.mobileSidebar} ${mobileOpen ? s.mobileSidebarOpen : ''}`}>
        <SidebarContent />
      </aside>

      <div className={s.main}>
        <header className={s.topbar}>
          <div className={s.topbarLeft}>
            <button className={s.hamburger} onClick={() => setMobileOpen(p => !p)}>
              <span /><span /><span />
            </button>
            <div className={s.pageId}>SOAC · Student Portal</div>
          </div>
          <div className={s.topbarRight}>
            <div
              className={s.topbarUser}
              onClick={() => setProfileOpen(true)}
              style={{ cursor: 'pointer' }}
              title="Edit profile"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={user?.name} className={s.topbarAvatarImg} />
              ) : (
                <div className={s.topbarAvatar}>{initial}</div>
              )}
              <span className={s.topbarName}>{user?.name}</span>
            </div>
          </div>
        </header>
        <main className={s.content}>
          <AnimatedOutlet />
        </main>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
