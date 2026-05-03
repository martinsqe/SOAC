import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function StudentRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100vh', background: '#0d1117', color: '#fff', fontSize: 15 }}>
        Loading…
      </div>
    );
  }

  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  if (user?.role === 'coordinator') return <Navigate to="/coordinator" replace />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}
