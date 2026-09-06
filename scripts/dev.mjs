// Run the web app and the service together. `npm run dev` uses this.
import { spawn } from 'node:child_process';
const procs = [
  spawn('npm', ['run', 'dev', '-w', 'apps/server'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npm', ['run', 'dev', '-w', 'apps/web'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code && code !== 0) stop(); });
