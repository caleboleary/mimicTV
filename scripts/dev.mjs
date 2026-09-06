// Run the web app and the service together. `npm run dev` uses this.
import { spawn } from 'node:child_process';
const shell = process.platform === 'win32';
const commands = [['npm', ['run', 'dev', '-w', 'apps/server']], ['npm', ['run', 'dev', '-w', 'apps/web']]];
const procs = new Set();
let stopping = false;
function start([cmd, args]) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell });
  procs.add(p);
  p.on('exit', (code, signal) => {
    procs.delete(p);
    if (stopping) return;
    // A crash or a stray kill should not leave the app without its service: respawn after a beat.
    console.error(`[dev] ${args.at(-1)} exited (${signal ?? code}); restarting in 2s`);
    setTimeout(() => start([cmd, args]), 2000);
  });
}
const stop = () => { stopping = true; for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const c of commands) start(c);
