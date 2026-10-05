/* Which events are sports events — one rule for every server-side feature
   (team divisions, reports, certificates, team emails). Mirrors
   frontend/src/utils/eventKind.js.

   An event is a sports event when it is categorised as sports, is a Sports
   Fiesta event, or belongs to a sports club. Sports events get Boys/Girls
   divisions, teams, groups, fixtures, scoreboards, MVPs and winners; every other
   event (academic, cultural, social…) gets none of those. */
const isSportsEvent = ({ category, event_format, club_category } = {}) =>
  category === 'sports' || event_format === 'sports_fiesta' || club_category === 'sports';

/* Same rule in SQL. `e` = the events alias, `c` = a joined clubs alias. */
const isSportsSql = (e = 'e', c = 'c') =>
  `(COALESCE(${e}.category, '') = 'sports' OR COALESCE(${e}.event_format, '') = 'sports_fiesta' OR COALESCE(${c}.category, '') = 'sports')`;

/* Scalar subquery for an event row's club category, for SELECTs without a join */
const CLUB_CATEGORY_SQL = `(SELECT category FROM clubs WHERE clubs.id = events.club_id) AS club_category`;

module.exports = { isSportsEvent, isSportsSql, CLUB_CATEGORY_SQL };
