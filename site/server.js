/* Sevalla web process for the static site plus GET /api.
   Same routes as site/vercel.json: /trial redirects to /buyback,
   and /buyback, /burn, /tokens serve their index pages.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const api = require('./api/index.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;

const REDIRECTS = {
  '/trial': '/buyback',
  '/trial/': '/buyback',
};

const REWRITES = {
  '/buyback': '/buyback/index.html',
  '/buyback/': '/buyback/index.html',
  '/burn': '/burn/index.html',
  '/burn/': '/burn/index.html',
  '/tokens': '/tokens/index.html',
  '/tokens/': '/tokens/index.html',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function sendApi(req, res, url) {
  const query = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  req.query = query;
  const end = res.end.bind(res);
  res.status = (code) => {
    res.statusCode = code;
    return {
      json(obj) {
        if (!res.getHeader('content-type')) {
          res.setHeader('content-type', 'application/json; charset=utf-8');
        }
        end(JSON.stringify(obj));
      },
      end(body) {
        end(body);
      },
    };
  };
  return api(req, res);
}

function safeFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (e) {
    return null;
  }
  const full = path.resolve(ROOT, decoded.replace(/^\/+/, ''));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('content-type', type);
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  if (pathname === '/api' || pathname === '/api/') return sendApi(req, res, url);
  if (Object.prototype.hasOwnProperty.call(REDIRECTS, pathname)) {
    res.statusCode = 301;
    res.setHeader('location', REDIRECTS[pathname]);
    res.end();
    return;
  }
  let target = REWRITES[pathname] || pathname;
  if (target === '/') target = '/index.html';
  const file = safeFile(target);
  if (!file) {
    res.statusCode = 400;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Bad path');
    return;
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) return serveFile(res, path.join(file, 'index.html'));
    serveFile(res, file);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('catwithclaws listening on ' + PORT);
});
