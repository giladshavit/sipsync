// Serves dist/ the way Vercel serves it in production, so a local check and a
// check against a real deployment exercise the same routing.
//
// Two behaviours matter and neither is plain static file serving:
//   * cleanUrls — /privacy resolves privacy.html, /games resolves
//     games/index.html, / resolves index.html.
//   * vercel.json `rewrites` — dynamic routes that aren't all prerendered
//     (/games/:id) fall through to a shell, resolved via the same cleanUrls
//     candidates. Destinations are already literal post-export (the [id] ->
//     _id_ rename), so matching the source pattern is all that's needed.
//
// Shared by smoke-web.mjs and tutorial-fit.mjs.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST = join(ROOT, 'dist');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webp': 'image/webp',
};

async function isFile(p) {
  try { return (await stat(p)).isFile(); } catch { return false; }
}

/**
 * Start the dist/ server on an ephemeral port.
 * @returns {Promise<{ base: string, close: () => void }>}
 */
export async function serveDist() {
  const { rewrites = [] } = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
  const compiled = rewrites.map((r) => ({
    pattern: new RegExp(`^${r.source.replace(/:[^/]+/g, '[^/]+')}$`),
    destination: r.destination,
  }));

  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    // Vercel injects these at the edge; locally they'd just 404 noisily.
    if (path.startsWith('/_vercel/')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end('');
    }

    let file = null;
    if (extname(path)) {
      if (await isFile(join(DIST, path))) file = join(DIST, path);
      else { res.writeHead(404); return res.end(); }
    } else {
      for (const candidate of [join(DIST, `${path}.html`), join(DIST, path, 'index.html')]) {
        if (await isFile(candidate)) { file = candidate; break; }
      }
      if (!file) {
        const rewrite = compiled.find((r) => r.pattern.test(path));
        if (rewrite) {
          for (const candidate of [
            join(DIST, `${rewrite.destination}.html`),
            join(DIST, rewrite.destination, 'index.html'),
          ]) {
            if (await isFile(candidate)) { file = candidate; break; }
          }
        }
      }
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end(await readFile(join(DIST, '404.html')).catch(() => ''));
      }
    }

    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  };
}
