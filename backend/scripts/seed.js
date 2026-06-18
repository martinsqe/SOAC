/**
 * Seeds PostgreSQL with all clubs and initial events.
 * Run once:  npm run seed
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const slugify  = require('slugify');
const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');

const CLUBS = [
  // Technology
  { logo: 'ANDROID DEVLOPMENT CLUB.png', name: 'Android Development Club',     category: 'academic',      color: '#3DDC84', coordinator: 'Prof. Anita Mehta',    foundedYear: '2019', memberCount: 98,  eventCount: 4 },
  { logo: 'WEBIFY.png',                  name: 'Webify Club',                   category: 'academic',      color: '#635BFF', coordinator: 'Dr. Rajesh Pillai',    foundedYear: '2020', memberCount: 74,  eventCount: 3 },
  { logo: 'iOS DEVLOPMENT CLUB.png',     name: 'iOS Development Club',          category: 'academic',      color: '#007AFF', coordinator: 'Prof. Sneha Mehta',    foundedYear: '2021', memberCount: 52,  eventCount: 2 },
  { logo: 'MOZILLA.png',                 name: 'Mozilla Club',                  category: 'academic',      color: '#FF6611', coordinator: 'Dr. Vinod Rao',        foundedYear: '2018', memberCount: 61,  eventCount: 3 },
  { logo: 'IOT Club logo.png',           name: 'IoT Club',                      category: 'academic',      color: '#00B5A3', coordinator: 'Prof. Arun Kumar',     foundedYear: '2020', memberCount: 57,  eventCount: 3 },
  { logo: 'IMAGINATION TO IMPLEMENTATION.png', name: 'Imagination to Implementation', category: 'academic', color: '#A259FF', coordinator: 'Prof. Divya Nair', foundedYear: '2022', memberCount: 45, eventCount: 2 },
  { logo: 'CHANGE MAKERS E-CELL.png',    name: 'Change Makers E-Cell',          category: 'academic',      color: '#FF9500', coordinator: 'Dr. Kiran Sharma',     foundedYear: '2017', memberCount: 87,  eventCount: 5 },
  // Sports
  { logo: 'ZERO VIOLATION BASKETBALL CLUB.png', name: 'IRONCREED',             category: 'sports',    color: '#FF4757', coordinator: 'Coach Ramesh Iyer',    foundedYear: '2015', memberCount: 72,  eventCount: 3 },
  { logo: 'RKU RANGERS.png',             name: 'RKU Rangers FC',                category: 'sports',    color: '#00C896', coordinator: 'Coach Devraj Singh',   foundedYear: '2013', memberCount: 84,  eventCount: 4 },
  { logo: 'RKU SHUTTLE SMASHERS.png',    name: 'RKU Shuttle Smashers',          category: 'sports',    color: '#00AADD', coordinator: 'Prof. Ritesh Patel',   foundedYear: '2016', memberCount: 60,  eventCount: 3 },
  { logo: 'RKU VOLLEY AVENGERS.png',     name: 'RKU Volley Avengers',           category: 'sports',    color: '#E25600', coordinator: 'Coach Ravi Bose',      foundedYear: '2018', memberCount: 55,  eventCount: 3 },
  { logo: 'Kabaddi Warriors Club logo.png', name: 'Kabaddi Warriors',           category: 'sports',    color: '#9B2335', coordinator: 'Prof. Sunil Desai',    foundedYear: '2019', memberCount: 48,  eventCount: 2 },
  { logo: 'Powerhouse Club logo.png',    name: 'Powerhouse Fitness Club',       category: 'sports',    color: '#06D6A0', coordinator: 'Dr. Kavya Iyer',       foundedYear: '2022', memberCount: 63,  eventCount: 4 },
  { logo: 'RISING STAR.png',             name: 'Rising Star Cricket Club',      category: 'sports',    color: '#C7522A', coordinator: 'Coach Navin Shah',     foundedYear: '2014', memberCount: 76,  eventCount: 4 },
  // Cultural
  { logo: 'BUMBLEBEEZ.png',              name: 'Bumblebeez',                    category: 'cultural',  color: '#FFD166', coordinator: 'Prof. Kavya Menon',    foundedYear: '2018', memberCount: 39,  eventCount: 3 },
  { logo: 'SOUL OF MUSIC.png',           name: 'Soul of Music',                 category: 'cultural',  color: '#FF9500', coordinator: 'Dr. Arjun Pillai',     foundedYear: '2015', memberCount: 68,  eventCount: 4 },
  { logo: 'KALARAW.png',                 name: 'Kalaraw Club',                  category: 'cultural',  color: '#FF6B9D', coordinator: 'Dr. Leela Krishnan',   foundedYear: '2017', memberCount: 53,  eventCount: 3 },
  { logo: 'BHASHA.png',                  name: 'BHASHA Club',                   category: 'academic',  color: '#635BFF', coordinator: 'Prof. Bharat Rao',     foundedYear: '2018', memberCount: 44,  eventCount: 2 },
  { logo: "BREATHS & BEATS.png",         name: 'Breaths & Beats',               category: 'academic',  color: '#FF6B9D', coordinator: 'Prof. Nisha Menon',    foundedYear: '2019', memberCount: 41,  eventCount: 3 },
  { logo: "GOBBLER'S GANG.png",          name: "Gobbler's Gang",                category: 'academic',  color: '#F0A500', coordinator: 'Prof. Rahul Joshi',    foundedYear: '2020', memberCount: 35,  eventCount: 2 },
  { logo: 'RANG MANCH.png',              name: 'Rang Manch',                    category: 'academic',  color: '#D32F2F', coordinator: 'Dr. Pooja Sharma',     foundedYear: '2016', memberCount: 50,  eventCount: 3 },
  { logo: 'SHWET THE RISE OF HUMANITY.png', name: 'SHWET — Rise of Humanity',  category: 'social',    color: '#FF6B9D', coordinator: 'Dr. Ananya Roy',       foundedYear: '2016', memberCount: 56,  eventCount: 4 },
  { logo: 'AERO MODELLING.png',          name: 'Aero Modelling Club',           category: 'academic',  color: '#00C8FF', coordinator: 'Prof. Suresh Iyer',    foundedYear: '2019', memberCount: 34,  eventCount: 2 },
  { logo: 'NIRMAAN.png',                 name: 'Club Nirmaan',                  category: 'academic',  color: '#FF9500', coordinator: 'Dr. Rahul Verma',      foundedYear: '2016', memberCount: 61,  eventCount: 2 },
  { logo: 'PRODUCT DESIGN.png',          name: 'Product Design Club',           category: 'academic',  color: '#A259FF', coordinator: 'Prof. Riya Das',       foundedYear: '2020', memberCount: 42,  eventCount: 2 },
  { logo: 'PICTZA.png',                  name: 'Pictza Club',                   category: 'cultural',  color: '#A259FF', coordinator: 'Prof. Meera Singh',    foundedYear: '2019', memberCount: 47,  eventCount: 2 },
  // Health
  { logo: 'PHARMA HEALTH CLUB.png',      name: 'Pharma Health Club',            category: 'academic',    color: '#00C896', coordinator: 'Dr. Preethi Nair',     foundedYear: '2018', memberCount: 55,  eventCount: 3 },
  { logo: 'PARKINSON DISEASE SUPPORT GROUP.png', name: 'Parkinson Disease Support', category: 'academic', color: '#635BFF', coordinator: 'Dr. Sunita Kumar', foundedYear: '2020', memberCount: 31, eventCount: 2 },
  { logo: 'RAJKOT KNEE CLUB.png',        name: 'Rajkot Knee Club',              category: 'academic',    color: '#FF6B9D', coordinator: 'Dr. Anil Mehta',       foundedYear: '2021', memberCount: 28,  eventCount: 2 },
  { logo: 'MICROBIOLOGIST CLUB.png',     name: 'Microbiologist Club',           category: 'academic',    color: '#635BFF', coordinator: 'Prof. Kavitha Bose',   foundedYear: '2019', memberCount: 43,  eventCount: 2 },
  { logo: 'MEDICINAL PLANTS CLUB.png',   name: 'Medicinal Plants Club',         category: 'academic',    color: '#00C896', coordinator: 'Prof. Sneha Rao',      foundedYear: '2020', memberCount: 38,  eventCount: 2 },
  { logo: 'AYUSHAMRIT.png',              name: 'Ayushamrit Club',               category: 'academic',    color: '#4B6E2E', coordinator: 'Dr. Vijay Pillai',     foundedYear: '2021', memberCount: 35,  eventCount: 2 },
  // Community
  { logo: 'GSG Club Logo.png',           name: 'GSG Club',                      category: 'academic', color: '#4B6E2E', coordinator: 'Lt. Col. V. Desai',    foundedYear: '2010', memberCount: 120, eventCount: 6 },
  { logo: 'SAPIENS THE HR CLUB.png',     name: 'Sapiens — The HR Club',         category: 'academic', color: '#A259FF', coordinator: 'Prof. Aditi Sharma',   foundedYear: '2019', memberCount: 57,  eventCount: 3 },
  { logo: 'UNITE.png',                   name: 'Unite Club',                    category: 'academic', color: '#FF6B9D', coordinator: 'Dr. Priya Menon',      foundedYear: '2020', memberCount: 49,  eventCount: 3 },
  { logo: 'SETU - MUN.png',              name: 'SETU — MUN',                    category: 'academic', color: '#635BFF', coordinator: 'Prof. Sanjay Ghosh',   foundedYear: '2018', memberCount: 66,  eventCount: 4 },
  { logo: 'WOMEN WONDERS.png',           name: 'Women Wonders',                 category: 'academic', color: '#FF6B9D', coordinator: 'Dr. Rekha Iyer',       foundedYear: '2017', memberCount: 74,  eventCount: 4 },
  { logo: 'KNOW YOUR FINANCE.png',       name: 'Know Your Finance',             category: 'academic', color: '#FF9500', coordinator: 'Dr. Rohan Shah',       foundedYear: '2017', memberCount: 66,  eventCount: 4 },
  { logo: 'MATHEMAGICIANS.png',          name: 'Mathemagicians',                category: 'academic', color: '#635BFF', coordinator: 'Prof. Anika Joshi',    foundedYear: '2018', memberCount: 52,  eventCount: 3 },
  { logo: 'THE KING OF 64.png',          name: 'The King of 64 — Chess',        category: 'sports',   color: '#9CA3AF', coordinator: 'Prof. Mohan Rao',      foundedYear: '2014', memberCount: 48,  eventCount: 3 },
];

const EVENTS = [
  { title: 'Galore 2027 — Annual Mega Fest', club: 'SOAC · RK University',      category: 'annual-fest', status: 'upcoming', date: 'Feb 2–8, 2027',     startDate: new Date('2027-02-02'), time: '9:00 AM onwards', venue: 'RKU Main Campus',       description: '7-day inter-college festival with 40+ clubs, 1,400+ participants.', tags: ['Mega Fest','7 Days','All Clubs'], seats: 'Open Registration', image: 'i20.png' },
  { title: 'RKU Sports Fiesta 2026',         club: 'Sports Division · SOAC',    category: 'sports',      status: 'upcoming', date: 'Nov 14–17, 2026',   startDate: new Date('2026-11-14'), time: '8:00 AM',          venue: 'RKU Sports Ground',     description: 'Four-day multi-sport championship.', tags: ['Sports','4 Days','Inter-College'], seats: '240 seats left', image: 'asset-6.png' },
  { title: 'Rhythm & Soul — Music Night',    club: 'Soul of Music · SOAC',      category: 'cultural',    status: 'upcoming', date: 'Oct 4, 2026',       startDate: new Date('2026-10-04'), time: '6:30 PM',          venue: 'Amphitheatre, RKU',     description: 'An acoustic evening with live performances.', tags: ['Music','Live','Cultural'], seats: '180 seats left', image: 'asset-8.png' },
  { title: 'Code Sprint — 24-Hour Hackathon',club: 'Change Makers E-Cell',      category: 'academic',        status: 'upcoming', date: 'Sep 20–21, 2026',   startDate: new Date('2026-09-20'), time: '10:00 AM (24hr)',  venue: 'CS Lab Block, RKU',     description: 'Build real solutions in 24 hours.', tags: ['Hackathon','Tech','24hr'], seats: '120 seats left', image: 'i23.png' },
  { title: 'Galore 2026 — Annual Mega Fest', club: 'SOAC · RK University',      category: 'annual-fest', status: 'past',     date: 'Feb 3–9, 2026',     startDate: new Date('2026-02-03'), time: '9:00 AM onwards', venue: 'RKU Main Campus',       description: '7-day mega fest — over 1,200 participants.', tags: ['Mega Fest','Annual'], seats: '', highlight: '🏆 Best Edition Yet — 1,200+ Students', image: 'i20.png' },
  { title: 'Guard of Honour — Galore 2026',  club: 'NCC Wing · SOAC',           category: 'cultural',    status: 'past',     date: 'Feb 3, 2026',       startDate: new Date('2026-02-03'), time: '10:00 AM',         venue: 'Main Auditorium, RKU',  description: 'NCC cadets led the ceremonial guard of honour.', tags: ['Ceremony','NCC'], seats: '', image: 'i15.png' },
];

(async () => {
  try {
    await ensureSoacTables();
    console.log('Connected to PostgreSQL');

    await pgPool.query('DELETE FROM event_registrations');
    await pgPool.query('DELETE FROM join_requests');
    await pgPool.query('DELETE FROM events');
    await pgPool.query('DELETE FROM clubs');
    console.log('Cleared existing data');

    for (const c of CLUBS) {
      await pgPool.query(
        `INSERT INTO clubs
         (name, slug, category, color, coordinator, founded_year, member_count, event_count, logo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          c.name,
          slugify(c.name, { lower: true, strict: true }),
          c.category,
          c.color,
          c.coordinator || '',
          c.foundedYear || '',
          Number(c.memberCount) || 0,
          Number(c.eventCount) || 0,
          c.logo || '',
        ]
      );
    }
    console.log(`✅  Seeded ${CLUBS.length} clubs`);

    for (const e of EVENTS) {
      await pgPool.query(
        `INSERT INTO events
        (title, club, category, status, date, start_date, time, venue, description, tags, seats, highlight, image)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          e.title,
          e.club || '',
          e.category || 'general',
          e.status || 'upcoming',
          e.date || '',
          e.startDate || null,
          e.time || '',
          e.venue || '',
          e.description || '',
          e.tags || [],
          e.seats || '',
          e.highlight || '',
          e.image || '',
        ]
      );
    }
    console.log(`✅  Seeded ${EVENTS.length} events`);

    await pgPool.end();
    console.log('Done. Disconnected.');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
})();
