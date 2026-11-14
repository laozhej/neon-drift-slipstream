// Dependency-free static server, bound only to this computer.
//   node server.mjs          serves the source tree (three.js comes from node_modules)
//   node server.mjs dist     serves the bundled build
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), process.argv[2] || '.');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.map': 'application/json', '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Method not allowed'); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const rel = relative(root, path);
    if (rel.startsWith(`..${sep}`) || rel === '..' || rel.split(sep).some(part => part.startsWith('.'))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!(await stat(path)).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Not found'); }
});

server.on('error', error => {
  console.error(`Neon Drift: Slipstream 启动失败 / could not start: ${error.message}`);
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用 / Port ${port} is already in use.\n在 PowerShell 中尝试 / In PowerShell, try:\n$env:PORT=4174\nnode server.mjs`);
  }
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(
  `Neon Drift: Slipstream 已启动 / is ready:\nhttp://127.0.0.1:${port}\n请保持此终端开启，按 Ctrl+C 停止。 / Keep this terminal open. Press Ctrl+C to stop.`));
