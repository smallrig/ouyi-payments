/**
 * Free the Vite listen port before `dev` so re-running does not fail with "Port already in use".
 */
const { exec } = require('child_process');
const os = require('os');

const httpPort = Number(process.env.PORT || process.argv[2] || 9713);

function killPort(port) {
  return new Promise(resolve => {
    const platform = os.platform();
    if (platform === 'win32') {
      exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
        if (!stdout) {
          resolve();
          return;
        }
        const lines = stdout.split('\n').filter(Boolean);
        let done = 0;
        if (!lines.length) {
          resolve();
          return;
        }
        lines.forEach(line => {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (!/^\d+$/.test(pid)) {
            done += 1;
            if (done === lines.length) resolve();
            return;
          }
          exec(`taskkill /F /PID ${pid}`, killErr => {
            if (!killErr) console.log(`✅ Killed process ${pid} on port ${port}`);
            done += 1;
            if (done === lines.length) resolve();
          });
        });
      });
      return;
    }

    exec(`lsof -ti:${port}`, (err, stdout) => {
      if (!stdout) {
        console.log(`ℹ️  Port ${port} is not in use`);
        resolve();
        return;
      }
      const pids = stdout
        .trim()
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      if (!pids.length) {
        resolve();
        return;
      }
      let done = 0;
      pids.forEach(pid => {
        exec(`kill -9 ${pid}`, killErr => {
          if (!killErr) console.log(`✅ Killed process ${pid} on port ${port}`);
          done += 1;
          if (done === pids.length) resolve();
        });
      });
    });
  });
}

(async () => {
  console.log(`🔧 Freeing port ${httpPort} if occupied…`);
  await killPort(httpPort);
  console.log(`✅ Port ${httpPort} ready`);
})();
