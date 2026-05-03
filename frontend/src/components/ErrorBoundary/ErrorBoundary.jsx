import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message || 'Unknown error' };
  }

  componentDidCatch(err, info) {
    console.error('[ErrorBoundary]', err, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: 'DM Sans, sans-serif', background: '#f4f4f8', padding: 24,
      }}>
        <div style={{
          background: '#fff', border: '1px solid #e8e5f0', borderRadius: 8,
          padding: '40px 36px', maxWidth: 420, textAlign: 'center',
          boxShadow: '0 4px 24px rgba(26,16,64,0.08)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px', color: '#1a1040', fontWeight: 700 }}>
            Something went wrong
          </h2>
          <p style={{ color: '#7b6fa0', fontSize: 14, margin: '0 0 24px' }}>
            An unexpected error occurred. Refreshing the page usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#635bff', color: '#fff', border: 'none',
              borderRadius: 6, padding: '10px 24px', fontSize: 14,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Refresh page
          </button>
        </div>
      </div>
    );
  }
}
