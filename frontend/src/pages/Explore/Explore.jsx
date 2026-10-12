import { useEffect, useRef, useState } from 'react';
import s from './Explore.module.css';

// ar: the photo's own width ÷ height — every photo is shown at exactly this shape,
//     so it appears whole, just as it looks when opened from the folder
const PHOTOS = [
  /* ── Latest photos at the top: sports, dance, chess and table tennis mixed.
     Spans picked from each photo's shape so the 14 fill a complete 4-column block. ── */
  { url: '/g7.png', ar: 1.235,  label: 'Classical Dance at the Ganesh Utsav Pandal', span: 'big' },
  { url: '/f.png', ar: 1.250,   label: 'Chess — Friendly Match' },
  { url: '/g3.png', ar: 1.237,  label: 'Ganesh Aarti with Faculty and Students', span: 'big' },
  { url: '/i.png', ar: 1.817,   label: 'Pharmaspectrum 2026 — Group Dance on Stage', span: 'wide' },
  { url: '/k.png', ar: 1.737,   label: "Girls' Volleyball Team with Coaches", span: 'big' },
  { url: '/g1.png', ar: 1.472,  label: 'Ganesh Idol Welcome Procession' },
  { url: '/g2.png', ar: 1.798,  label: 'Students Cheering at the Ganesh Procession', span: 'wide' },
  { url: '/g4.png', ar: 1.072,  label: 'Traditional Dance Pose — Ganesh Utsav', span: 'tall' },
  { url: '/f4.png', ar: 1.766,  label: 'Carrom Match — Inter-Department Games', span: 'big' },
  { url: '/g6.png', ar: 1.746,  label: 'Ganesh Puja — Students in Traditional Attire' },
  { url: '/f2.png', ar: 1.771,  label: 'Table Tennis Doubles Match' },
  { url: '/g5.png', ar: 1.887,  label: 'Group Folk Dance on Campus', span: 'wide' },
  { url: '/f3.png', ar: 1.242,  label: 'Chess — Focused Move at the Board', span: 'tall' },
  { url: '/f1.png', ar: 1.242,  label: 'Table Tennis — Forehand Return', span: 'tall' },

  { url: '/soefront.png', ar: 1.486,         label: 'Garba in Front of SOE — Jagannath Rath Yatra 2026', span: 'big' },
  { url: '/images/i20.png', ar: 1.514,       label: 'Galore 2026 — Annual Mega Fest', span: 'tall' },
  { url: '/rolem6.png', ar: 2.149,           label: 'Role Model Series 2025 — Guest Conversation', span: 'wide' },
  { url: '/images/img6.png', ar: 1.504,      label: 'Girls Basketball Final' },
  { url: '/images/i12.png', ar: 1.533,       label: 'Garba & Classical Fusion — Galore 2026', span: 'big' },
  { url: '/images/asset-1.png', ar: 1.308,   label: 'Classical Dance Performance — Galore 2024' },
  { url: '/images/i14.png', ar: 1.415,       label: 'Inter-Department Football' },
  { url: '/rolem2.png', ar: 2.253,           label: 'Role Model Series 2025 — Folk Dance Performance', span: 'wide' },
  { url: '/rath.png', ar: 0.657,             label: 'SOAC — Jagannath Rath Yatra 2026', span: 'tall' },
  { url: '/images/img4.png', ar: 1.494,      label: 'Basketball Championship', span: 'tall' },
  { url: '/path.png', ar: 1.513,             label: 'Jagannath Rath Yatra 2026 — Procession Across Campus', span: 'big' },
  { url: '/Rasotsav2.png', ar: 1.444,        label: 'Rasotsav — Men in Traditional Garba Attire', span: 'big' },
  { url: '/images/asset-5.png', ar: 1.086,   label: 'Echoes of Independence — Dance Tribute, Aug 2024', span: 'wide' },
  { url: '/images/i15.png', ar: 1.483,       label: 'NCC Guard of Honour', span: 'tall' },
  { url: '/astha.png', ar: 1.491,            label: "SOAC Volunteers' President Adressing audience", span: 'big' },
  { url: '/images/img8.png', ar: 1.507,      label: 'Cricket League — 300+ Spectators', span: 'wide' },
  { url: '/images/asset-7.png', ar: 1.035,   label: 'Mime Theatre — Indoor Cultural Performance', span: 'big' },
  { url: '/images/i18.png', ar: 1.513,       label: 'Galore 2026 Inauguration' },
  { url: '/images/i21.png', ar: 1.509,       label: 'Rangoli Championship', span: 'tall' },
  { url: '/images/asset-8.png', ar: 0.923,   label: 'Live Music — Vocals & Guitar at RKU' },
  { url: '/images/img7.png', ar: 1.492,      label: 'Chess — Three Members in Top 5' },
  { url: '/images/asset-9.png', ar: 1.132,   label: 'NCC Cadets — Group Photo at RK University', span: 'wide' },
  { url: '/images/asset-6.png', ar: 1.484,   label: "Volleyball — Sports Fiesta '25" },
  { url: '/Rasotsav3.png', ar: 1.494,        label: 'Rasotsav — Women Dancing Under Fairy Lights', span: 'big' },
  { url: '/rolem4.png', ar: 1.520,           label: 'Role Model Series 2025 — Packed Auditorium', span: 'big' },
  { url: '/images/asset-10.png', ar: 1.363,  label: 'Student Entrepreneurship Exhibition' },
  { url: '/images/i24.png', ar: 1.494,       label: 'Table Tennis Championship', span: 'tall' },
  { url: '/images/asset-11.png', ar: 1.370,  label: 'Mime Theatre — Galore Stage Performance' },
  { url: '/images/i9.png', ar: 1.478,        label: 'Campus Life — SOAC Events' },
  { url: '/rath1.png', ar: 0.860,            label: 'Jagannath Rath Yatra 2026 — The Rath', span: 'tall' },
  { url: '/images/asset-32.jpeg', ar: 1.333, label: 'Inter-Department Football Match', span: 'wide' },
  { url: '/images/img3.png', ar: 1.523,      label: 'Art & Imagination Exhibition' },
  { url: '/Rasotsav1.png', ar: 1.783,        label: 'Rasotsav — Aerial View of RKU Garba Night', span: 'big' },
  { url: '/rolem5.png', ar: 1.956,           label: 'Role Model Series 2025 — Inspiring Students', span: 'wide' },
  { url: '/images/i13.png', ar: 1.380,       label: 'Student Activities', span: 'tall' },
  { url: '/images/asset-17.png', ar: 1.484,  label: "Volleyball Spike — Sports Fiesta '25", span: 'wide' },
  { url: '/images/img5.png', ar: 1.451,      label: 'Basketball Layup — RKU Outdoor Court' },
  { url: '/images/asset-35.jpeg', ar: 1.333, label: "Chess — Sports Fiesta '25" },
  { url: '/images/asset-18.png', ar: 0.758,  label: 'Kite Festival 2026 — Official Poster' },
  { url: '/images/asset-30.jpeg', ar: 1.333, label: "Table Tennis — Sports Fiesta '25" },
  { url: '/images/asset-21.png', ar: 1.218,  label: 'Echoes of Independence — Ribbon Dance', span: 'tall' },
  { url: '/images/asset-28.jpeg', ar: 1.333, label: 'Garba Group Performance — Traditional Folk Dance', span: 'big' },
  { url: '/images/i19.png', ar: 1.475,       label: 'SOAC — Galore Inauguration', span: 'tall' },
  { url: '/images/asset-29.jpeg', ar: 1.333, label: 'Cricket Match — RKU Ground', span: 'tall' },
  { url: '/images/img2.png', ar: 1.501,      label: 'Artistry Competition — Galore 2026' },
  { url: '/images/asset-33.jpeg', ar: 1.333, label: 'Girls Basketball — Drive to the Basket' },
  { url: '/images/asset-40.jpeg', ar: 1.333, label: 'Holi Celebration 2024 — RK University' },
  { url: '/images/asset-43.jpeg', ar: 1.333, label: 'Student Performer at SOAC Stage', span: 'tall' },
  { url: '/images/i10.png', ar: 1.276,       label: 'Galore 2026 — Team Spirit on Stage' },
  { url: '/images/i11.png', ar: 1.483,       label: 'Classical Devotional Dance — Galore 2026', span: 'big' },
  { url: '/images/i16.png', ar: 1.514,       label: 'Galore 2026 Inauguration — Faculty Address' },
  { url: '/images/i17.png', ar: 1.503,       label: 'Sports Inauguration — NCC Flag March', span: 'wide' },
  { url: '/images/i22.png', ar: 1.485,       label: 'Rangoli Art — Colored Powder Work in Progress' },
  { url: '/images/i23.png', ar: 1.472,       label: 'Live Singing Performance — RKU Cultural Event' },
];

/* ── Justified collage (like Google Photos): photos are laid out in rows; every
   photo in a row is scaled to the same height so the row fills the width exactly.
   Each photo keeps its own shape (nothing cropped) and there is no white space —
   rows with fewer photos come out taller/bigger, rows with more come out shorter. ── */

/* Older photos re-mixed so each row blends subjects (the newest photos stay first) */
const THEMES = [
  ['sports', /basketball|football|cricket|volleyball|table tennis|chess|carrom|sports|ncc|flag|guard/i],
  ['dance',  /dance|garba|rasotsav|classical|folk|ribbon/i],
  ['stage',  /role model|music|singing|performer|mime|theatre|auditorium|address|president/i],
];
const themeOf = (p) => (THEMES.find(([, re]) => re.test(p.label)) || ['culture'])[0];
const mixThemes = (list) => {
  const buckets = {};
  list.forEach(p => { (buckets[themeOf(p)] ||= []).push(p); });
  const keys = Object.keys(buckets);
  const out = [];
  while (out.length < list.length) keys.forEach(k => { if (buckets[k].length) out.push(buckets[k].shift()); });
  return out;
};
const NEW_COUNT = 14;
const ORDERED = [...PHOTOS.slice(0, NEW_COUNT), ...mixThemes(PHOTOS.slice(NEW_COUNT))];

/* Splits the photos (in order) into `k` rows whose widths are as even as possible
   (classic linear partition), so every row — the last one too — is full. */
function partition(ars, k) {
  const n = ars.length;
  k = Math.max(1, Math.min(k, n));
  const pre = [0];
  ars.forEach(a => pre.push(pre[pre.length - 1] + a));
  const ideal = pre[n] / k;
  const cost = (i, j) => { const w = pre[j] - pre[i]; return (w - ideal) * (w - ideal); }; // photos i..j-1
  const best = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut  = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
  best[0][0] = 0;
  for (let r = 1; r <= k; r++) {
    for (let j = r; j <= n; j++) {
      for (let i = r - 1; i < j; i++) {
        const v = best[r - 1][i] + cost(i, j);
        if (v < best[r][j]) { best[r][j] = v; cut[r][j] = i; }
      }
    }
  }
  const rows = [];
  let j = n;
  for (let r = k; r >= 1; r--) { const i = cut[r][j]; rows.unshift([i, j]); j = i; }
  return rows;
}

/* Target row height for the screen width — big rows on desktop, smaller on phones */
const targetRowHeight = (w) => (w > 1100 ? 300 : w > 720 ? 240 : 170);

export default function Explore() {
  const boxRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.floor(e.contentRect.width);
      setWidth(prev => (Math.abs(prev - w) < 8 ? prev : w)); // ignore tiny changes (scrollbars)
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = width || (typeof window !== 'undefined' ? Math.min(window.innerWidth, 1200) : 1200);
  const ars = ORDERED.map(p => p.ar || 1.5);
  const total = ars.reduce((a, b) => a + b, 0);
  const rowCount = Math.max(1, Math.round((total * targetRowHeight(w)) / w));
  const rows = partition(ars, rowCount);

  return (
    <div className={s.page}>
      <div className="wrap" style={{ padding: '120px 0 80px' }}>

        <div className={s.header}>
          <h1 className={s.title}>Discover, Invent and Create your Passion.</h1>
          <p className={s.sub}>SOAC is here to make it possible. Explore your Interests and Join a Club.</p>
        </div>

        <div ref={boxRef} className={s.collage}>
          {rows.map(([from, to], r) => {
            const rowAr = ars.slice(from, to).reduce((a, b) => a + b, 0);
            return (
              /* aspect-ratio = sum of the photos' ratios → the row is exactly as tall as
                 its photos need to fill the width side by side */
              <div key={r} className={s.row} style={{ aspectRatio: `${rowAr} / 1` }}>
                {ORDERED.slice(from, to).map((img, k) => (
                  <div key={img.url} className={s.card} style={{ flex: `${ars[from + k]} 1 0` }}>
                    <img src={img.url} alt={img.label} title={img.label} className={s.img}
                      loading={r < 2 ? 'eager' : 'lazy'} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
