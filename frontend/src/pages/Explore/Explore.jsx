import s from './Explore.module.css';

// span: 'wide'=2 cols  'tall'=2 rows  'big'=2×2 feature
const PHOTOS = [
  { url: '/images/i20.png',       label: 'Galore 2026 — Annual Mega Fest',                  span: 'tall' },
  { url: '/images/img6.png',      label: 'Girls Basketball Final'                                         },
  { url: '/images/i12.png',       label: 'Garba & Classical Fusion — Galore 2026',           span: 'big'  },
  { url: '/images/asset-1.png',   label: 'Classical Dance Performance — Galore 2024'                      },
  { url: '/images/i14.png',       label: 'Inter-Department Football'                                       },
  { url: '/images/asset-2.png',   label: 'Galore 2025 — Official Event Poster',             span: 'wide' },
  { url: '/images/img4.png',      label: 'Basketball Championship',                          span: 'tall' },
  { url: '/images/asset-5.png',   label: 'Echoes of Independence — Dance Tribute, Aug 2024', span: 'wide' },
  { url: '/images/i15.png',       label: 'NCC Guard of Honour',                             span: 'tall'  },
  { url: '/images/img8.png',      label: 'Cricket League — 300+ Spectators',                span: 'wide' },
  { url: '/images/asset-7.png',   label: 'Mime Theatre — Indoor Cultural Performance',       span: 'big'  },
  { url: '/images/i18.png',       label: 'Galore 2026 Inauguration'                                        },
  { url: '/images/i21.png',       label: 'Rangoli Championship',                            span: 'tall' },
  { url: '/images/asset-8.png',   label: 'Live Music — Vocals & Guitar at RKU'                             },
  { url: '/images/img7.png',      label: 'Chess — Three Members in Top 5'                                  },
  { url: '/images/asset-9.png',   label: 'NCC Cadets — Group Photo at RK University',       span: 'wide' },
  { url: '/images/asset-6.png',   label: "Volleyball — Sports Fiesta '25"                                  },
  { url: '/images/asset-10.png',  label: 'Student Entrepreneurship Exhibition'                              },
  { url: '/images/i24.png',       label: 'Table Tennis Championship',                       span: 'tall' },
  { url: '/images/asset-11.png',  label: 'Mime Theatre — Galore Stage Performance'                         },
  { url: '/images/i9.png',        label: 'Campus Life — SOAC Events'                                       },
  { url: '/images/asset-14.png',  label: 'NCC Cadet Badge Presentation Ceremony',           span: 'tall' },
  { url: '/images/asset-32.jpeg', label: 'Inter-Department Football Match',                  span: 'wide' },
  { url: '/images/img3.png',      label: 'Art & Imagination Exhibition'                                     },
  { url: '/images/i13.png',       label: 'Student Activities',                              span: 'tall' },
  { url: '/images/asset-17.png',  label: "Volleyball Spike — Sports Fiesta '25",            span: 'wide' },
  { url: '/images/img5.png',      label: 'Basketball Layup — RKU Outdoor Court'                             },
  { url: '/images/asset-35.jpeg', label: "Chess — Sports Fiesta '25"                                        },
  { url: '/images/asset-18.png',  label: 'Kite Festival 2026 — Official Poster'                             },
  { url: '/images/asset-30.jpeg', label: "Table Tennis — Sports Fiesta '25"                                 },
  { url: '/images/asset-21.png',  label: 'Echoes of Independence — Ribbon Dance',           span: 'tall' },
  { url: '/images/asset-28.jpeg', label: 'Garba Group Performance — Traditional Folk Dance', span: 'big'  },
  { url: '/images/i19.png',       label: 'SOAC — Galore Inauguration',                      span: 'tall' },
  { url: '/images/asset-29.jpeg', label: 'Cricket Match — RKU Ground',                      span: 'tall' },
  { url: '/images/img2.png',      label: 'Artistry Competition — Galore 2026'                               },
  { url: '/images/asset-33.jpeg', label: 'Girls Basketball — Drive to the Basket'                           },
  { url: '/images/asset-40.jpeg', label: 'Holi Celebration 2024 — RK University'                            },
  { url: '/images/asset-43.jpeg', label: 'Student Performer at SOAC Stage',                 span: 'tall' },
  { url: '/images/i10.png',       label: 'Galore 2026 — Team Spirit on Stage'                               },
  { url: '/images/i11.png',       label: 'Classical Devotional Dance — Galore 2026',        span: 'big'  },
  { url: '/images/i16.png',       label: 'Galore 2026 Inauguration — Faculty Address'                       },
  { url: '/images/i17.png',       label: 'Sports Inauguration — NCC Flag March',            span: 'wide' },
  { url: '/images/i22.png',       label: 'Rangoli Art — Colored Powder Work in Progress'                    },
  { url: '/images/i23.png',       label: 'Live Singing Performance — RKU Cultural Event',   span: 'tall' },
];

export default function Explore() {
  return (
    <div className={s.page}>
      <div className="wrap" style={{ padding: '120px 0 80px' }}>

        <div className={s.header}>
          <h1 className={s.title}>Discover, Invent and Create your Passion.</h1>
          <p className={s.sub}>SOAC is here to make that possible</p>
        </div>

        <div className={s.grid}>
          {PHOTOS.map((img, i) => (
            <div
              key={i}
              className={`${s.card}${img.span ? ' ' + s[img.span] : ''}`}
            >
              <img src={img.url} alt={img.label} className={s.img} loading="lazy" />
              <div className={s.label}>{img.label}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
