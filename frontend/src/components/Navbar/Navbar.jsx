import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import styles from './Navbar.module.css';

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Close menu on route change
  useEffect(() => { setOpen(false); }, [location]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const links = [
    { to: '/',       label: 'Home'   },
    { to: '/about',  label: 'About'  },
    { to: '/clubs',  label: 'Clubs'  },
    { to: '/events', label: 'Events' },
  ];

  return (
    <>
      <nav className={styles.nav}>
        <div className={styles.navlogo} onClick={() => navigate('/')}>
          <img src="/images/logo.png" alt="SOAC RKU" />
        </div>

        {/* desktop links */}
        <div className={styles.navlinks}>
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) => `${styles.nl} ${isActive ? styles.on : ''}`}
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        {/* desktop CTA */}
        <div className={styles.navr}>
          <button className="btf" onClick={() => navigate('/login')}>Login →</button>
        </div>

        {/* hamburger */}
        <button
          className={`${styles.burger} ${open ? styles.burgerOpen : ''}`}
          onClick={() => setOpen(p => !p)}
          aria-label="Toggle menu"
        >
          <span /><span /><span />
        </button>
      </nav>

      {/* mobile drawer */}
      <div className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}>
        <div className={styles.drawerLinks}>
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) => `${styles.dlink} ${isActive ? styles.dlinkOn : ''}`}
            >
              {l.label}
            </NavLink>
          ))}
        </div>
        <div className={styles.drawerCta}>
          <button className={styles.dbtnp} onClick={() => navigate('/login')}>Login →</button>
        </div>
      </div>

      {/* overlay */}
      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}
    </>
  );
};

export default Navbar;
