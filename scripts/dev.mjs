// 本機開發伺服器：模擬 Vercel 的靜態檔、/api/* 函式與 vercel.json 的 rewrite
// 用法：npm run dev（會讀取 .env.local）
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(pathname, res) {
  if (pathname === '/') pathname = '/index.html';
  let file = normalize(join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) return notFound(res);
  if (!extname(file) && existsSync(`${file}.html`)) file += '.html';
  if (!existsSync(file) || !statSync(file).isFile()) return notFound(res);
  res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(file).pipe(res);
}

function notFound(res) {
  res.statusCode = 404;
  res.end('Not found');
}

createServer(async (req, res) => {
  let { pathname } = new URL(req.url, 'http://localhost');
  // 對應 vercel.json：/l/:slug → /api/list?action=page&slug=:slug
  const listPage = pathname.match(/^\/l\/([^/]+)\/?$/);
  if (listPage) {
    req.url = `/api/list?action=page&slug=${listPage[1]}`;
    pathname = '/api/list';
  }
  const api = pathname.match(/^\/api\/([a-z-]+)$/);
  if (!api) return serveStatic(decodeURIComponent(pathname), res);

  const file = join(ROOT, 'api', `${api[1]}.js`);
  if (!existsSync(file)) return notFound(res);
  const mod = await import(pathToFileURL(file).href);
  await mod.default(req, res);
}).listen(PORT, () => {
  console.log(`ShoppingList dev server: http://localhost:${PORT}`);
});
