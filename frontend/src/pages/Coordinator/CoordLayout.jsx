import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { CoordClubProvider, useCoordClub } from '../../context/CoordClubContext';
import AnimatedOutlet from '../../components/AnimatedOutlet/AnimatedOutlet';
import ProfileModal from '../../components/ProfileModal/ProfileModal';
import api from '../../api/client';
import s from './CoordLayout.module.css';

const LAST_SEEN_KEY = 'coord_msgs_seen_at';
const AVATAR_BASE   = '/uploads/avatars/';

const NAV = [
  { to: '/coordinator',           label: 'Dashboard',  end: true },
  { to: '/coordinator/members',   label: 'Members'             },
  { to: '/coordinator/requests',  label: 'Requests'            },
  { to: '/coordinator/messages',  label: 'Messages'            },
  { to: '/coordinator/news',      label: 'News'                },
  { to: '/coordinator/events',    label: 'Events'              },
  { to: '/coordinator/leaders',   label: 'Leadership'          },
  { to: '/coordinator/soac',      label: 'SOAC News'           },
  { to: '/coordinator/calendar',  label: 'College Calendar'    },
  { to: '/coordinator/fame',      label: 'Wall of Fame'        },
  { to: '/coordinator/my-club',   label: 'My Club'             },
];

/* Renders page content or a gate screen if the coordinator has no club assigned */
function ClubGatedContent() {
  const { clubs, selectedClub, clubLoading, clubError } = useCoordClub();

  if (clubLoading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:300, color:'#9ca3af', fontSize:15 }}>
      Loading club data…
    </div>
  );

  if (clubError || (!clubLoading && !selectedClub && clubs.length === 0)) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:400, gap:16, padding:32, textAlign:'center' }}>
      <div style={{ fontSize:48 }}>🏛️</div>
      <h2 style={{ margin:0, color:'#1a1040', fontSize:'1.35rem' }}>No Club Assigned</h2>
      <p style={{ margin:0, color:'#6b7280', maxWidth:380, lineHeight:1.6 }}>
        Your coordinator account is not yet linked to a club.<br />
        Please ask an <strong>admin</strong> to assign your club from the Admin → Clubs panel.
      </p>
      <div style={{ background:'#f3f4f6', borderRadius:10, padding:'10px 20px', color:'#9ca3af', fontSize:13 }}>
        Once assigned, refresh the page to continue.
      </div>
    </div>
  );

  return <AnimatedOutlet />;
}

/* Inner layout — lives inside CoordClubProvider so it can use useCoordClub() */
function CoordLayoutInner() {
  const { user, logout }                       = useAuth();
  const { clubs, selectedClub, setSelectedClub } = useCoordClub();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unreadGroup, setUnreadGroup] = useState(0);
  const [unreadDMs,   setUnreadDMs]   = useState(0);

  const unreadMsgs = unreadGroup + unreadDMs;

  /* Poll club group chat for messages from others since last visit */
  useEffect(() => {
    const clubId = selectedClub?.id;
    if (!clubId) return;
    const load = async () => {
      try {
        const lastSeen = localStorage.getItem(LAST_SEEN_KEY) || new Date(0).toISOString();
        const data = await api.get(`/clubs/${clubId}/messages?limit=50`);
        const count = (data.messages || []).filter(
          m => m.user_id !== user.id && new Date(m.created_at) > new Date(lastSeen)
        ).length;
        setUnreadGroup(count);
      } catch (_) {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [selectedClub?.id, user?.id]);

  /* Poll DM unread count every 5 s */
  const refreshDMs = useCallback(async () => {
    try {
      const data = await api.get('/messages/conversations');
      const total = (data.dms || []).reduce((s, d) => s + (d.unread_count || 0), 0);
      setUnreadDMs(total);
    } catch (_) {}
  }, []);

  useEffect(() => {
    refreshDMs();
    const t = setInterval(refreshDMs, 5000);
    return () => clearInterval(t);
  }, [refreshDMs]);

  /* Clear badge immediately when the coordinator navigates to /messages */
  useEffect(() => {
    if (location.pathname.includes('/messages')) {
      setUnreadGroup(0);
      setUnreadDMs(0);
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    }
  }, [location.pathname]);

  const avatarUrl = user?.avatar ? AVATAR_BASE + user.avatar : null;
  const initial   = user?.name?.charAt(0)?.toUpperCase() || 'C';

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const SidebarContent = () => (
    <div className={s.sidebarInner}>
      {/* Brand */}
      <div className={s.brand}>
        <div className={s.brandBadge}>C</div>
        <div>
          <div className={s.brandName}>Coordinator</div>
          <div className={s.brandSub}>SOAC · RK University</div>
        </div>
      </div>

      {/* Club switcher — only shown when coordinator manages multiple clubs */}
      {clubs.length > 1 && (
        <div className={s.clubSwitcher}>
          <div className={s.clubSwitcherLabel}>Managing</div>
          {clubs.map(c => (
            <button
              key={c.id}
              className={`${s.clubSwitcherBtn} ${selectedClub?.id === c.id ? s.clubSwitcherBtnActive : ''}`}
              onClick={() => setSelectedClub(c)}
            >
              <span className={s.clubSwitcherDot} style={{ background: c.color || '#635bff' }} />
              <span className={s.clubSwitcherName}>{c.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Nav */}
      <nav className={s.nav}>
        <div className={s.navGroupLabel}>My Portal</div>
        {NAV.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => `${s.navLink} ${isActive ? s.navLinkActive : ''}`}
          >
            <span className={s.navLabel}>{label}</span>
            {to === '/coordinator/messages' && unreadMsgs > 0 && (
              <span className={s.navBadge}>{unreadMsgs > 99 ? '99+' : unreadMsgs}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className={s.sidebarFooter}>
        <div
          className={s.userCard}
          onClick={() => setProfileOpen(true)}
          style={{ cursor: 'pointer' }}
          title="Edit profile"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={user?.name} className={s.userAvatarImg} />
          ) : (
            <div className={s.userAvatar}>{initial}</div>
          )}
          <div className={s.userInfo}>
            <div className={s.userName}>{user?.name || 'Coordinator'}</div>
            <div className={s.userRole}>Club Coordinator</div>
          </div>
        </div>
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
        {/* First-login banner */}
        {user?.mustChangePassword && (
          <div style={{
            background: 'linear-gradient(90deg,#d97706,#f59e0b)',
            color: '#fff',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            fontWeight: 600,
          }}>
            <span>You are using a temporary password. Please change it now.</span>
            <button
              onClick={() => setProfileOpen(true)}
              style={{
                marginLeft: 'auto',
                background: 'rgba(255,255,255,0.25)',
                border: '1px solid rgba(255,255,255,0.5)',
                color: '#fff',
                borderRadius: 6,
                padding: '4px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Change Password
            </button>
          </div>
        )}
        <header className={s.topbar}>
          <div className={s.topbarLeft}>
            <button className={s.hamburger} onClick={() => setMobileOpen(p => !p)}>
              <span /><span /><span />
            </button>
            <div className={s.pageId}>SOAC · Coordinator Portal</div>
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
          <ClubGatedContent />
        </main>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}

export default function CoordLayout() {
  return (
    <CoordClubProvider>
      <CoordLayoutInner />
    </CoordClubProvider>
  );
}
