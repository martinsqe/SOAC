import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import s from './CalendarView.module.css';

/* ── Constants ── */
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const TYPE_META = {
  event:    { label: 'Event',    color: '#635BFF', bg: '#f0f0ff' },
  holiday:  { label: 'Holiday',  color: '#10b981', bg: '#ecfdf5' },
  exam:     { label: 'Exam',     color: '#ef4444', bg: '#fff0f0' },
  deadline: { label: 'Deadline', color: '#f59e0b', bg: '#fffbeb' },
  academic: { label: 'Academic', color: '#3b82f6', bg: '#eff6ff' },
};
const CAL_TYPES = Object.keys(TYPE_META);

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ═══════════════════════════════════════════════════════════
   SHARED READ-ONLY CALENDAR VIEW
   Used by /student/calendar and /coordinator/calendar
═══════════════════════════════════════════════════════════ */
export default function CalendarView() {
  const today      = new Date();
  const [tab, setTab]            = useState('monthly');
  const [viewYear, setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth]= useState(today.getMonth());
  const [events,   setEvents]    = useState([]);
  const [loading,  setLoading]   = useState(true);
  const [planYear, setPlanYear]  = useState(today.getFullYear());
  const [planEvts, setPlanEvts]  = useState([]);
  const [planLoad, setPlanLoad]  = useState(true);
  const [filter,   setFilter]    = useState('all');

  /* Load current month's events */
  const loadMonth = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/calendar?year=${viewYear}&month=${viewMonth}`);
      setEvents(data.events || []);
    } catch (_) {}
    setLoading(false);
  }, [viewYear, viewMonth]);

  useEffect(() => { if (tab === 'monthly') loadMonth(); }, [loadMonth, tab]);

  /* Load full year events for planner */
  const loadYear = useCallback(async () => {
    setPlanLoad(true);
    try {
      const data = await api.get(`/calendar?year=${planYear}`);
      setPlanEvts(data.events || []);
    } catch (_) {}
    setPlanLoad(false);
  }, [planYear]);

  useEffect(() => { if (tab === 'planner') loadYear(); }, [loadYear, tab]);

  /* Month navigation */
  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };
  const goToday = () => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); };

  /* Build calendar grid cells */
  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells  = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const cells       = Array.from({ length: totalCells }, (_, i) => {
    const d = i - firstDay + 1;
    return (d >= 1 && d <= daysInMonth) ? d : null;
  });

  const isToday = (d) =>
    d !== null &&
    today.getFullYear() === viewYear &&
    today.getMonth() === viewMonth &&
    today.getDate() === d;

  const eventsOnDay = (d) => {
    if (d === null) return [];
    const pad = (n) => String(n).padStart(2, '0');
    const key = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
    return events.filter(ev => (ev.startDate || '').slice(0, 10) === key);
  };

  /* Upcoming events (from today, max 10) for the "upcoming strip" sidebar */
  const todayStr   = today.toISOString().slice(0, 10);
  const upcomingThisMonth = events
    .filter(e => (e.startDate || '').slice(0, 10) >= todayStr)
    .sort((a, b) => a.startDate > b.startDate ? 1 : -1);

  /* Planner data */
  const filtered = filter === 'all' ? planEvts : planEvts.filter(e => e.type === filter);
  const byMonth  = Array.from({ length: 12 }, (_, m) =>
    filtered.filter(ev => new Date(ev.startDate).getMonth() === m)
  );
  const countByMonth = Array.from({ length: 12 }, (_, m) =>
    planEvts.filter(ev => new Date(ev.startDate).getMonth() === m).length
  );

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>📅 College Events Calendar</h1>
          <p className={s.sub}>Browse upcoming college events, exams, holidays, and academic milestones.</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className={s.tabBar}>
        {[
          { key: 'monthly', label: '🗓 Monthly View' },
          { key: 'planner', label: '📋 Year Planner' },
        ].map(t => (
          <button key={t.key}
            className={`${s.tab} ${tab === t.key ? s.tabActive : ''}`}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── MONTHLY TAB ── */}
      {tab === 'monthly' && (
        <div className={s.monthlyWrap}>

          {/* Calendar panel */}
          <div className={s.calPanel}>
            {/* Nav */}
            <div className={s.calNav}>
              <button className={s.navBtn} onClick={prevMonth}>‹</button>
              <span className={s.monthLabel}>{MONTHS[viewMonth]} {viewYear}</span>
              <button className={s.navBtn} onClick={nextMonth}>›</button>
              <button className={s.todayBtn} onClick={goToday}>Today</button>
            </div>

            {/* Legend */}
            <div className={s.legend}>
              {CAL_TYPES.map(t => (
                <span key={t} className={s.legendItem}>
                  <span className={s.legendDot} style={{ background: TYPE_META[t].color }} />
                  {TYPE_META[t].label}
                </span>
              ))}
            </div>

            {/* Scrollable grid wrapper (enables horizontal scroll on mobile) */}
            <div className={s.calScrollWrap}>
              {/* Weekday headers */}
              <div className={s.weekRow}>
                {WEEKDAYS.map(d => <div key={d} className={s.weekHdr}>{d}</div>)}
              </div>

              {/* Grid */}
              {loading ? (
                <div className={s.calLoading}>
                  <div className={s.spinner} />
                  <span>Loading…</span>
                </div>
              ) : (
                <div className={s.calGrid}>
                  {cells.map((d, i) => {
                    const evs = eventsOnDay(d);
                    return (
                      <div key={i}
                        className={`${s.cell} ${d === null ? s.cellOff : ''} ${isToday(d) ? s.cellToday : ''}`}>
                        {d !== null && (
                          <>
                            <span className={`${s.dayNum} ${isToday(d) ? s.dayNumToday : ''}`}>{d}</span>
                            <div className={s.chips}>
                              {evs.slice(0, 2).map(ev => {
                                const m = TYPE_META[ev.type] || TYPE_META.event;
                                return (
                                  <div key={ev.id} className={s.chip}
                                    style={{ background: m.bg, color: m.color, borderLeftColor: m.color }}
                                    title={ev.title}>
                                    {ev.title}
                                  </div>
                                );
                              })}
                              {evs.length > 2 && (
                                <div className={s.chipMore}>+{evs.length - 2} more</div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Upcoming sidebar */}
          <div className={s.sidebar}>
            <div className={s.sidebarTitle}>Upcoming this month</div>
            {loading ? (
              <div className={s.sideEmpty}>Loading…</div>
            ) : upcomingThisMonth.length === 0 ? (
              <div className={s.sideEmpty}>No upcoming events this month.</div>
            ) : (
              <div className={s.sideList}>
                {upcomingThisMonth.map(ev => {
                  const m  = TYPE_META[ev.type] || TYPE_META.event;
                  const d  = new Date(ev.startDate);
                  return (
                    <div key={ev.id} className={s.sideItem} style={{ borderLeftColor: m.color }}>
                      <div className={s.sideDate}>
                        <div className={s.sideMon}>{SHORT_MONTHS[d.getMonth()]}</div>
                        <div className={s.sideDay}>{d.getDate()}</div>
                      </div>
                      <div className={s.sideInfo}>
                        <div className={s.sideEvTitle}>{ev.title}</div>
                        {ev.description && (
                          <div className={s.sideDesc}>{ev.description}</div>
                        )}
                        <span className={s.sideBadge}
                          style={{ background: m.bg, color: m.color }}>{m.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quick month jumper */}
            <div className={s.monthJump}>
              <div className={s.jumpTitle}>Jump to month</div>
              <div className={s.jumpGrid}>
                {SHORT_MONTHS.map((mn, mi) => (
                  <button key={mi}
                    className={`${s.jumpBtn} ${viewMonth === mi && viewYear === today.getFullYear() && mi === today.getMonth() ? s.jumpBtnToday : ''} ${viewMonth === mi ? s.jumpBtnActive : ''}`}
                    onClick={() => setViewMonth(mi)}>
                    {mn}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── YEAR PLANNER TAB ── */}
      {tab === 'planner' && (
        <div className={s.plannerWrap}>

          {/* Header */}
          <div className={s.planHeader}>
            <div className={s.planNav}>
              <button className={s.navBtn} onClick={() => setPlanYear(y => y - 1)}>‹</button>
              <span className={s.monthLabel}>Academic Year {planYear}–{planYear + 1}</span>
              <button className={s.navBtn} onClick={() => setPlanYear(y => y + 1)}>›</button>
            </div>
            <select className={s.filterSel} value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">All types</option>
              {CAL_TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
            </select>
          </div>

          {/* Month overview strip — scrollable */}
          <div className={s.monthStrip}>
            {SHORT_MONTHS.map((mn, mi) => (
              <div key={mi}
                className={`${s.stripMonth} ${today.getMonth() === mi && planYear === today.getFullYear() ? s.stripMonthToday : ''}`}>
                <span className={s.stripMon}>{mn}</span>
                {countByMonth[mi] > 0 && (
                  <span className={s.stripCount}>{countByMonth[mi]}</span>
                )}
              </div>
            ))}
          </div>

          {/* Events grouped by month — scrollable list */}
          {planLoad ? (
            <div className={s.calLoading}><div className={s.spinner} /><span>Loading…</span></div>
          ) : planEvts.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}>📋</div>
              <p className={s.emptyTitle}>No events added for {planYear} yet.</p>
              <p className={s.emptySub}>The admin will add college-wide events, exams, and holidays.</p>
            </div>
          ) : (
            <div className={s.planList}>
              {MONTHS.map((monthName, mi) => {
                const items = byMonth[mi];
                if (!items.length) return null;
                return (
                  <div key={mi} className={s.planMonth}>
                    <div className={s.planMonthHead}>
                      <span className={s.planMonthName}>{monthName} {planYear}</span>
                      <span className={s.planMonthCount}>{items.length} item{items.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className={s.planItems}>
                      {items.map(ev => {
                        const m = TYPE_META[ev.type] || TYPE_META.event;
                        return (
                          <div key={ev.id} className={s.planItem} style={{ borderLeftColor: m.color }}>
                            <div className={s.planItemLeft}>
                              <span className={s.planItemType}
                                style={{ background: m.bg, color: m.color }}>{m.label}</span>
                              <span className={s.planItemTitle}>{ev.title}</span>
                            </div>
                            <div className={s.planItemRight}>
                              <span className={s.planItemDate}>
                                {fmtDate(ev.startDate)}
                                {ev.endDate ? ` → ${fmtDate(ev.endDate)}` : ''}
                              </span>
                              {ev.description && (
                                <span className={s.planItemDesc}>{ev.description}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
