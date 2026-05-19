import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const CoordRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
                    height:'100vh', background:'#150d35', color:'#fff', fontSize:15 }}>
        Loading…
      </div>
    );
  }

  // Admins have their own dashboard — redirect them out of the coordinator portal
  if (user?.role === 'admin') {
    return <Navigate to="/admin" replace />;
  }

  const role = String(user?.role || '').toLowerCase();
  if (!user || role !== 'coordinator') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export default CoordRoute;
