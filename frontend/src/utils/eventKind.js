/* Sports rules for event management and reports — one place, so the admin and
   coordinator dashboards always agree.

   An event is a sports event when it is categorised as sports, is a Sports
   Fiesta event, or belongs to a sports club. Sports events get Teams, Groups,
   Fixtures, Scoreboard, matches and MVPs; every other event (academic, cultural,
   social…) gets none of those. */
export const isSportsEvent = (ev, clubCategory) =>
  ev?.category === 'sports' || ev?.eventFormat === 'sports_fiesta' || clubCategory === 'sports';

/* Teams also stay for team-roster events outside sports (e.g. a Galore group
   dance), whose registrations only exist as teams. */
export const hasTeams = (ev, clubCategory) =>
  isSportsEvent(ev, clubCategory) || Number(ev?.teamSize) > 0;
