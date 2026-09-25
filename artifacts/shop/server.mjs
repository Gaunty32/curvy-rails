import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { brotliCompress, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const root = path.resolve(import.meta.dirname, 'dist/public');
const port = Number(process.env.PORT);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT environment variable is required');
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const compressed = new Map();
const compressible = new Set(['.css', '.html', '.js', '.json', '.mjs', '.svg', '.txt']);

function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  const resolved = path.resolve(root, `.${decoded}`);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function cacheControl(filePath) {
  const relative = path.relative(root, filePath).replaceAll(path.sep, '/');
  if (relative === 'index.html') return 'no-cache';
  if (/^assets\/.+-[A-Za-z0-9_-]{8,}\./.test(relative)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=86400, stale-while-revalidate=604800';
}

async function compressedBody(filePath, encoding) {
  const key = `${encoding}:${filePath}`;
  if (compressed.has(key)) return compressed.get(key);

  const source = await readFile(filePath);
  const body = encoding === 'br'
    ? await brotli(source)
    : await gzipAsync(source, { level: 6 });
  compressed.set(key, body);
  return body;
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    let filePath = safePath(requestUrl.pathname);
    if (!filePath) {
      res.writeHead(400).end('Bad request');
      return;
    }

    let fileStat;
    try {
      fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        fileStat = await stat(filePath);
      }
    } catch {
      const acceptsHtml = (req.headers.accept ?? '').includes('text/html');
      if (!acceptsHtml) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      filePath = path.join(root, 'index.html');
      fileStat = await stat(filePath);
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
    const etag = `"${createHash('sha1').update(`${fileStat.size}:${fileStat.mtimeMs}`).digest('base64url')}"`;

    res.setHeader('Cache-Control', cacheControl(filePath));
    res.setHeader('Content-Type', contentType);
    res.setHeader('ETag', etag);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304).end();
      return;
    }

    const accepted = req.headers['accept-encoding'] ?? '';
    const shouldCompress = compressible.has(extension) && fileStat.size >= 1024;
    const encoding = shouldCompress && accepted.includes('br')
      ? 'br'
      : shouldCompress && accepted.includes('gzip')
        ? 'gzip'
        : null;

    if (encoding) {
      const body = await compressedBody(filePath, encoding);
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', body.length);
      res.setHeader('Vary', 'Accept-Encoding');
      res.writeHead(200);
      if (req.method !== 'HEAD') res.end(body);
      else res.end();
      return;
    }

    res.setHeader('Content-Length', fileStat.size);
    res.writeHead(200);
    if (req.method !== 'HEAD') createReadStream(filePath).pipe(res);
    else res.end();
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Internal server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Shop production server listening on port ${port}`);
});