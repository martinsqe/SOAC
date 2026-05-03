import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import s from './StudentNewsFeed.module.css';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function clubInitial(name = '') { return name.charAt(0).toUpperCase(); }

const CLUB_COLORS = [
  '#635BFF', '#0EA5E9', '#10B981', '#F59E0B',
  '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4',
];
function clubColor(idx) { return CLUB_COLORS[idx % CLUB_COLORS.length]; }

/* ── Sub-components ──────────────────────────────────────────────────────── */


function NewsCard({ item }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={s.card}
    >
      <div className={s.cardImg}>
        {item.image && !imgErr ? (
          <img
            src={item.image}
            alt={item.title}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className={s.imgPlaceholder}>
            <span>📰</span>
          </div>
        )}
      </div>
      <div className={s.cardBody}>
        <p className={s.cardMeta}>
          <span className={s.cardSource}>{item.source}</span>
          <span className={s.dot}>·</span>
          <span className={s.cardTime}>{timeAgo(item.publishedAt)}</span>
        </p>
        <h3 className={s.cardTitle}>{item.title}</h3>
        {item.description && (
          <p className={s.cardDesc}>{item.description}</p>
        )}
      </div>
    </a>
  );
}

function VideoCard({ item }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={s.card}
    >
      <div className={s.cardImg}>
        {item.image ? (
          <img src={item.image} alt={item.title} />
        ) : (
          <div className={s.imgPlaceholder}>
            <span>🎬</span>
          </div>
        )}
      </div>
      <div className={s.cardBody}>
        <p className={s.cardMeta}>
          <span className={s.cardSource}>{item.source}</span>
          <span className={s.dot}>·</span>
          <span className={s.cardTime}>{timeAgo(item.publishedAt)}</span>
        </p>
        <h3 className={s.cardTitle}>{item.title}</h3>
        {item.description && (
          <p className={s.cardDesc}>{item.description}</p>
        )}
      </div>
    </a>
  );
}

function SkeletonCard() {
  return (
    <div className={s.skeleton}>
      <div className={s.skelImg} />
      <div className={s.skelBody}>
        <div className={s.skelLine} style={{ width: '40%', height: 12 }} />
        <div className={s.skelLine} style={{ width: '90%', height: 18 }} />
        <div className={s.skelLine} style={{ width: '75%', height: 18 }} />
        <div className={s.skelLine} style={{ width: '60%', height: 13 }} />
      </div>
    </div>
  );
}

/* ── No-clubs empty state ─────────────────────────────────────────────────── */
function NoClubs({ navigate }) {
  return (
    <div className={s.emptyWrap}>
      <div className={s.emptyIcon}>🔍</div>
      <h2 className={s.emptyTitle}>No clubs joined yet</h2>
      <p className={s.emptyDesc}>
        Join a club and your News Feed will automatically show relevant articles
        and videos sourced from across the web.
      </p>
      <button className={s.emptyBtn} onClick={() => navigate('/student/clubs')}>
        Explore Clubs
      </button>
    </div>
  );
}

/* ── API keys missing state ───────────────────────────────────────────────── */
function NoApiKeys({ clubs }) {
  return (
    <div className={s.emptyWrap}>
      <div className={s.emptyIcon}>🔑</div>
      <h2 className={s.emptyTitle}>News Feed not configured</h2>
      <p className={s.emptyDesc}>
        Add your free API keys to <code className={s.code}>backend/.env</code> to
        start surfacing content for your clubs.
      </p>
      <div className={s.keyBox}>
        <p className={s.keyRow}>
          <strong>NEWS_API_KEY</strong>
          <span> — free at newsapi.org/register (100 req/day)</span>
        </p>
        <p className={s.keyRow}>
          <strong>YOUTUBE_API_KEY</strong>
          <span> — free via Google Cloud Console → YouTube Data API v3</span>
        </p>
      </div>
      {clubs.length > 0 && (
        <p className={s.emptyDesc} style={{ marginTop: 16 }}>
          Your feed will be tailored to:{' '}
          <strong>{clubs.map((c) => c.name).join(', ')}</strong>
        </p>
      )}
    </div>
  );
}

/* ── Empty results state ──────────────────────────────────────────────────── */
function NoResults({ activeFilter, onReset }) {
  return (
    <div className={s.emptyWrap}>
      <div className={s.emptyIcon}>📭</div>
      <h2 className={s.emptyTitle}>
        No {activeFilter !== 'all' ? activeFilter + ' ' : ''}results right now
      </h2>
      <p className={s.emptyDesc}>
        There are no recent stories matching your filters. Try broadening the
        filters or check back soon.
      </p>
      {activeFilter !== 'all' && (
        <button className={s.emptyBtn} onClick={onReset}>
          Show all
        </button>
      )}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */
export default function StudentNewsFeed() {
  const navigate = useNavigate();

  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [clubs,        setClubs]        = useState([]);
  const [items,        setItems]        = useState([]);
  const [apiStatus,    setApiStatus]    = useState({ news: false, youtube: false });
  const [typeFilter,   setTypeFilter]   = useState('all');   // 'all' | 'news' | 'video'
  const [lastRefresh,  setLastRefresh]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/news-feed');
      setClubs(data.clubs      || []);
      setItems(data.items      || []);
      setApiStatus(data.apiStatus || { news: false, youtube: false });
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load feed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Derived state ── */
  const noApiKeys = !apiStatus.news && !apiStatus.youtube;

  const visibleItems = items.filter((item) => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    return true;
  });

  const newsCt  = items.filter((i) => i.type === 'news').length;
  const videoCt = items.filter((i) => i.type === 'video').length;

  /* ── Render ── */
  return (
    <div className={s.page}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerLeft}>
          <h1 className={s.title}>News Feed</h1>
          <p className={s.subtitle}>
            Stories and videos curated for your clubs
          </p>
        </div>
        <button
          className={s.refreshBtn}
          onClick={load}
          disabled={loading}
          title="Refresh feed"
        >
          <span className={loading ? s.spinning : ''}>↻</span>
          {lastRefresh && (
            <span className={s.refreshTime}>
              Updated {timeAgo(lastRefresh)}
            </span>
          )}
        </button>
      </div>

      {/* Club chips (show which clubs are fueling the feed) */}
      {clubs.length > 0 && (
        <div className={s.clubStrip}>
          <span className={s.clubStripLabel}>Sourced from:</span>
          {clubs.map((club, i) => (
            <span
              key={club.id}
              className={s.clubChip}
              style={{ '--chip-color': clubColor(i) }}
            >
              <span className={s.clubChipAvatar} style={{ background: clubColor(i) }}>
                {clubInitial(club.name)}
              </span>
              {club.name}
            </span>
          ))}
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className={s.grid}>
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className={s.errorBox}>
          <p>{error}</p>
          <button className={s.emptyBtn} onClick={load}>Retry</button>
        </div>
      )}

      {/* No clubs */}
      {!loading && !error && clubs.length === 0 && (
        <NoClubs navigate={navigate} />
      )}

      {/* API keys missing */}
      {!loading && !error && clubs.length > 0 && noApiKeys && (
        <NoApiKeys clubs={clubs} />
      )}

      {/* Feed */}
      {!loading && !error && !noApiKeys && items.length > 0 && (
        <>
          {/* Type filter tabs */}
          <div className={s.filterBar}>
            <button
              className={`${s.filterTab} ${typeFilter === 'all'   ? s.filterActive : ''}`}
              onClick={() => setTypeFilter('all')}
            >
              All
              <span className={s.filterCount}>{items.length}</span>
            </button>
            <button
              className={`${s.filterTab} ${typeFilter === 'news'  ? s.filterActive : ''}`}
              onClick={() => setTypeFilter('news')}
            >
              News
              <span className={s.filterCount}>{newsCt}</span>
            </button>
            <button
              className={`${s.filterTab} ${typeFilter === 'video' ? s.filterActive : ''}`}
              onClick={() => setTypeFilter('video')}
            >
              Videos
              <span className={s.filterCount}>{videoCt}</span>
            </button>
          </div>

          {/* Cards grid */}
          {visibleItems.length > 0 ? (
            <div className={s.grid}>
              {visibleItems.map((item) =>
                item.type === 'video'
                  ? <VideoCard key={item.id} item={item} />
                  : <NewsCard  key={item.id} item={item} />
              )}
            </div>
          ) : (
            <NoResults
              activeFilter={typeFilter}
              onReset={() => setTypeFilter('all')}
            />
          )}
        </>
      )}

      {/* Feed empty after successful fetch */}
      {!loading && !error && !noApiKeys && clubs.length > 0 && items.length === 0 && (
        <NoResults activeFilter="all" onReset={() => {}} />
      )}
    </div>
  );
}
