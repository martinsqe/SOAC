/**
 * Kills whatever process is listening on PORT before the server starts.
 * Usage: node scripts/kill-port.js [port]
 * Default port: 5000
 */
const { execSync } = require('child_process');
const port = process.argv[2] || '5000';

try {
  const result = execSync(
    `powershell -Command "(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess"`,
    { encoding: 'utf8' }
  ).trim();

  if (result) {
    console.log(`Killing process ${result} on port ${port}…`);
    execSync(
      `powershell -Command "Stop-Process -Id ${result} -Force -ErrorAction SilentlyContinue"`,
      { encoding: 'utf8' }
    );
    console.log(`Port ${port} is now free.`);
  }
} catch (_) {
  // Port was already free — nothing to do
}
