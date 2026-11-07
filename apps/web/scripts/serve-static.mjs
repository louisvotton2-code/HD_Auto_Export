import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // The exported Next router accepts text/plain for its static RSC payloads.
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

/** Local verification only. Production serves out/ directly with Nginx. */
export async function createStaticServer(directory) {
  const root = await realpath(directory);
  const withinRoot = (filename) => filename === root || filename.startsWith(`${root}${path.sep}`);

  async function fileInfo(filename) {
    try {
      const actual = await realpath(filename);
      if (!withinRoot(actual)) return null;
      const info = await stat(actual);
      return { filename: actual, info };
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return null;
      throw error;
    }
  }

  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const reply = (status, text) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : text);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      reply(405, 'Method not allowed');
      return;
    }

    let pathname;
    const requestTarget = (request.url || '/').split('?')[0];
    try {
      pathname = decodeURIComponent(requestTarget);
    } catch {
      reply(400, 'Malformed path');
      return;
    }
    if (
      !pathname.startsWith('/') ||
      pathname.startsWith('//') ||
      pathname.includes('\0') ||
      pathname.includes('\\') ||
      pathname.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      reply(403, 'Forbidden path');
      return;
    }

    try {
      const filename = path.resolve(root, `.${pathname}`);
      if (!withinRoot(filename)) {
        reply(403, 'Forbidden path');
        return;
      }
      let selected = await fileInfo(filename);
      if (selected?.info.isDirectory()) {
        if (!pathname.endsWith('/')) {
          const query = (request.url || '').slice(requestTarget.length);
          response.writeHead(301, { Location: `${requestTarget}/${query}` });
          response.end();
          return;
        }
        selected = await fileInfo(path.join(filename, 'index.html'));
      }

      let status = 200;
      if (!selected?.info.isFile()) {
        status = 404;
        selected = await fileInfo(path.join(root, '404.html'));
      }
      if (!selected?.info.isFile()) {
        reply(404, 'Not found');
        return;
      }
      response.writeHead(status, {
        'Content-Type':
          contentTypes[path.extname(selected.filename).toLowerCase()] || 'application/octet-stream',
        'Content-Length': selected.info.size,
      });
      if (request.method === 'HEAD') response.end();
      else
        createReadStream(selected.filename)
          .on('error', () => response.destroy())
          .pipe(response);
    } catch {
      reply(500, 'Unable to read static export');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let port = 3100;
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--port' || !/^\d+$/.test(args[index + 1] || ''))
      throw new Error('Usage: pnpm preview [--port 3100]');
    port = Number(args[++index]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  }
  const server = await createStaticServer(path.resolve('out')).catch(() => {
    throw new Error('Static export is missing. Run pnpm build first.');
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Static export preview: http://127.0.0.1:${port}`);
  });
}
