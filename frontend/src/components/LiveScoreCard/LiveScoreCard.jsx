import { SPORT_CFG, teamAbbr, fmtClock } from '../../lib/sportsScores';
import s from './LiveScoreCard.module.css';

export default function LiveScoreCard({ ls }) {
  const cfg = SPORT_CFG[ls.sport] || { color: '#6b7280', bg: '#f3f4f6', label: ls.sport };
  const clockStr = fmtClock(ls.timeRemainingSeconds);
  const homeN = Number(ls.teamScore ?? 0);
  const awayN = Number(ls.opponentScore ?? 0);
  const homeLeads = homeN > awayN;
  const awayLeads = awayN > homeN;

  let homeDisp = String(homeN);
  let awayDisp = String(awayN);
  let homeSub = null;
  let awaySub = null;
  let clockLabel = clockStr;
  let centerExtra = null;

  if (ls.sport === 'basketball') {
    const q = ls.scoreData?.quarter || ls.gameClock || 'Q1';
    clockLabel = `${q} · ${clockStr}`;
    homeSub = `Fouls: ${ls.teamFouls?.home ?? ls.scoreData?.home?.fouls ?? 0}`;
    awaySub = `Fouls: ${ls.teamFouls?.away ?? ls.scoreData?.away?.fouls ?? 0}`;
    const qOrder = ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];
    const curQIdx = qOrder.indexOf(q);
    centerExtra = (
      <div className={s.lsPeriodRow}>
        {['Q1', 'Q2', 'Q3', 'Q4'].map((qq, qi) => (
          <span
            key={qq}
            className={s.lsPDot}
            style={{ background: qi < curQIdx ? `${cfg.color}60` : qi === curQIdx ? cfg.color : '#e5e7eb' }}
          />
        ))}
      </div>
    );
  } else if (ls.sport === 'cricket') {
    const hWkt = ls.scoreData?.home?.wickets;
    const aWkt = ls.scoreData?.away?.wickets;
    homeDisp = hWkt != null ? `${homeN}/${hWkt}` : String(homeN);
    awayDisp = aWkt != null ? `${awayN}/${aWkt}` : String(awayN);
    homeSub = ls.scoreData?.home?.overs ? `${ls.scoreData.home.overs} ov` : null;
    awaySub = ls.scoreData?.away?.overs ? `${ls.scoreData.away.overs} ov` : null;
    clockLabel = ls.gameClock || 'LIVE';
    if (ls.scoreData?.home?.target) {
      centerExtra = <p className={s.lsCtxLine}>Target: {ls.scoreData.home.target}</p>;
    }
  } else if (ls.sport === 'football') {
    const half = ls.scoreData?.home?.half;
    clockLabel = half ? `Half ${half} · ${clockStr}` : (ls.gameClock || clockStr);
    const poss = ls.scoreData?.home?.possession;
    if (poss) centerExtra = <p className={s.lsCtxLine}>Poss {poss}%</p>;
  } else if (ls.sport === 'volleyball') {
    const hSets = ls.scoreData?.home?.setsWon;
    const aSets = ls.scoreData?.away?.setsWon;
    if (hSets != null) { homeDisp = String(hSets); homeSub = `${homeN} pts`; }
    if (aSets != null) { awayDisp = String(aSets); awaySub = `${awayN} pts`; }
    clockLabel = `Set ${ls.scoreData?.home?.set || ls.gameClock || '—'}`;
  } else if (ls.sport === 'badminton') {
    const hGames = ls.scoreData?.home?.gamesWon;
    const aGames = ls.scoreData?.away?.gamesWon;
    if (hGames != null) { homeDisp = String(hGames); homeSub = `${homeN} pts`; }
    if (aGames != null) { awayDisp = String(aGames); awaySub = `${awayN} pts`; }
    clockLabel = `Game ${ls.scoreData?.home?.game || ls.gameClock || '—'}`;
  } else {
    clockLabel = ls.gameClock || clockStr;
  }

  const homeName = ls.homeTeam || ls.clubName || 'Home Team';
  const lastPlay = ls.playByPlay?.[0];
  const isLive = ls.status === 'live';

  return (
    <article className={s.lsCard}>
      <header className={s.lsHeader}>
        <div className={s.lsHeaderLeft}>
          <h3 className={s.lsHeaderTitle}>
            {ls.matchTitle || `${homeName} vs ${ls.opponentName || 'Away'}`}
          </h3>
          <div className={s.lsHeaderMeta}>
            <span className={s.lsSportBadge} style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
            {ls.clubName && <span className={s.lsClubTxt}>{ls.clubName}</span>}
            {ls.venue && <span className={s.lsVenueTxt}>{ls.venue}</span>}
          </div>
        </div>
        <div className={s.lsHeaderRight}>
          <span className={s.lsClockBadge} style={{ color: cfg.color }}>{clockLabel}</span>
          {isLive && <span className={s.lsLiveDot} title="Live" />}
        </div>
      </header>
      <div className={s.lsBody}>
        <div className={s.lsTeamSide}>
          <div className={s.lsAvatar} style={{ background: cfg.color }}>{teamAbbr(homeName)}</div>
          <p className={s.lsTeamName}>{homeName}</p>
          {homeSub && <p className={s.lsTeamSub}>{homeSub}</p>}
        </div>
        <div className={s.lsScoreArea}>
          <div className={s.lsScoreRow}>
            <span className={`${s.lsBigScore} ${homeLeads ? s.lsBigScoreLead : ''}`}>{homeDisp}</span>
            <span className={s.lsDash}>-</span>
            <span className={`${s.lsBigScore} ${awayLeads ? s.lsBigScoreLead : ''}`}>{awayDisp}</span>
          </div>
          {centerExtra}
        </div>
        <div className={`${s.lsTeamSide} ${s.lsTeamSideRight}`}>
          <div className={s.lsAvatar} style={{ background: '#374151' }}>{teamAbbr(ls.opponentName || 'AWAY')}</div>
          <p className={s.lsTeamName}>{ls.opponentName || 'Away Team'}</p>
          {awaySub && <p className={s.lsTeamSub}>{awaySub}</p>}
        </div>
      </div>
      <footer className={s.lsFooter}>
        <span className={s.lsFooterLeft}>{cfg.label} · {ls.venue || 'Venue TBA'}</span>
        {lastPlay ? (
          <span className={s.lsLastPlay}>
            {lastPlay.player_name || 'Team'} · {String(lastPlay.event_type || '').replace(/_/g, ' ')}
            {lastPlay.points > 0 ? ` +${lastPlay.points}` : ''}
          </span>
        ) : (
          <span className={s.lsFooterLeft}>{isLive ? 'Ongoing' : 'Final'}</span>
        )}
      </footer>
    </article>
  );
}


