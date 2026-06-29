import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TITLES = {
  '/':                        'SOAC · RK University',
  '/about':                   'About · SOAC RKU',
  '/clubs':                   'Clubs · SOAC RKU',
  '/events':                  'Events · SOAC RKU',
  '/login':                   'Sign In · SOAC RKU',
  '/admin':                   'Dashboard · SOAC Admin',
  '/admin/clubs':             'Clubs · SOAC Admin',
  '/admin/members':           'Members · SOAC Admin',
  '/admin/events':            'Events · SOAC Admin',
  '/admin/coordinators':      'Coordinators · SOAC Admin',
  '/admin/approvals':         'Approvals · SOAC Admin',
  '/admin/fame':              'Wall of Fame · SOAC Admin',
  '/admin/broadcast':         'Broadcast · SOAC Admin',
  '/admin/coins':             'Coins · SOAC Admin',
  '/admin/chats':             'Monitor Chats · SOAC Admin',
  '/coordinator':             'Dashboard · Coordinator',
  '/coordinator/members':     'Members · Coordinator',
  '/coordinator/requests':    'Requests · Coordinator',
  '/coordinator/events':      'Events · Coordinator',
  '/coordinator/leaders':     'Leadership · Coordinator',
  '/coordinator/messages':    'Messages · Coordinator',
  '/coordinator/soac':        'SOAC News · Coordinator',
  '/student':                 'Dashboard · SOAC Student',
  '/student/events':          'Events · SOAC Student',
  '/student/clubs':           'My Clubs · SOAC Student',
  '/student/schedule':        'Schedule · SOAC Student',
  '/student/profile':         'Profile · SOAC Student',
};

/* Updates document title on every route change — no visual indicator */
export default function RouteProgress() {
  const location = useLocation();

  useEffect(() => {
    document.title = TITLES[location.pathname] || 'SOAC · RK University';
  }, [location.pathname]);

  return null;
}
