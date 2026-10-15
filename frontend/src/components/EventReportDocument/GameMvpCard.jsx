import d from './EventReportDocument.module.css';

/* A game MVP's headline stats, whatever the sport (labels from buildMvpStats in
   clubDetail.controller.js): the non-zero ones, best first, max 4. Yellow cards
   and errors are kept off an MVP card. */
const STAT_ORDER = ['PTS', 'GLS', 'RUNS', 'WKTS', 'ATK', 'AST', 'REB', 'BLK', 'STL', 'TKLS', 'RAIDS', 'WIN', 'BALLS'];
const HIDDEN = new Set(['YC', 'ERR']);
const mvpStats = (stats = {}) => Object.entries(stats)
  .filter(([k, v]) => !HIDDEN.has(k) && Number(v) > 0)
  .sort(([a], [b]) => ((STAT_ORDER.indexOf(a) + 1) || 99) - ((STAT_ORDER.indexOf(b) + 1) || 99))
  .slice(0, 4);

/* One game MVP: their photo filling the card, name, match and stats on top */
export default function GameMvpCard({ m }) {
  return (
    <div className={`${d.mvpCard} ${m.player_photo ? '' : d.mvpNoPhoto}`}>
      {m.player_photo && <img src={m.player_photo} alt={`MVP ${m.player_name || ''}`} className={d.mvpPhoto} />}
      <div className={d.mvpShade} />
      <div className={d.mvpInfo}>
        <div className={d.mvpTag}>MVP</div>
        <div className={d.mvpName}>{m.player_name || 'Unnamed'}</div>
        <div className={d.mvpMatch}>{m.home_team} vs {m.opponent_name}</div>
        <div className={d.mvpStats}>
          {mvpStats(m.stats).map(([k, v]) => (
            <div key={k} className={d.mvpChip}><span className={d.mvpVal}>{v}</span><span className={d.mvpKey}>{k}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
