/**
 * Auto-seed: called by server.js on startup.
 * UPSERTS all 40 clubs with full rich data (description, tags, vision, rules, schedule).
 * ON CONFLICT (slug) only overwrites fields that are still empty — admin edits are preserved.
 * Events are inserted only on the first run (count = 0).
 */
const slugify = require('slugify');
const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');

const CLUBS = [
  /* ── Technology ──────────────────────────────────────────────────────────── */
  {
    logo: 'ANDROID DEVLOPMENT CLUB.png', name: 'Android Development Club', category: 'academic',
    color: '#3DDC84', coordinator: 'Prof. Anita Mehta', foundedYear: '2019', memberCount: 98, eventCount: 4,
    description: 'A hands-on club dedicated to Android app development. Members build real-world Android apps, explore Kotlin and Java, and compete in national mobile hackathons.',
    tags: ['Android', 'Mobile Dev', 'Kotlin', 'Java', 'Hackathon'],
    vision: 'To produce industry-ready Android developers who solve real campus problems through mobile technology.',
    rules: [
      'Attend at least 70% of weekly coding sessions.',
      'Submit one mini-project per semester.',
      'Treat all members with respect — zero tolerance for harassment.',
      'No plagiarism in code submissions.',
      'Represent the club professionally at all external events.',
    ],
    schedule: 'Weekly sessions every Wednesday, 4:00 PM – 6:00 PM in CS Lab 3.\nMonthly hackathons on the last Saturday of each month.\nProject showcases at the end of each semester.',
  },
  {
    logo: 'WEBIFY.png', name: 'Webify Club', category: 'academic',
    color: '#635BFF', coordinator: 'Dr. Rajesh Pillai', foundedYear: '2020', memberCount: 74, eventCount: 3,
    description: 'Webify is the hub for web development enthusiasts at RKU. From HTML/CSS to full-stack React and Node.js, members build portfolio sites to production web apps.',
    tags: ['Web Dev', 'React', 'Node.js', 'UI/UX', 'Full Stack'],
    vision: 'To cultivate a generation of skilled web developers who can design, develop, and deploy modern web applications.',
    rules: [
      'Complete at least one project per semester.',
      'Attend 75% of workshops.',
      'Contribute to at least one open-source project per year.',
      'Maintain code quality standards set by the club.',
      'Help onboard new members.',
    ],
    schedule: 'Meetings every Tuesday & Thursday, 5:00 PM – 7:00 PM in IT Lab 2.\nWorkshops on alternate Saturdays.\nAnnual web-fest at end of the academic year.',
  },
  {
    logo: 'iOS DEVLOPMENT CLUB.png', name: 'iOS Development Club', category: 'academic',
    color: '#007AFF', coordinator: 'Prof. Sneha Mehta', foundedYear: '2021', memberCount: 52, eventCount: 2,
    description: 'The iOS Development Club explores the Apple ecosystem — from Swift and SwiftUI to ARKit and CoreML. Members build apps for iPhone, iPad, and Apple Watch.',
    tags: ['iOS', 'Swift', 'SwiftUI', 'Apple', 'Mobile'],
    vision: 'To build a community of skilled Apple platform developers who create impactful apps for the global App Store.',
    rules: [
      'Own or have access to a Mac for development.',
      'Attend 70% of lab sessions.',
      'Publish at least one app to TestFlight per year.',
      'Share learnings with the group regularly.',
      'Maintain a respectful and collaborative environment.',
    ],
    schedule: 'Sessions every Monday, 4:00 PM – 6:00 PM in CS Lab 4.\nDesign sprints every other Friday.\nApp demos at the end of each semester.',
  },
  {
    logo: 'MOZILLA.png', name: 'Mozilla Club', category: 'academic',
    color: '#FF6611', coordinator: 'Dr. Vinod Rao', foundedYear: '2018', memberCount: 61, eventCount: 3,
    description: 'The Mozilla Club at RKU promotes open-source culture, web literacy, and internet health. Members contribute to Firefox, MDN, and other Mozilla projects while learning web standards and privacy technologies.',
    tags: ['Open Source', 'Web Literacy', 'Firefox', 'Privacy', 'Mozilla'],
    vision: 'To create digitally literate citizens who understand, contribute to, and protect the open internet.',
    rules: [
      'Contribute to at least one open-source project per semester.',
      'Attend community meetings regularly.',
      'Share knowledge through blog posts or workshops.',
      'Respect the Mozilla Community Participation Guidelines.',
      'Promote internet health on campus.',
    ],
    schedule: 'Open-source sprints every Saturday, 10:00 AM – 1:00 PM in CS Lab 1.\nMonthly speaker sessions on web technologies.\nAnnual Mozilla Festival participation.',
  },
  {
    logo: 'IOT Club logo.png', name: 'IoT Club', category: 'academic',
    color: '#00B5A3', coordinator: 'Prof. Arun Kumar', foundedYear: '2020', memberCount: 57, eventCount: 3,
    description: 'The IoT Club bridges hardware and software, building connected devices using Arduino, Raspberry Pi, and cloud platforms. From smart campus solutions to industrial IoT projects, members learn by building.',
    tags: ['IoT', 'Arduino', 'Raspberry Pi', 'Embedded', 'Smart Systems'],
    vision: 'To develop engineers who can design and deploy connected systems that solve real-world problems.',
    rules: [
      'Handle lab equipment with care.',
      'Document all projects in the club repository.',
      'Attend at least 70% of build sessions.',
      'Return borrowed components by the next session.',
      'Collaborate on at least one team project per year.',
    ],
    schedule: 'Build sessions every Friday, 4:00 PM – 7:00 PM in Electronics Lab.\nPrototype showcases monthly.\nAnnual IoT Exhibition at end of year.',
  },
  {
    logo: 'IMAGINATION TO IMPLEMENTATION.png', name: 'Imagination to Implementation', category: 'academic',
    color: '#A259FF', coordinator: 'Prof. Divya Nair', foundedYear: '2022', memberCount: 45, eventCount: 2,
    description: 'I2I is an innovation incubator where ideas become prototypes. From concept sketches to working MVPs, the club supports student entrepreneurs through design thinking, rapid prototyping, and mentorship.',
    tags: ['Innovation', 'Startup', 'Design Thinking', 'Prototyping', 'MVP'],
    vision: 'To transform student ideas into scalable solutions that create real-world impact.',
    rules: [
      'Bring a new idea to every bi-weekly meeting.',
      'Respect intellectual property of fellow members.',
      'Commit to seeing your project through at least one demo.',
      'Provide constructive feedback during reviews.',
      'Collaborate across disciplines.',
    ],
    schedule: 'Innovation sprints every Tuesday, 5:00 PM – 7:30 PM in Innovation Lab.\nMentor sessions on 1st and 3rd Saturday of each month.\nDemoDay at end of each semester.',
  },
  {
    logo: 'CHANGE MAKERS E-CELL.png', name: 'Change Makers E-Cell', category: 'academic',
    color: '#FF9500', coordinator: 'Dr. Kiran Sharma', foundedYear: '2017', memberCount: 87, eventCount: 5,
    description: 'The Entrepreneurship Cell at RKU is the launchpad for student startups. E-Cell runs incubation programs, investor pitch events, business plan competitions, and connects members with industry mentors.',
    tags: ['Entrepreneurship', 'Startup', 'Business', 'Innovation', 'Pitch'],
    vision: 'To nurture the next generation of job creators who build sustainable businesses and drive economic growth.',
    rules: [
      'Maintain confidentiality of member business ideas.',
      'Participate in at least one competition per year.',
      'Attend all mandatory pitch and workshop sessions.',
      'Network actively at all E-Cell events.',
      'Support fellow entrepreneurs without seeking personal gain.',
    ],
    schedule: 'Weekly seminars every Wednesday, 5:00 PM – 6:30 PM.\nMonthly pitch nights — last Friday of each month.\nAnnual business plan competition in January.',
  },

  /* ── Sports ──────────────────────────────────────────────────────────────── */
  {
    logo: 'ZERO VIOLATION BASKETBALL CLUB.png', name: 'IRONCREED', category: 'sports',
    color: '#FF4757', coordinator: 'Coach Ramesh Iyer', foundedYear: '2015', memberCount: 72, eventCount: 3,
    description: 'IRONCREED is the premier combat-sports and fitness club at RKU. Combining basketball fundamentals with strength conditioning, the club fosters discipline, agility, and competitive excellence.',
    tags: ['Basketball', 'Fitness', 'Sports', 'Strength', 'Competition'],
    vision: 'To build athletes of character — competitive on the court, disciplined in life.',
    rules: [
      'Attend all scheduled practices unless injured or excused.',
      'Maintain physical fitness standards set by the coach.',
      'Show sportsmanship at all times.',
      'No substance use — zero tolerance.',
      'Represent RKU with pride at every tournament.',
    ],
    schedule: 'Training: Monday, Wednesday, Friday — 6:00 AM – 8:00 AM on the outdoor court.\nStrength conditioning: Tuesday & Thursday — 5:00 PM – 6:30 PM in the gym.\nInter-college matches as per fixtures.',
  },
  {
    logo: 'RKU RANGERS.png', name: 'RKU Rangers FC', category: 'sports',
    color: '#00C896', coordinator: 'Coach Devraj Singh', foundedYear: '2013', memberCount: 84, eventCount: 4,
    description: 'RKU Rangers FC is the university\'s flagship football club, competing at state and national inter-college tournaments. With professional coaching, the club produces technically skilled, tactically aware players.',
    tags: ['Football', 'Soccer', 'Team Sport', 'Fitness', 'Competition'],
    vision: 'To represent RKU at the national stage and produce footballers who play with passion, discipline, and intelligence.',
    rules: [
      'Attend 80% of training sessions to be eligible for matches.',
      'Follow the coach\'s tactical instructions.',
      'Respect opponents and officials.',
      'Maintain a healthy lifestyle and training routine.',
      'No use of prohibited substances.',
    ],
    schedule: 'Training: Tuesday, Thursday, Saturday — 6:00 AM – 8:00 AM at the football ground.\nTactical sessions every Sunday, 4:00 PM – 6:00 PM.\nFriendly matches once per month during the season.',
  },
  {
    logo: 'RKU SHUTTLE SMASHERS.png', name: 'RKU Shuttle Smashers', category: 'sports',
    color: '#00AADD', coordinator: 'Prof. Ritesh Patel', foundedYear: '2016', memberCount: 60, eventCount: 3,
    description: 'The Shuttle Smashers are RKU\'s competitive badminton club. Members train in singles, doubles, and mixed doubles formats under expert coaching, competing in inter-college and university-level championships.',
    tags: ['Badminton', 'Racquet Sport', 'Fitness', 'Singles', 'Doubles'],
    vision: 'To create champions of the court who embody speed, precision, and sportsmanship.',
    rules: [
      'Maintain personal equipment and return club racquets properly.',
      'Attend minimum 3 sessions per week for competitive team eligibility.',
      'Warm up and cool down as instructed.',
      'Respect court time and fellow players.',
      'Report any injuries to the coach immediately.',
    ],
    schedule: 'Court sessions: Monday to Saturday — 5:30 AM – 7:30 AM in the indoor courts.\nWeekly doubles practice: Sunday, 4:00 PM – 6:00 PM.\nMonthly internal tournaments.',
  },
  {
    logo: 'RKU VOLLEY AVENGERS.png', name: 'RKU Volley Avengers', category: 'sports',
    color: '#E25600', coordinator: 'Coach Ravi Bose', foundedYear: '2018', memberCount: 55, eventCount: 3,
    description: 'The Volley Avengers bring high-energy volleyball to RKU\'s campus. The club trains both beach and indoor volleyball disciplines and regularly competes in Gujarat state university leagues.',
    tags: ['Volleyball', 'Beach Volleyball', 'Team Sport', 'Athletics', 'League'],
    vision: 'To build a championship-winning volleyball team that competes at the national inter-university level.',
    rules: [
      'Be punctual for all sessions.',
      'Follow rotation and positional assignments.',
      'Support teammates both on and off the court.',
      'Wear proper sports attire during all sessions.',
      'Report injuries to the coach before practice.',
    ],
    schedule: 'Indoor practice: Monday, Wednesday, Friday — 5:00 PM – 7:00 PM.\nBeach volleyball: Saturday mornings, 7:00 AM – 9:00 AM.\nLeague matches as per schedule.',
  },
  {
    logo: 'Kabaddi Warriors Club logo.png', name: 'Kabaddi Warriors', category: 'sports',
    color: '#9B2335', coordinator: 'Prof. Sunil Desai', foundedYear: '2019', memberCount: 48, eventCount: 2,
    description: 'Kabaddi Warriors celebrate India\'s traditional sport at RKU. The club competes in the Gujarat University Kabaddi League and runs awareness drives to keep this indigenous sport alive in modern campuses.',
    tags: ['Kabaddi', 'Traditional Sport', 'India', 'Fitness', 'Contact Sport'],
    vision: 'To preserve and promote Kabaddi as a competitive and respected sport in university culture.',
    rules: [
      'Practice prescribed breathing and raiding techniques.',
      'No intentional harmful contact.',
      'Attend all team strategy sessions before matches.',
      'Follow weight and fitness guidelines.',
      'Represent the sport with pride and cultural respect.',
    ],
    schedule: 'Practice: Tuesday, Thursday, Saturday — 6:00 AM – 8:00 AM on the Kabaddi court.\nWeekly strategy sessions: Sunday, 3:00 PM – 4:30 PM.\nLeague games as per fixtures.',
  },
  {
    logo: 'Powerhouse Club logo.png', name: 'Powerhouse Fitness Club', category: 'sports',
    color: '#06D6A0', coordinator: 'Dr. Kavya Iyer', foundedYear: '2022', memberCount: 63, eventCount: 4,
    description: 'Powerhouse Fitness Club is RKU\'s dedicated gym and wellness community. From strength training and CrossFit to yoga and nutrition workshops, Powerhouse helps students build bodies and habits for life.',
    tags: ['Fitness', 'Gym', 'Wellness', 'CrossFit', 'Nutrition'],
    vision: 'To make physical and mental fitness a non-negotiable part of every RKU student\'s daily routine.',
    rules: [
      'Follow gym safety protocols at all times.',
      'Re-rack weights after use.',
      'Consult with the fitness coach before starting a new program.',
      'No body-shaming or negative commentary.',
      'Respect the gym space and all equipment.',
    ],
    schedule: 'Open gym: Monday to Saturday — 6:00 AM – 8:00 AM and 5:00 PM – 7:00 PM.\nGroup CrossFit: Wednesday & Friday, 6:30 AM.\nNutrition workshop: first Sunday of each month, 10:00 AM.',
  },
  {
    logo: 'RISING STAR.png', name: 'Rising Star Cricket Club', category: 'sports',
    color: '#C7522A', coordinator: 'Coach Navin Shah', foundedYear: '2014', memberCount: 76, eventCount: 4,
    description: 'Rising Star Cricket Club is the heartbeat of cricket at RKU. From practice nets to inter-college T20 tournaments, the club develops technically sound cricketers under professional coaching.',
    tags: ['Cricket', 'T20', 'Batting', 'Bowling', 'Team Sport'],
    vision: 'To produce well-rounded cricketers who represent RKU in state-level competitions and inspire the next generation.',
    rules: [
      'Attend minimum 4 net sessions per week for match selection.',
      'Maintain batting and bowling records in the club log.',
      'Follow team strategy and field placements.',
      'Use protective gear at all times in the nets.',
      'Show respect to opponents and umpires.',
    ],
    schedule: 'Net practice: Monday to Saturday — 6:00 AM – 8:30 AM.\nFitness sessions: Tuesday & Thursday, 5:00 PM – 6:30 PM.\nT20 league matches on weekends.',
  },

  /* ── Cultural ─────────────────────────────────────────────────────────────── */
  {
    logo: 'BUMBLEBEEZ.png', name: 'Bumblebeez', category: 'cultural',
    color: '#FFD166', coordinator: 'Prof. Kavya Menon', foundedYear: '2018', memberCount: 39, eventCount: 3,
    description: 'Bumblebeez is RKU\'s premier dance club, buzzing with energy across styles from Bollywood and classical Indian dance to Hip-Hop and contemporary. The club performs at all major campus festivals and inter-college competitions.',
    tags: ['Dance', 'Bollywood', 'Hip-Hop', 'Contemporary', 'Performance'],
    vision: 'To make dance a joyful, disciplined art form that every student can explore and perform with confidence.',
    rules: [
      'Attend all rehearsals before any public performance.',
      'Respect different dance styles and traditions.',
      'Maintain costumes and props responsibly.',
      'No unauthorised use of club choreography.',
      'Give constructive feedback to fellow dancers.',
    ],
    schedule: 'Rehearsals: Monday, Wednesday, Friday — 5:00 PM – 7:30 PM in the Auditorium Studio.\nWeekend prep sessions before competitions.\nPerformances at Galore, Inter-Collegiate Fest, and campus events.',
  },
  {
    logo: 'SOUL OF MUSIC.png', name: 'Soul of Music', category: 'cultural',
    color: '#FF9500', coordinator: 'Dr. Arjun Pillai', foundedYear: '2015', memberCount: 68, eventCount: 4,
    description: 'Soul of Music is RKU\'s music club — a space for singers, guitarists, tabla players, and beatboxers to jam, compose, and perform. The club hosts open mics, recording sessions, and an annual music night.',
    tags: ['Music', 'Singing', 'Guitar', 'Percussion', 'Performance', 'Composition'],
    vision: 'To nurture musical talent and create a vibrant culture where every genre and instrument finds its voice on campus.',
    rules: [
      'Respect all musical genres and traditions.',
      'Return borrowed instruments in good condition.',
      'Practise individually before group rehearsals.',
      'Give every performer equal stage time at open mics.',
      'Maintain a supportive, non-judgmental environment.',
    ],
    schedule: 'Jam sessions: Tuesday & Thursday, 5:00 PM – 7:00 PM in the Music Room.\nOpen mic: last Friday of each month, 6:00 PM – 9:00 PM.\nAnnual Music Night: October.',
  },
  {
    logo: 'KALARAW.png', name: 'Kalaraw Club', category: 'cultural',
    color: '#FF6B9D', coordinator: 'Dr. Leela Krishnan', foundedYear: '2017', memberCount: 53, eventCount: 3,
    description: 'Kalaraw celebrates the richness of Indian classical and folk arts. Members participate in bharatanatyam, folk dance, regional theatre, and traditional art forms — keeping India\'s cultural heritage alive on campus.',
    tags: ['Classical Arts', 'Folk Dance', 'Theatre', 'Culture', 'Heritage'],
    vision: 'To preserve and popularise India\'s classical and folk arts among the university\'s youth.',
    rules: [
      'Approach traditional arts with respect and sincerity.',
      'Practice regularly and maintain artistic discipline.',
      'Respect the knowledge of senior artists and gurus.',
      'Dress appropriately for cultural performances.',
      'Represent the club\'s cultural mission at all public events.',
    ],
    schedule: 'Classical dance practice: Monday & Wednesday, 5:00 PM – 7:00 PM in the Cultural Hall.\nTheatre rehearsals: Friday evenings, 5:00 PM – 7:30 PM.\nPerformances at Galore, cultural festivals, and national programs.',
  },
  {
    logo: 'BHASHA.png', name: 'BHASHA Club', category: 'academic',
    color: '#635BFF', coordinator: 'Prof. Bharat Rao', foundedYear: '2018', memberCount: 44, eventCount: 2,
    description: 'BHASHA is RKU\'s language and literature club. Through debates, storytelling, creative writing, and spoken-word poetry, BHASHA celebrates the power of language — in Hindi, English, Gujarati, and beyond.',
    tags: ['Literature', 'Debate', 'Creative Writing', 'Poetry', 'Languages'],
    vision: 'To build confident communicators and creative writers who use language as a tool for thought, expression, and change.',
    rules: [
      'Respect all languages equally.',
      'Constructive feedback only during writing workshops.',
      'Maintain confidentiality of unpublished creative work.',
      'Attend at least 70% of sessions.',
      'Encourage members to participate in at least one event per semester.',
    ],
    schedule: 'Writing workshops: Tuesday, 5:00 PM – 7:00 PM.\nDebate practice: Thursday, 5:00 PM – 6:30 PM.\nPoetry open mic: last Saturday of each month, 4:00 PM.',
  },
  {
    logo: 'BREATHS & BEATS.png', name: 'Breaths & Beats', category: 'academic',
    color: '#FF6B9D', coordinator: 'Prof. Nisha Menon', foundedYear: '2019', memberCount: 41, eventCount: 3,
    description: 'Breaths & Beats is RKU\'s fusion performing-arts club. Members combine music, dance, and spoken word to create original multi-media performances that blur the lines between art forms.',
    tags: ['Fusion Arts', 'Performance', 'Dance', 'Music', 'Spoken Word'],
    vision: 'To push the boundaries of performance art and create experiences that move, inspire, and challenge audiences.',
    rules: [
      'Embrace experimentation and creative risk-taking.',
      'Collaborate with members from all art forms.',
      'Meet all performance commitments and rehearsal schedules.',
      'Respect the creative vision of the lead artist for each production.',
      'Support each other through feedback and encouragement.',
    ],
    schedule: 'Collaborative sessions: Monday & Thursday, 5:00 PM – 7:30 PM in the Arts Hall.\nProduction rehearsals intensify two weeks before any show.\nAnnual showcase performance in March.',
  },
  {
    logo: "GOBBLER'S GANG.png", name: "Gobbler's Gang", category: 'academic',
    color: '#F0A500', coordinator: 'Prof. Rahul Joshi', foundedYear: '2020', memberCount: 35, eventCount: 2,
    description: 'Gobbler\'s Gang is RKU\'s culinary arts club. Members explore global cuisines, host cook-offs, run food stalls at campus festivals, and conduct food-literacy workshops teaching sustainable and nutritious cooking.',
    tags: ['Culinary Arts', 'Cooking', 'Food', 'Cultural Exchange', 'Sustainability'],
    vision: 'To celebrate food as culture, and empower students with culinary skills and nutritional awareness.',
    rules: [
      'Maintain hygiene and food safety standards at all times.',
      'Share recipes and techniques openly within the club.',
      'Respect dietary preferences and restrictions of all members.',
      'Clean up after every cooking session.',
      'Do not waste food — practice sustainability.',
    ],
    schedule: 'Cooking sessions: Saturday, 10:00 AM – 1:00 PM in the Home Science lab.\nMonthly cook-off competitions on the 2nd Sunday.\nFood stalls at all major campus events.',
  },
  {
    logo: 'RANG MANCH.png', name: 'Rang Manch', category: 'academic',
    color: '#D32F2F', coordinator: 'Dr. Pooja Sharma', foundedYear: '2016', memberCount: 50, eventCount: 3,
    description: 'Rang Manch is RKU\'s drama and theatre club. From street plays on social issues to full-scale theatrical productions, the club develops actors, directors, and backstage crew with professional-level training.',
    tags: ['Theatre', 'Drama', 'Street Play', 'Acting', 'Performance'],
    vision: 'To use theatre as a mirror for society — entertain, educate, and challenge through the power of performance.',
    rules: [
      'Commit to the full rehearsal schedule of each production.',
      'Give everything in character — no half-hearted performances.',
      'Respect the director\'s creative vision.',
      'Learn your lines before the first full-cast rehearsal.',
      'Support backstage crew — they are as important as actors.',
    ],
    schedule: 'Script readings & workshops: Monday & Wednesday, 5:00 PM – 7:00 PM.\nFull rehearsals: Friday & Saturday, 4:00 PM – 8:00 PM (production period).\nAnnual play in February; street-play season in August–September.',
  },
  {
    logo: 'SHWET THE RISE OF HUMANITY.png', name: 'SHWET — Rise of Humanity', category: 'social',
    color: '#FF6B9D', coordinator: 'Dr. Ananya Roy', foundedYear: '2016', memberCount: 56, eventCount: 4,
    description: 'SHWET blends art and social advocacy. Through visual art campaigns, documentary film, and community storytelling, SHWET amplifies voices for justice, empathy, and positive social change.',
    tags: ['Social Art', 'Advocacy', 'Visual Art', 'Documentary', 'Community'],
    vision: 'To harness the power of art and storytelling to build a more empathetic and just campus and world.',
    rules: [
      'Approach all social issues with sensitivity and depth.',
      'Credit community voices and stories appropriately.',
      'Maintain artistic integrity — no misrepresentation.',
      'Collaborate with NGOs and community organisations respectfully.',
      'Ensure safe spaces in all club discussions.',
    ],
    schedule: 'Art and media sessions: Wednesday, 4:00 PM – 6:30 PM.\nCommunity outreach: one Saturday per month.\nAnnual art exhibition and documentary screening in November.',
  },
  {
    logo: 'AERO MODELLING.png', name: 'Aero Modelling Club', category: 'academic',
    color: '#00C8FF', coordinator: 'Prof. Suresh Iyer', foundedYear: '2019', memberCount: 34, eventCount: 2,
    description: 'The Aero Modelling Club designs, builds, and flies model aircraft — from balsa wood gliders to GPS-guided drones. Members compete in national aeromodelling contests and advance into UAV research.',
    tags: ['Aeromodelling', 'Drones', 'RC Aircraft', 'Engineering', 'Aviation'],
    vision: 'To create aviation enthusiasts and engineers who understand aerodynamics by building and flying their own machines.',
    rules: [
      'Follow all DGCA guidelines for drone and model aircraft operation.',
      'Never fly over people or restricted areas.',
      'Maintain all models and equipment in the club workshop.',
      'Brief all new members on safety before any flying session.',
      'Respect flying-field etiquette and right-of-way rules.',
    ],
    schedule: 'Build sessions: Tuesday & Thursday, 4:00 PM – 6:00 PM in the Aeromodelling Workshop.\nFlying sessions: Sunday mornings, 7:00 AM – 10:00 AM at the flying field.\nIntensive weekends before national competitions.',
  },
  {
    logo: 'NIRMAAN.png', name: 'Club Nirmaan', category: 'academic',
    color: '#FF9500', coordinator: 'Dr. Rahul Verma', foundedYear: '2016', memberCount: 61, eventCount: 2,
    description: 'Club Nirmaan is RKU\'s social construction club. Members build low-cost infrastructure for rural communities — benches, shelters, water-collection units — combining engineering skills with community service.',
    tags: ['Social Construction', 'Community', 'Rural Development', 'Engineering', 'Service'],
    vision: 'To use engineering as a tool for social good — building communities, one structure at a time.',
    rules: [
      'Prioritise community needs over personal design preferences.',
      'Work safely on all construction sites.',
      'Never compromise on structural safety.',
      'Document all project plans and outcomes.',
      'Respect the local culture and environment of project sites.',
    ],
    schedule: 'Planning & design sessions: Saturday, 10:00 AM – 12:00 PM.\nCommunity construction drives: quarterly weekend trips.\nProject review meetings: second Thursday of each month.',
  },
  {
    logo: 'PRODUCT DESIGN.png', name: 'Product Design Club', category: 'academic',
    color: '#A259FF', coordinator: 'Prof. Riya Das', foundedYear: '2020', memberCount: 42, eventCount: 2,
    description: 'The Product Design Club at RKU bridges creativity and functionality. Members design physical and digital products using CAD, 3D printing, and UX research — creating prototypes that solve real user problems.',
    tags: ['Product Design', 'UX', 'CAD', '3D Printing', 'Prototyping'],
    vision: 'To develop designers who think deeply about users and craft products that are beautiful, functional, and meaningful.',
    rules: [
      'User research must precede any design decision.',
      'Share design files in the club repository.',
      'Provide specific, evidence-based feedback in design reviews.',
      'Respect intellectual property of other designers.',
      'Iterate — never be satisfied with a first draft.',
    ],
    schedule: 'Design sprints: Tuesday & Thursday, 5:00 PM – 7:00 PM in the Design Studio.\n3D printing sessions: Saturday, 10:00 AM – 1:00 PM.\nMonthly portfolio reviews and critique sessions.',
  },
  {
    logo: 'PICTZA.png', name: 'Pictza Club', category: 'cultural',
    color: '#A259FF', coordinator: 'Prof. Meera Singh', foundedYear: '2019', memberCount: 47, eventCount: 2,
    description: 'Pictza is RKU\'s visual arts and photography club. Members explore fine art, graphic design, digital illustration, and photography — documenting campus life and creating visual campaigns for events.',
    tags: ['Visual Art', 'Photography', 'Graphic Design', 'Illustration', 'Digital Art'],
    vision: 'To nurture visual storytellers who capture and create beauty in the world around them.',
    rules: [
      'Credit subjects and collaborators in all published work.',
      'Obtain consent before posting photos of other people.',
      'Maintain shared equipment responsibly.',
      'Share skills — experienced members mentor beginners.',
      'Participate in at least one exhibition or showcase per year.',
    ],
    schedule: 'Sketch & shoot sessions: Monday & Wednesday, 4:00 PM – 6:00 PM.\nPhoto walks: one Sunday per month.\nAnnual art exhibition: February.',
  },

  /* ── Health ───────────────────────────────────────────────────────────────── */
  {
    logo: 'PHARMA HEALTH CLUB.png', name: 'Pharma Health Club', category: 'academic',
    color: '#00C896', coordinator: 'Dr. Preethi Nair', foundedYear: '2018', memberCount: 55, eventCount: 3,
    description: 'The Pharma Health Club educates students and the community about pharmaceuticals, drug safety, and preventive healthcare. Members run awareness camps, medication literacy workshops, and assist in public health drives.',
    tags: ['Pharmacy', 'Health Education', 'Drug Safety', 'Public Health', 'Awareness'],
    vision: 'To empower every student and community member with the knowledge to make informed healthcare decisions.',
    rules: [
      'Disseminate only evidence-based health information.',
      'Maintain patient confidentiality during health camps.',
      'Follow all pharmaceutical handling regulations.',
      'Coordinate with faculty before any public health activity.',
      'Never provide prescription advice to the public.',
    ],
    schedule: 'Monthly health camps: second Saturday of each month.\nWeekly study circle: Wednesday, 5:00 PM – 6:30 PM.\nNational Pharmacy Week events in November.',
  },
  {
    logo: 'PARKINSON DISEASE SUPPORT GROUP.png', name: 'Parkinson Disease Support', category: 'academic',
    color: '#635BFF', coordinator: 'Dr. Sunita Kumar', foundedYear: '2020', memberCount: 31, eventCount: 2,
    description: 'This club raises awareness about Parkinson\'s disease and supports patients and caregivers in the Rajkot community. Members organise support groups, physiotherapy awareness sessions, and fundraising events.',
    tags: ["Parkinson's", 'Neurology', 'Patient Support', 'Awareness', 'Community Health'],
    vision: 'To reduce the isolation of Parkinson\'s patients and build a compassionate community network of care and support.',
    rules: [
      'Approach patients and caregivers with empathy and respect.',
      'Never share patient information without consent.',
      'Follow all clinical visit protocols supervised by faculty.',
      'Speak only within your knowledge — refer clinical questions to professionals.',
      'Commit to regular support-group attendance.',
    ],
    schedule: 'Support group visits: one Saturday per month at partnered care centres.\nAwareness workshops: last Thursday of each month, 5:00 PM – 7:00 PM.\nFundraising events: twice yearly.',
  },
  {
    logo: 'RAJKOT KNEE CLUB.png', name: 'Rajkot Knee Club', category: 'academic',
    color: '#FF6B9D', coordinator: 'Dr. Anil Mehta', foundedYear: '2021', memberCount: 28, eventCount: 2,
    description: 'The Rajkot Knee Club focuses on orthopaedic health and knee rehabilitation. Run by physiotherapy and sports medicine students, the club offers free movement assessments, rehabilitation workshops, and injury-prevention programmes.',
    tags: ['Orthopaedics', 'Physiotherapy', 'Rehabilitation', 'Sports Medicine', 'Injury Prevention'],
    vision: 'To improve musculoskeletal health literacy across the campus and Rajkot community.',
    rules: [
      'Always work under qualified supervision during clinical activities.',
      'Obtain informed consent before any physical assessment.',
      'Use only evidence-based physiotherapy techniques.',
      'Refer complex cases to qualified practitioners.',
      'Maintain professional standards during all patient interactions.',
    ],
    schedule: 'Clinic sessions: Saturday mornings, 9:00 AM – 12:00 PM in the Physiotherapy lab.\nMovement workshops: bi-weekly, Wednesday 5:00 PM – 6:30 PM.\nOutreach camps: quarterly in local communities.',
  },
  {
    logo: 'MICROBIOLOGIST CLUB.png', name: 'Microbiologist Club', category: 'academic',
    color: '#635BFF', coordinator: 'Prof. Kavitha Bose', foundedYear: '2019', memberCount: 43, eventCount: 2,
    description: 'The Microbiologist Club explores the microscopic world. Members conduct experiments in microbiology, virology, and immunology labs — and run public education drives on antibiotic resistance, sanitation, and infectious disease prevention.',
    tags: ['Microbiology', 'Laboratory', 'Virology', 'Immunology', 'Public Health'],
    vision: 'To create scientifically literate citizens who understand how microorganisms shape our health and environment.',
    rules: [
      'Follow all lab safety protocols and biosafety levels.',
      'Sterilise and dispose of biological materials properly.',
      'Never handle cultures outside designated containment areas.',
      'Document all experiments accurately.',
      'Communicate only verified scientific information in outreach.',
    ],
    schedule: 'Lab sessions: Tuesday & Thursday, 3:00 PM – 5:30 PM in Microbiology Lab.\nPublic education drive: one weekend per month.\nAnnual Microbiology Olympiad in September.',
  },
  {
    logo: 'MEDICINAL PLANTS CLUB.png', name: 'Medicinal Plants Club', category: 'academic',
    color: '#00C896', coordinator: 'Prof. Sneha Rao', foundedYear: '2020', memberCount: 38, eventCount: 2,
    description: 'The Medicinal Plants Club studies the therapeutic properties of plants. Members maintain a campus herbal garden, conduct ethnobotanical research, and educate the community on traditional and modern phytotherapy.',
    tags: ['Herbal Medicine', 'Botany', 'Ethnobotany', 'Ayurveda', 'Plant Science'],
    vision: 'To revive indigenous plant knowledge and scientifically validate the medicinal plants of India\'s traditional healing systems.',
    rules: [
      'Identify plants correctly before any use or documentation.',
      'Obtain permissions before collecting plant samples from protected areas.',
      'Record all ethnobotanical information accurately.',
      'Never recommend plant remedies without professional guidance.',
      'Maintain the campus herbal garden responsibly.',
    ],
    schedule: 'Garden maintenance: Monday & Friday, 7:00 AM – 8:00 AM.\nResearch sessions: Wednesday, 4:00 PM – 6:00 PM.\nHerbal Walk with experts: first Saturday of each month.',
  },
  {
    logo: 'AYUSHAMRIT.png', name: 'Ayushamrit Club', category: 'academic',
    color: '#4B6E2E', coordinator: 'Dr. Vijay Pillai', foundedYear: '2021', memberCount: 35, eventCount: 2,
    description: 'Ayushamrit promotes Ayurvedic sciences and holistic wellness. Members study ancient Ayurvedic texts, conduct wellness workshops on dinacharya (daily routine), and run Panchkarma awareness drives.',
    tags: ['Ayurveda', 'Holistic Health', 'Wellness', 'Yoga', 'Traditional Medicine'],
    vision: 'To integrate Ayurvedic wisdom with modern healthcare to offer students a complete system of wellbeing.',
    rules: [
      'Respect the ancient knowledge systems with academic rigour.',
      'Never prescribe Ayurvedic treatment without qualified oversight.',
      'Maintain personal wellness practices as part of club membership.',
      'Document research and case studies carefully.',
      'Approach traditional practices with cultural sensitivity.',
    ],
    schedule: 'Wellness sessions: Tuesday & Thursday, 6:30 AM – 7:30 AM (yoga & pranayama).\nSeminar series: last Saturday of each month, 10:00 AM – 12:00 PM.\nAnnual Ayurveda Awareness Week in February.',
  },

  /* ── Community ────────────────────────────────────────────────────────────── */
  {
    logo: 'GSG Club Logo.png', name: 'GSG Club', category: 'academic',
    color: '#4B6E2E', coordinator: 'Lt. Col. V. Desai', foundedYear: '2010', memberCount: 120, eventCount: 6,
    description: 'GSG Club is RKU\'s national service and community leadership club, guided by military professionals. Members undergo leadership training, community service projects, and disaster-preparedness programmes.',
    tags: ['Service', 'Leadership', 'Community', 'Discipline', 'National Service'],
    vision: 'To cultivate disciplined, service-oriented leaders who contribute meaningfully to their communities and nation.',
    rules: [
      'Maintain discipline and punctuality at all times.',
      'Complete all assigned community service hours.',
      'Wear the club uniform correctly at official events.',
      'Maintain physical fitness standards.',
      'Show respect to all community members served.',
    ],
    schedule: 'Weekly drill and training: Saturday, 7:00 AM – 9:00 AM on the parade ground.\nCommunity service drives: one Sunday per month.\nAnnual Leadership Camp: April.',
  },
  {
    logo: 'SAPIENS THE HR CLUB.png', name: 'Sapiens — The HR Club', category: 'academic',
    color: '#A259FF', coordinator: 'Prof. Aditi Sharma', foundedYear: '2019', memberCount: 57, eventCount: 3,
    description: 'Sapiens is RKU\'s Human Resources and management club. Through mock HR simulations, case competitions, industrial visits, and talks by HR professionals, the club prepares students for careers in people management.',
    tags: ['HR', 'Management', 'Recruitment', 'Organisation Behaviour', 'Career'],
    vision: 'To develop emotionally intelligent, people-first leaders who drive organisational excellence.',
    rules: [
      'Maintain confidentiality in all HR simulation exercises.',
      'Approach diversity and inclusion discussions with respect.',
      'Complete all assigned case studies before group sessions.',
      'Build professional networks ethically.',
      'Apply HR principles in all club leadership decisions.',
    ],
    schedule: 'Sessions: Tuesday & Thursday, 5:00 PM – 7:00 PM.\nIndustrial visit: once per semester.\nAnnual HR Summit: January.',
  },
  {
    logo: 'UNITE.png', name: 'Unite Club', category: 'academic',
    color: '#FF6B9D', coordinator: 'Dr. Priya Menon', foundedYear: '2020', memberCount: 49, eventCount: 3,
    description: 'Unite Club works to bridge gaps — between departments, between senior and junior students, and between RKU and the local community. Through social events, buddy programmes, and intercultural exchanges, Unite builds belonging.',
    tags: ['Community Building', 'Inclusion', 'Social Events', 'Cultural Exchange', 'Networking'],
    vision: 'To create a campus where every student feels seen, included, and connected.',
    rules: [
      'Create safe, inclusive spaces in all club events.',
      'Never discriminate on the basis of background, gender, or belief.',
      'Respect diverse perspectives and experiences.',
      'Be proactive in welcoming new students.',
      'Commit to at least one community initiative per semester.',
    ],
    schedule: 'Community events: bi-weekly, Saturday afternoons.\nBuddy programme orientation: start of each semester.\nAnnual Unity Festival: March.',
  },
  {
    logo: 'SETU - MUN.png', name: 'SETU — MUN', category: 'academic',
    color: '#635BFF', coordinator: 'Prof. Sanjay Ghosh', foundedYear: '2018', memberCount: 66, eventCount: 4,
    description: 'SETU is RKU\'s Model United Nations club. Members debate global issues, develop diplomatic skills, and represent countries in simulated UN committees — preparing for national and international MUN conferences.',
    tags: ['MUN', 'Diplomacy', 'Global Affairs', 'Debate', 'Public Speaking'],
    vision: 'To develop globally aware, articulate diplomats who can navigate complex international issues with confidence and nuance.',
    rules: [
      "Research your assigned country's position thoroughly.",
      'Follow Rules of Procedure in all committee sessions.',
      'Maintain diplomatic decorum — no personal attacks.',
      'Submit position papers by the deadline.',
      'Support first-time delegates in learning the MUN process.',
    ],
    schedule: 'Training sessions: Monday & Wednesday, 5:00 PM – 7:00 PM.\nInternal MUN simulation: monthly.\nExternal MUN conferences: 3–4 per year.',
  },
  {
    logo: 'WOMEN WONDERS.png', name: 'Women Wonders', category: 'academic',
    color: '#FF6B9D', coordinator: 'Dr. Rekha Iyer', foundedYear: '2017', memberCount: 74, eventCount: 4,
    description: "Women Wonders is RKU's women's empowerment club. Through workshops on self-defence, financial literacy, leadership, and mental health, the club supports women students in reaching their full potential.",
    tags: ['Women Empowerment', 'Leadership', 'Mental Health', 'Self-Defence', 'Finance'],
    vision: 'To create a campus where women thrive — empowered, supported, and celebrated in every field.',
    rules: [
      'Create a safe, judgment-free space for all members.',
      'Maintain absolute confidentiality in personal sharing sessions.',
      "Respect every woman's own journey and choices.",
      'Be an ally — include and support all members.',
      'Attend events with intentionality and full participation.',
    ],
    schedule: "Weekly circles: Thursday, 5:00 PM – 7:00 PM.\nWorkshops: bi-weekly Saturday sessions on various topics.\nAnnual Women's Day event: 8th March.",
  },
  {
    logo: 'KNOW YOUR FINANCE.png', name: 'Know Your Finance', category: 'academic',
    color: '#FF9500', coordinator: 'Dr. Rohan Shah', foundedYear: '2017', memberCount: 66, eventCount: 4,
    description: 'Know Your Finance demystifies personal finance for students. Through workshops on budgeting, investment basics, stock markets, insurance, and fintech, KYF equips students to make informed financial decisions.',
    tags: ['Finance', 'Investment', 'Stock Market', 'Personal Finance', 'Fintech'],
    vision: 'To build a generation of financially literate students who control their financial futures with confidence.',
    rules: [
      'Share only verified financial information — no speculation as advice.',
      'Respect diverse financial backgrounds among members.',
      'Maintain objectivity in investment discussions.',
      'Keep any shared personal financial information confidential.',
      'Practice what you teach — members lead by example.',
    ],
    schedule: 'Weekly seminars: Wednesday, 5:00 PM – 7:00 PM.\nStock market simulation: runs throughout the semester.\nAnnual finance fair: December.',
  },
  {
    logo: 'MATHEMAGICIANS.png', name: 'Mathemagicians', category: 'academic',
    color: '#635BFF', coordinator: 'Prof. Anika Joshi', foundedYear: '2018', memberCount: 52, eventCount: 3,
    description: 'Mathemagicians makes mathematics fun, competitive, and community-building. From olympiad training and puzzle-solving sessions to math outreach in local schools, the club proves that everyone is a mathematician.',
    tags: ['Mathematics', 'Olympiad', 'Problem Solving', 'Competitive Math', 'Education'],
    vision: 'To eliminate math anxiety and replace it with a lifelong love of mathematical thinking and problem-solving.',
    rules: [
      'Approach every problem with curiosity, not fear.',
      'Share solution approaches, not just answers.',
      'Be patient with members at different skill levels.',
      'Maintain an intellectual but inclusive environment.',
      'Contribute to the problem bank every semester.',
    ],
    schedule: 'Problem-solving sessions: Tuesday & Thursday, 5:00 PM – 7:00 PM.\nOlympiad prep: Saturday mornings, 10:00 AM – 12:00 PM.\nMath Olympiad (internal): each semester; external competitions as announced.',
  },
  {
    logo: 'THE KING OF 64.png', name: 'The King of 64 — Chess', category: 'sports',
    color: '#9CA3AF', coordinator: 'Prof. Mohan Rao', foundedYear: '2014', memberCount: 48, eventCount: 3,
    description: 'The King of 64 is RKU\'s chess club. Members develop strategic thinking through regular tournaments, grandmaster game analysis, and online rated play — competing in inter-university and national chess championships.',
    tags: ['Chess', 'Strategy', 'Competition', 'Tournaments', 'Critical Thinking'],
    vision: 'To develop strategic thinkers who approach every challenge — on and off the board — with patience, foresight, and precision.',
    rules: [
      'Follow FIDE rules in all rated games.',
      'Maintain silence and good sportsmanship during matches.',
      'Analyse your losses — every defeat is a lesson.',
      'Show respect to all opponents regardless of their rating.',
      "Contribute game analysis to the club's shared study database.",
    ],
    schedule: 'Practice sessions: Monday, Wednesday, Friday — 5:00 PM – 7:00 PM in the Reading Room.\nInternal tournament: every Sunday, 3:00 PM – 6:00 PM.\nExternal tournaments and inter-university events as per schedule.',
  },
];

const EVENTS = [
  { title: 'Galore 2027 — Annual Mega Fest', club: 'SOAC · RK University',   category: 'annual-fest', status: 'upcoming', date: 'Feb 2–8, 2027',   startDate: new Date('2027-02-02'), time: '9:00 AM onwards', venue: 'RKU Main Campus',      description: '7-day inter-college festival with 40+ clubs, 1,400+ participants. Music, dance, sports, tech, and cultural competitions under one roof.', tags: ['Mega Fest','7 Days','All Clubs'], seats: 'Open Registration', image: 'i20.png' },
  { title: 'RKU Sports Fiesta 2026',         club: 'Sports Division · SOAC', category: 'sports',      status: 'upcoming', date: 'Nov 14–17, 2026', startDate: new Date('2026-11-14'), time: '8:00 AM',          venue: 'RKU Sports Ground',    description: 'Four-day multi-sport championship featuring cricket, football, badminton, volleyball, kabaddi, and athletics.', tags: ['Sports','4 Days','Inter-College'], seats: '240 seats left', image: 'asset-6.png' },
  { title: 'Rhythm & Soul — Music Night',    club: 'Soul of Music · SOAC',   category: 'cultural',    status: 'upcoming', date: 'Oct 4, 2026',     startDate: new Date('2026-10-04'), time: '6:30 PM',          venue: 'Amphitheatre, RKU',    description: 'An acoustic evening with live performances by the Soul of Music club — solos, bands, and surprise guests.', tags: ['Music','Live','Cultural'], seats: '180 seats left', image: 'asset-8.png' },
  { title: 'Code Sprint — 24-Hour Hackathon',club: 'Change Makers E-Cell',   category: 'academic',        status: 'upcoming', date: 'Sep 20–21, 2026', startDate: new Date('2026-09-20'), time: '10:00 AM (24hr)',  venue: 'CS Lab Block, RKU',    description: 'Build real solutions in 24 hours. Open to all RKU students. Prizes worth ₹1 Lakh. Food and mentors provided.', tags: ['Hackathon','Tech','24hr'], seats: '120 seats left', image: 'i23.png' },
  { title: 'Galore 2026 — Annual Mega Fest', club: 'SOAC · RK University',   category: 'annual-fest', status: 'past',     date: 'Feb 3–9, 2026',   startDate: new Date('2026-02-03'), time: '9:00 AM onwards', venue: 'RKU Main Campus',      description: '7-day mega fest — over 1,200 participants across 40 clubs. Featured headline performances, hackathons, and sports finals.', tags: ['Mega Fest','Annual'], seats: '', highlight: '🏆 Best Edition Yet — 1,200+ Students', image: 'i20.png' },
  { title: 'Guard of Honour — Galore 2026',  club: 'NCC Wing · SOAC',        category: 'cultural',    status: 'past',     date: 'Feb 3, 2026',     startDate: new Date('2026-02-03'), time: '10:00 AM',         venue: 'Main Auditorium, RKU', description: 'NCC cadets led the ceremonial guard of honour for the Galore 2026 inaugural ceremony — a proud tradition of discipline and service.', tags: ['Ceremony','NCC'], seats: '', image: 'i15.png' },
];

const autoSeed = async () => {
  try {
    await ensureSoacTables();

    /* ── Create seed_exclusions table (tracks admin-deleted clubs so they
          are never re-seeded on future deployments) ───────────────────── */
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS seed_exclusions (
        slug        TEXT PRIMARY KEY,
        deleted_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    /* ── Migrate existing clubs to 4-category system ─────────────────────── */
    await pgPool.query(`
      UPDATE clubs SET category = 'academic'
      WHERE category IN ('tech', 'health');
    `);
    await pgPool.query(`
      UPDATE clubs SET category = 'academic'
      WHERE category = 'community'
        AND name != 'The King of 64 — Chess';
    `);
    await pgPool.query(`
      UPDATE clubs SET category = 'sports'
      WHERE name = 'The King of 64 — Chess';
    `);
    await pgPool.query(`
      UPDATE clubs SET category = 'social'
      WHERE name = 'SHWET — Rise of Humanity';
    `);
    await pgPool.query(`
      UPDATE clubs SET category = 'academic'
      WHERE category = 'cultural'
        AND name NOT IN ('Bumblebeez', 'Soul of Music', 'Kalaraw Club', 'Pictza Club');
    `);

    /* ── Load excluded slugs once ────────────────────────────────────────── */
    const { rows: excludedRows } = await pgPool.query('SELECT slug FROM seed_exclusions');
    const excludedSlugs = new Set(excludedRows.map(r => r.slug));

    /* ── Upsert all clubs with rich data ─────────────────────────────────── */
    let upserted = 0;
    let skipped  = 0;
    let failed   = 0;
    for (const c of CLUBS) {
      try {
        const slug = slugify(c.name, { lower: true, strict: true });

        /* Skip clubs the admin deliberately deleted */
        if (excludedSlugs.has(slug)) {
          skipped++;
          continue;
        }

        await pgPool.query(
          `INSERT INTO clubs
             (name, slug, category, color, coordinator, founded_year,
              member_count, event_count, logo,
              description, tags, vision, rules, schedule, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
           ON CONFLICT (slug) DO UPDATE SET
             is_active    = true,
             category     = EXCLUDED.category,
             color        = COALESCE(NULLIF(clubs.color, ''),        EXCLUDED.color),
             logo         = COALESCE(NULLIF(clubs.logo, ''),         EXCLUDED.logo),
             coordinator  = COALESCE(NULLIF(clubs.coordinator, ''),  EXCLUDED.coordinator),
             founded_year = COALESCE(NULLIF(clubs.founded_year, ''), EXCLUDED.founded_year),
             event_count  = CASE WHEN clubs.event_count = 0 THEN EXCLUDED.event_count ELSE clubs.event_count END,
             description  = CASE WHEN clubs.description = '' OR clubs.description IS NULL
                                 THEN EXCLUDED.description ELSE clubs.description END,
             tags         = CASE WHEN clubs.tags = '{}' OR clubs.tags IS NULL
                                 THEN EXCLUDED.tags ELSE clubs.tags END,
             vision       = CASE WHEN clubs.vision = '' OR clubs.vision IS NULL
                                 THEN EXCLUDED.vision ELSE clubs.vision END,
             rules        = CASE WHEN clubs.rules = '{}' OR clubs.rules IS NULL
                                 THEN EXCLUDED.rules ELSE clubs.rules END,
             schedule     = CASE WHEN clubs.schedule = '' OR clubs.schedule IS NULL
                                 THEN EXCLUDED.schedule ELSE clubs.schedule END,
             updated_at   = NOW()`,
          [
            c.name, slug, c.category, c.color,
            c.coordinator || '', c.foundedYear || '',
            Number(c.memberCount) || 0, Number(c.eventCount) || 0,
            c.logo || '',
            c.description || '', c.tags || [], c.vision || '',
            c.rules || [], c.schedule || '',
          ]
        );
        upserted++;
      } catch (clubErr) {
        failed++;
        console.warn(`⚠️  Failed to upsert club "${c.name}": ${clubErr.message}`);
      }
    }
    console.log(`✅  Club upsert complete (${upserted} upserted, ${skipped} excluded by admin, ${failed} failed)`);

    /* ── Seed events only on first run ───────────────────────────────────── */
    const { rows: [{ count: eventCount }] } = await pgPool.query(
      'SELECT COUNT(*)::int AS count FROM events'
    );
    if (Number(eventCount) === 0) {
      for (const e of EVENTS) {
        await pgPool.query(
          `INSERT INTO events
           (title, club, category, status, date, start_date, time, venue,
            description, tags, seats, highlight, image)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            e.title, e.club || '', e.category || 'general',
            e.status || 'upcoming', e.date || '',
            e.startDate || null, e.time || '', e.venue || '',
            e.description || '', e.tags || [],
            e.seats || '', e.highlight || '', e.image || '',
          ]
        );
      }
      console.log(`✅  Auto-seeded ${EVENTS.length} events`);
    } else {
      console.log(`ℹ️   Events already seeded (${eventCount} found)`);
    }
  } catch (err) {
    console.warn('⚠️  Auto-seed failed (non-fatal):', err.message);
  }
};

module.exports = autoSeed;
