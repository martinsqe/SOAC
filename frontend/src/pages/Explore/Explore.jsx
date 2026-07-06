import s from './Explore.module.css';

const PHOTOS = [
  { url: '/images/i20.png',       label: 'Galore 2026 — Annual Mega Fest',                  h: 420 },
  { url: '/images/img6.png',      label: 'Girls Basketball Final',                           h: 160 },
  { url: '/images/i12.png',       label: 'Garba & Classical Fusion — Galore 2026',           h: 520 },
  { url: '/images/asset-1.png',   label: 'Classical Dance Performance — Galore 2024',        h: 290 },
  { url: '/images/i14.png',       label: 'Inter-Department Football',                        h: 120 },
  { url: '/images/asset-2.png',   label: 'Galore 2025 — Official Event Poster',              h: 430 },
  { url: '/images/img4.png',      label: 'Basketball Championship',                          h: 340 },
  { url: '/images/asset-5.png',   label: 'Echoes of Independence — Dance Tribute, Aug 2024', h: 200 },
  { url: '/images/i15.png',       label: 'NCC Guard of Honour',                             h: 200 },
  { url: '/images/img8.png',      label: 'Cricket League — 300+ Spectators',                h: 460 },
  { url: '/images/asset-7.png',   label: 'Mime Theatre — Indoor Cultural Performance',       h: 350 },
  { url: '/images/i18.png',       label: 'Galore 2026 Inauguration',                        h: 140 },
  { url: '/images/i21.png',       label: 'Rangoli Championship',                            h: 300 },
  { url: '/images/asset-8.png',   label: 'Live Music — Vocals & Guitar at RKU',             h: 130 },
  { url: '/images/img7.png',      label: 'Chess — Three Members in Top 5',                  h: 500 },
  { url: '/images/asset-9.png',   label: 'NCC Cadets — Group Photo at RK University',       h: 460 },
  { url: '/images/asset-6.png',   label: 'Volleyball — Sports Fiesta \'25',                 h: 180 },
  { url: '/images/asset-10.png',  label: 'Student Entrepreneurship Exhibition',              h: 220 },
  { url: '/images/i24.png',       label: 'Table Tennis Championship',                       h: 380 },
  { url: '/images/asset-11.png',  label: 'Mime Theatre — Galore Stage Performance',          h: 380 },
  { url: '/images/i9.png',        label: 'Campus Life — SOAC Events',                       h: 130 },
  { url: '/images/asset-14.png',  label: 'NCC Cadet Badge Presentation Ceremony',           h: 260 },
  { url: '/images/asset-32.jpeg', label: 'Inter-Department Football Match',                  h: 440 },
  { url: '/images/img3.png',      label: 'Art & Imagination Exhibition',                     h: 220 },
  { url: '/images/i13.png',       label: 'Student Activities',                              h: 540 },
  { url: '/images/asset-17.png',  label: 'Volleyball Spike — Sports Fiesta \'25',           h: 330 },
  { url: '/images/img5.png',    label: 'Basketball Layup — RKU Outdoor Court',            h: 455 },
  { url: '/images/asset-35.jpeg', label: 'Chess — Sports Fiesta \'25',                      h: 150 },
  { url: '/images/asset-18.png',  label: 'Kite Festival 2026 — Official Poster',            h: 120 },
  { url: '/images/asset-30.jpeg', label: 'Table Tennis — Sports Fiesta \'25',               h: 320 },
  { url: '/images/asset-21.png',  label: 'Echoes of Independence — Ribbon Dance',           h: 360 },
  { url: '/images/asset-28.jpeg', label: 'Garba Group Performance — Traditional Folk Dance', h: 110 },
  { url: '/images/i19.png',       label: 'SOAC — Building Leaders',                         h: 480 },
  { url: '/images/asset-29.jpeg', label: 'Cricket Match — RKU Ground',                      h: 320 },
  { url: '/images/img2.png',      label: 'Artistry Competition — Galore 2026',              h: 240 },
  { url: '/images/asset-33.jpeg', label: 'Girls Basketball — Drive to the Basket',          h: 175 },
  { url: '/images/asset-40.jpeg', label: 'Holi Celebration 2024 — RK University',           h: 190 },
  { url: '/images/asset-43.jpeg', label: 'Student Performer at SOAC Stage',                 h: 390 },
  { url: '/images/i10.png',       label: 'Galore 2026 — Team Spirit on Stage',              h: 245 },
  { url: '/images/i11.png',       label: 'Classical Devotional Dance — Galore 2026',        h: 420 },
  { url: '/images/i16.png',       label: 'Galore 2026 Inauguration — Faculty Address',      h: 160 },
  { url: '/images/i17.png',       label: 'Sports Inauguration — NCC Flag March',            h: 360 },
  { url: '/images/i22.png',       label: 'Rangoli Art — Colored Powder Work in Progress',   h: 130 },
  { url: '/images/i23.png',       label: 'Live Singing Performance — RKU Cultural Event',   h: 310 },
];

export default function Explore() {
  return (
    <div className={s.page}>

      <div className="wrap" style={{ padding: '120px 0 80px' }}>

        <div className={s.header}>
          <h1 className={s.title}>Campus Life outside academics.</h1>
          <p className={s.sub}>
            Explore the vibrant activities, events and achievements of our clubs at RK University.
            Capturing moments that define student life.
          </p>
        </div>

        <div className={s.grid}>
          {PHOTOS.map((img, i) => (
            <div key={i} className={s.card} style={{ height: img.h }}>
              <img src={img.url} alt={img.label} className={s.img} loading="lazy" />
              <div className={s.label}>{img.label}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
