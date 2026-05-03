import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';

const CoordClubContext = createContext(null);

export function CoordClubProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [clubs,        setClubs]        = useState([]);
  const [selectedClub, setSelectedClub] = useState(null);
  const [clubLoading,  setClubLoading]  = useState(true);
  const [clubError,    setClubError]    = useState(null);

  useEffect(() => {
    if (authLoading || !user) {
      setClubLoading(true);
      return;
    }

    const fetchClubs = async () => {
      setClubLoading(true);
      setClubError(null);

      try {
        const { clubs: cs = [] } = await api.get('/clubs/mine').catch(() => ({ clubs: [] }));
        const list = cs || [];
        if (list.length) {
          setClubs(list);
          setSelectedClub(list[0]);
          setClubError(null);
          return;
        }

        if (user?.managedClubId) {
          const result = await api.get(`/clubs/${user.managedClubId}`);
          if (result?.club) {
            setClubs([result.club]);
            setSelectedClub(result.club);
            setClubError(null);
            return;
          }
        }

        setClubs([]);
        setSelectedClub(null);
        setClubError('No club assigned.');
      } catch (err) {
        setClubs([]);
        setSelectedClub(null);
        setClubError(err?.message || 'No club assigned.');
      } finally {
        setClubLoading(false);
      }
    };

    fetchClubs();
  }, [authLoading, user]);

  // Backward-compat alias so pages that read `club` still work
  const club = selectedClub;

  return (
    <CoordClubContext.Provider value={{
      clubs, selectedClub, setSelectedClub,
      club, clubLoading, clubError,
    }}>
      {children}
    </CoordClubContext.Provider>
  );
}

export function useCoordClub() {
  return useContext(CoordClubContext);
}
