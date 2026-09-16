/**
 * Kills whatever process is listening on PORT before the server starts.
 * Usage: node scripts/kill-port.js [port]
 * Default port: 5000
 */
const { execSync } = require('child_process');
const port = process.argv[2] || '5000';

try {
  // Only the actual listener — Get-NetTCPConnection without -State also returns
  // every TIME_WAIT connection on the port (OwningProcess 0), which used to get
  // concatenated into one broken multi-line -Id argument below.
  const result = execSync(
    `powershell -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess"`,
    { encoding: 'utf8' }
  ).trim();

  const pids = [...new Set(result.split(/\s+/).filter(pid => pid && pid !== '0'))];

  for (const pid of pids) {
    console.log(`Killing process ${pid} on port ${port}…`);
    execSync(
      `powershell -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`,
      { encoding: 'utf8' }
    );
  }
  if (pids.length) console.log(`Port ${port} is now free.`);
} catch (_) {
  // Port was already free — nothing to do
}
