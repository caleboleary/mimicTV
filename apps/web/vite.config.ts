import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

const IMPORTS = path.resolve(__dirname, '../../data/imports');
const DATA = path.resolve(__dirname, '../../data');

/** Dev-only: mirror rules and library to data/rules.json and data/library.json. */
function statePlugin(): Plugin {
  const files: Record<string, string> = { '/rules': path.join(DATA, 'rules.json'), '/library': path.join(DATA, 'library.json') };
  return {
    name: 'mimictv-state',
    configureServer(server) {
      server.middlewares.use('/api', (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]!;
        const file = files[url];
        if (!file) return next();
        if (req.method === 'GET') {
          if (!fs.existsSync(file)) { res.statusCode = 404; res.end('{}'); return; }
          res.setHeader('Content-Type', 'application/json');
          fs.createReadStream(file).pipe(res);
          return;
        }
        if (req.method === 'PUT') {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            fs.mkdirSync(DATA, { recursive: true });
            const tmp = `${file}.tmp`;
            fs.writeFileSync(tmp, Buffer.concat(chunks));
            fs.renameSync(tmp, file);
            res.end('ok');
          });
          return;
        }
        next();
      });
    },
  };
}

/** Dev-only: expose data/imports (files uploaded via scripts/receive.py) at /imports/. */
function importsPlugin(): Plugin {
  return {
    name: 'mimictv-imports',
    configureServer(server) {
      server.middlewares.use('/imports', (req, res, next) => {
        const url = (req.url ?? '/').split('?')[0]!;
        if (url === '/' || url === '/index.json') {
          const files = fs.existsSync(IMPORTS)
            ? fs.readdirSync(IMPORTS).filter((f) => /\.(jsonl|json)(\.gz)?$/.test(f)).map((f) => {
                const st = fs.statSync(path.join(IMPORTS, f));
                return { name: f, size: st.size, mtime: st.mtimeMs };
              }).sort((a, b) => b.mtime - a.mtime)
            : [];
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
          return;
        }
        const name = path.basename(decodeURIComponent(url));
        const file = path.join(IMPORTS, name);
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), importsPlugin(), statePlugin()],
  resolve: {
    alias: {
      '@mimictv/core/schema/playout': path.resolve(__dirname, '../../packages/core/schema/playout-0.0.3.json'),
      '@mimictv/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
  server: { port: 5173 },
});
