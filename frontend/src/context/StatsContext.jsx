import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const DEFAULTS = { clubs: 40, members: 1200, events: 50 };

const StatsContext = createContext(DEFAULTS);

export function StatsProvider({ children }) {
  const [stats, setStats] = useState(DEFAULTS);

  const fetchStats = useCallback(() => {
    fetch('/api/clubs/public/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d.clubs === 'number') setStats(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchStats();

    const interval = setInterval(fetchStats, 30_000);

    const onVisibility = () => { if (!document.hidden) fetchStats(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchStats]);

  return (
    <StatsContext.Provider value={stats}>
      {children}
    </StatsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useStats = () => useContext(StatsContext);
