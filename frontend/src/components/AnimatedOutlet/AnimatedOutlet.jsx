import { useOutlet, useLocation } from 'react-router-dom';

/* Renders the current <Outlet /> with a fade-in animation on every route change */
export default function AnimatedOutlet({ className }) {
  const outlet   = useOutlet();
  const location = useLocation();

  return (
    <div key={location.pathname} className={`page-enter${className ? ` ${className}` : ''}`}>
      {outlet}
    </div>
  );
}
