import s from '../Home/Home.module.css';

const GALLERY = [
  { url: '/images/gallery-1.png', label: 'Tech Fest 2024' },
  { url: '/images/gallery-2.png', label: 'Sports Meet' },
  { url: '/images/gallery-3.png', label: 'Cultural Night' },
  { url: '/images/gallery-4.png', label: 'Hackathon Wins' },
  { url: '/images/gallery-5.png', label: 'Club Meetup' },
  { url: '/images/gallery-6.png', label: 'Graduation Ceremony' },
  { url: '/images/i9.png', label: 'Workshop Session' },
  { url: '/images/i10.png', label: 'Community Service' },
  { url: '/images/i11.png', label: 'Design Sprint' },
  { url: '/images/i12.png', label: 'RoboWars Event' },
];

export default function GuestGallery() {
  return (
    <div className="wrap" style={{ padding: '120px 0 80px' }}>
      <div style={{ textAlign: 'center', marginBottom: 60 }}>
        <h1 style={{ fontWeight: 900, fontSize: '2.5rem', marginBottom: 12 }}>Campus Life</h1>
        <p style={{ color: '#6b7280', maxWidth: 600, margin: '0 auto' }}>
          Explore the vibrant activities, events and achievements of our clubs at RK University.
          Capturing moments that define student life.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 24
      }}>
        {GALLERY.map((img, i) => (
          <div key={i} style={{
            borderRadius: 24, overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
            position: 'relative', height: 260
          }}>
            <img
              src={img.url}
              alt={img.label}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '24px 20px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
              color: '#fff', fontWeight: 700
            }}>
              {img.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
