import { useState } from 'react';

export default function GuestContact() {
  const [sent, setSent] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSent(true);
  };

  return (
    <div className="wrap" style={{ padding: '120px 0 80px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: '3rem', marginBottom: 20 }}>Get in touch</h1>
          <p style={{ color: '#4b5563', fontSize: '1.2rem', lineHeight: 1.6, marginBottom: 40 }}>
            Have questions about SOAC or want to start a new club? Our team is here to help you navigate
            student organizations at RK University.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ fontSize: 24 }}>📍</div>
              <div>
                <div style={{ fontWeight: 800 }}>Visit Us</div>
                <div style={{ color: '#6b7280' }}>SOAC Office, Student Activity Center, RK University</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ fontSize: 24 }}>📧</div>
              <div>
                <div style={{ fontWeight: 800 }}>Email</div>
                <div style={{ color: '#635BFF' }}>soac@rku.ac.in</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ fontSize: 24 }}>📞</div>
              <div>
                <div style={{ fontWeight: 800 }}>Call</div>
                <div style={{ color: '#6b7280' }}>+91 97224 85310</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{
          background: '#fff',
          borderRadius: 32,
          padding: 40,
          boxShadow: '0 24px 64px rgba(0,0,0,0.1)',
          border: '1px solid #f0f0f5'
        }}>
          {sent ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <h2 style={{ fontWeight: 900 }}>Message Sent!</h2>
              <p style={{ color: '#6b7280' }}>Thank you for reaching out. We will get back to you shortly.</p>
              <button
                onClick={() => setSent(false)}
                style={{ marginTop: 20, padding: '12px 24px', borderRadius: 12, border: 'none', background: '#635BFF', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >Send another</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#4b5563', marginBottom: 8 }}>Name</label>
                <input
                  required
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1.5px solid #e5e7eb', outline: 'none' }}
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#4b5563', marginBottom: 8 }}>Email</label>
                <input
                  required
                  type="email"
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1.5px solid #e5e7eb', outline: 'none' }}
                  placeholder="john@example.com"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#4b5563', marginBottom: 8 }}>Subject</label>
                <input
                  required
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1.5px solid #e5e7eb', outline: 'none' }}
                  placeholder="Joining a club"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#4b5563', marginBottom: 8 }}>Message</label>
                <textarea
                  required
                  rows={4}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1.5px solid #e5e7eb', outline: 'none', resize: 'vertical' }}
                  placeholder="Tell us how we can help..."
                />
              </div>
              <button
                type="submit"
                style={{
                  marginTop: 10, padding: '14px', borderRadius: 14, border: 'none',
                  background: 'linear-gradient(135deg,#635BFF,#A259FF)',
                  color: '#fff', fontWeight: 800, fontSize: '1rem', cursor: 'pointer'
                }}
              >Send Message</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
