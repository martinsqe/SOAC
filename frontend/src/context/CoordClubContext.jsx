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

  const fetchClubs = useCallback(async () => {
    if (!user) return;
    setClubLoading(true);
    setClubError(null);

    try {
      // Tier 1: coordinator_club_assignments (fast path) — backend also does tier 2 & 3
      let list = [];
      try {
        const res = await api.get('/clubs/mine');
        list = res?.clubs || [];
      } catch (err) {
        // 404 means no assignment found via all 3 backend tiers — not a network error
        // Still try the managedClubId fallback on the frontend as a last resort
        if (!err?.message?.includes('404') && !err?.message?.includes('No club assigned')) {
          throw err; // real error (network, 500, etc.) — let outer catch handle it
        }
      }

      if (list.length) {
        setClubs(list);
        // Preserve existing selectedClub if it's still in the new list
        setSelectedClub(prev => {
          const stillExists = prev && list.find(c => String(c.id) === String(prev.id));
          return stillExists || list[0];
        });
        setClubError(null);
        return;
      }

      // Frontend fallback: managedClubId from context or fresh /auth/me (post-login repair)
      let managedId = user?.managedClubId;
      if (!managedId) {
        try {
          const me = await api.get('/auth/me');
          managedId = me?.user?.managedClubId;
        } catch (_) { /* ignore */ }
      }
      if (managedId) {
        try {
          const result = await api.get(`/clubs/${managedId}`);
          if (result?.club) {
            setClubs([result.club]);
            setSelectedClub(result.club);
            setClubError(null);
            return;
          }
        } catch (_) { /* club not found or inactive */ }
      }

      // All paths exhausted
      setClubs([]);
      setSelectedClub(null);
      setClubError('No club assigned. Ask an admin to assign your club from Admin → Clubs.');
    } catch (err) {
      setClubs([]);
      setSelectedClub(null);
      setClubError(err?.message || 'Failed to load club data.');
    } finally {
      setClubLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) {
      if (!authLoading) setClubLoading(false);
      return;
    }
    fetchClubs();
  }, [authLoading, user, fetchClubs]);

  // refetchClub: called after coordinator updates club data (e.g. Overview tab save)
  const refetchClub = useCallback(async () => {
    await fetchClubs();
  }, [fetchClubs]);

  // Backward-compat alias so pages that read `club` still work
  const club = selectedClub;

  return (
    <CoordClubContext.Provider value={{
      clubs, selectedClub, setSelectedClub,
      club, clubLoading, clubError,
      refetchClub,
    }}>
      {children}
    </CoordClubContext.Provider>
  );
}

export function useCoordClub() {
  return useContext(CoordClubContext);
}
