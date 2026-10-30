import http from 'http'
import fs from 'fs/promises'
import path from 'path'

// Local preview server that mimics GitHub Pages: /foo/ serves foo/index.html,
// /foo redirects to /foo/ when foo is a directory, and anything unmatched
// serves 404.html with a 404 status. Bound to localhost only.

const DEFAULT_PORT = 4002

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf'
}

// Resolve a request path to a file inside root, or null if there isn't one.
// Returns { file } or { redirect } (directory requested without a trailing slash).
async function resolveRequest (root, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const target = path.join(root, decoded)
  // Refuse anything that escapes root (e.g. "/../secret").
  if (target !== root && !target.startsWith(root + path.sep)) return null

  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return null
  }
  if (stat.isFile()) return { file: target }
  if (!stat.isDirectory()) return null
  if (!urlPath.endsWith('/')) return { redirect: urlPath + '/' }
  const index = path.join(target, 'index.html')
  try {
    if ((await fs.stat(index)).isFile()) return { file: index }
  } catch {}
  return null
}

async function send (req, res, status, file, injectReload = false) {
  let body = await fs.readFile(file)
  if (injectReload && path.extname(file).toLowerCase() === '.html') {
    body = Buffer.from(body.toString('utf-8').replace(/<\/body>/i, () => `${RELOAD_SCRIPT}</body>`))
  }
  res.writeHead(status, {
    'Content-Type':
      CONTENT_TYPES[path.extname(file).toLowerCase()] ||
      'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

// Pages served while watching carry this script, which reloads the page when the
// site is rebuilt (the server sends "reload" down /__bgen/reload). The server also
// says which run it is (a boot id) on connecting: a page that reconnects to a different
// one has seen the server restart (tsgen's own code changed), and reloads too. Browsers
// differ on whether an EventSource retries while the server is down, so the script
// reconnects itself until the server is back.
const RELOAD_PATH = '/__bgen/reload'
const RELOAD_SCRIPT = `<script>{let boot;const connect = () => {
  const source = new EventSource("${RELOAD_PATH}");
  source.onmessage = (e) => {
    if (e.data === "reload" || (boot && e.data !== boot)) location.reload();
    else boot = e.data;
  };
  source.onerror = () => {
    source.close();
    setTimeout(connect, 500);
  };
};connect();}</script>`
const BOOT_ID = Date.now().toString(36)

// Serves `dir` on `port`. With `watching`, pages also reload themselves; the
// promise resolves to { reloadPages }, which tells every open page to reload.
export function serve (dir, port = DEFAULT_PORT, { watching = false } = {}) {
  const root = path.resolve(dir)
  const reloadClients = new Set()
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        return res.end()
      }
      const { pathname, search } = new URL(req.url, 'http://localhost')
      if (watching && pathname === RELOAD_PATH) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive'
        })
        res.write(`data: ${BOOT_ID}\n\n`)
        reloadClients.add(res)
        req.on('close', () => reloadClients.delete(res))
        return
      }
      const found = await resolveRequest(root, pathname)
      if (found?.redirect) {
        res.writeHead(301, { Location: found.redirect + search })
        return res.end()
      }
      if (found?.file) return await send(req, res, 200, found.file, watching)

      const notFound = path.join(root, '404.html')
      try {
        await send(req, res, 404, notFound, watching)
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('404 Not Found')
      }
    } catch (err) {
      console.error('Serve error:', err)
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('500 Internal Server Error')
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use (is another serve running? try --port)`)
          : err
      )
    })
    server.listen(port, '127.0.0.1', () => {
      console.log(
        `Serving ${root} at http://localhost:${port}/  (${watching ? 'rebuilding on changes; ' : ''}Ctrl-C to stop)`
      )
      resolve({
        reloadPages: () => {
          for (const client of reloadClients) client.write('data: reload\n\n')
        }
      })
    })
  })
}
