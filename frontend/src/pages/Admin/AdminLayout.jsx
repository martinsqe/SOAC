import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AnimatedOutlet from '../../components/AnimatedOutlet/AnimatedOutlet';
import ProfileModal from '../../components/ProfileModal/ProfileModal';
import api from '../../api/client';
import styles from './AdminLayout.module.css';

const AVATAR_BASE = '/uploads/avatars/';

const NAV = [
  {
    section: 'Overview', items: [
      { to: '/admin',         label: 'Dashboard',     end: true },
      { to: '/admin/clubs',   label: 'All Clubs'     },
      { to: '/admin/members', label: 'All Members'   },
      { to: '/admin/events',  label: 'Events'        },
    ],
  },
  {
    section: 'Manage', items: [
      { to: '/admin/approvals',      label: 'Approvals'      },
      { to: '/admin/fame',           label: 'Wall of Fame'   },
      { to: '/admin/broadcast',      label: 'Broadcast'      },
      { to: '/admin/coins',          label: 'Coins Monitor'  },
      { to: '/admin/chats',          label: 'Monitor Chats'  },
    ],
  },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen,    setMobileOpen]    = useState(false);
  const [profileOpen,   setProfileOpen]   = useState(false);
  const [unreadDMs,     setUnreadDMs]     = useState(0);

  /* Poll unread DM count every 5 s */
  const refreshUnread = useCallback(async () => {
    try {
      const data = await api.get('/messages/conversations');
      const total = (data.dms || []).reduce((s, d) => s + (d.unread_count || 0), 0);
      setUnreadDMs(total);
    } catch (_) {}
  }, []);

  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 5000);
    return () => clearInterval(t);
  }, [refreshUnread]);

  /* Clear badge immediately when admin opens Monitor Chats */
  useEffect(() => {
    if (location.pathname.startsWith('/admin/chats')) setUnreadDMs(0);
  }, [location.pathname]);

  const avatarUrl = user?.avatar ? AVATAR_BASE + user.avatar : null;
  const initial   = user?.name?.charAt(0)?.toUpperCase() || 'A';

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const SidebarContent = () => (
    <div className={styles.sidebarInner}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.brandBadge}>S</div>
        <div>
          <div className={styles.brandName}>SOAC Admin</div>
          <div className={styles.brandSub}>RK University</div>
        </div>
      </div>

      {/* Nav */}
      <nav className={styles.nav}>
        {NAV.map(({ section, items }) => (
          <div key={section} className={styles.navGroup}>
            <div className={styles.navGroupLabel}>{section}</div>
            {items.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                }
              >
                <span className={styles.navLabel}>{label}</span>
                {to === '/admin/chats' && unreadDMs > 0 && (
                  <span className={styles.navBadge}>
                    {unreadDMs > 99 ? '99+' : unreadDMs}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={styles.sidebarFooter}>
        <div
          className={styles.userCard}
          onClick={() => setProfileOpen(true)}
          style={{ cursor: 'pointer' }}
          title="Edit profile"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={user?.name} className={styles.userAvatarImg} />
          ) : (
            <div className={styles.userAvatar}>{initial}</div>
          )}
          <div className={styles.userInfo}>
            <div className={styles.userName}>{user?.name}</div>
            <div className={styles.userRole}>Administrator</div>
          </div>
        </div>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          Logout
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.shell}>

      {/* ── Desktop Sidebar ── */}
      <aside className={styles.sidebar}>
        <SidebarContent />
      </aside>

      {/* ── Mobile Sidebar Overlay ── */}
      {mobileOpen && (
        <div className={styles.mobileOverlay} onClick={() => setMobileOpen(false)} />
      )}
      <aside className={`${styles.mobileSidebar} ${mobileOpen ? styles.mobileSidebarOpen : ''}`}>
        <SidebarContent />
      </aside>

      {/* ── Main ── */}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.hamburger} onClick={() => setMobileOpen(p => !p)}>
              <span /><span /><span />
            </button>
            <div className={styles.pageId}>
              SOAC · Admin
            </div>
          </div>
          <div className={styles.topbarRight}>
            <div
              className={styles.topbarUser}
              onClick={() => setProfileOpen(true)}
              style={{ cursor: 'pointer' }}
              title="Edit profile"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={user?.name} className={styles.topbarAvatarImg} />
              ) : (
                <div className={styles.topbarAvatar}>{initial}</div>
              )}
              <span className={styles.topbarName}>{user?.name}</span>
            </div>
          </div>
        </header>

        <main className={styles.content}>
          <AnimatedOutlet />
        </main>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
