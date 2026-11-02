#!/usr/bin/env node
import { execFileSync } from 'child_process'
import fsSync from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { BuildError } from './lib/errors.js'
import { escHtml } from './lib/html/escape.js'
import { describe } from './lib/html/describe.js'
import { withoutOptOuts } from './lib/html/passes.js'
import { createLayout } from './lib/layout.js'
import { info, setVerbose } from './lib/log.js'
import { createOutput } from './lib/output.js'
import { renderBody } from './lib/render.js'
import { createWatcher } from './lib/watch.js'
import { loadVault } from './lib/vault.js'

// The vault (content) is the working directory; the template ships with this repo. Output goes
// to ./dist unless BGEN_OUT names another directory (local use only, e.g. to keep build
// output out of an iCloud-synced vault; CI sets nothing).
const OUTPUT_DIR = process.env.BGEN_OUT ? path.resolve(process.env.BGEN_OUT) : 'dist'
const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'template')

const SITE_URL = 'https://joeyday.com'
const SITE_TITLE = 'Joey Day'
const SITE_DESCRIPTION = 'Hi, I’m Joey. I’m a 40-something software engineer (read: big nerd) in Salt Lake City. When I grow up I’d like to be a seminary professor (read: even bigger nerd).'
const POSTS_PER_PAGE = 5
const FEED_POSTS = 10
const MORE = '<!--more-->'

// ─── Cache-buster ───
// The content repo's commit (CI sets GITHUB_SHA; locally, the vault's HEAD), so assets are
// refetched exactly when a deploy changes something. Without a repo, one timestamp.
function cacheBuster () {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return String(Math.floor(Date.now() / 1000))
  }
}

// Every build starts from an empty output directory, so pages deleted from the vault don't
// linger. Refuses a directory that is the vault or holds it.
async function cleanOutputDir (dir) {
  const rel = path.relative(path.resolve(dir), process.cwd())
  if (rel === '' || !(rel.startsWith('..') || path.isAbsolute(rel))) {
    throw new BuildError(`Refusing to clear "${path.resolve(dir)}": it holds the vault. Point BGEN_OUT somewhere else.`)
  }
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
}

// ─── Posts as HTML ───

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

// A post: its header (linked title, subtitle, byline, date) and the body given. The body is the
// whole post, or its excerpt followed by a link to the rest.
function articleHtml (post, body, { excerpt = false } = {}) {
  const { subtitle, author } = post.data
  const meta = [
    author && author !== 'Joey' ? `<span class="posted-by">By guest author ${escHtml(author)}</span><br>` : '',
    `<time datetime="${post.date.toISOString()}">${DATE_FORMAT.format(post.date)}</time>`
  ].join('\n')
  return `<article class="post">
<header>
<h1><a href="${post.url}" rel="bookmark">${escHtml(post.title)}</a></h1>
${subtitle ? `<div class="subtitle">${escHtml(subtitle)}</div>\n` : ''}<div class="post-meta">
${meta}
</div>
</header>
<div class="post-body">
${body}${excerpt ? `\n<p><a href="${post.url}">Continue reading “${escHtml(post.title)}” ›</a></p>` : ''}
</div>
</article>`
}

// Everything before the <!--more--> marker, or null when a post has none.
const excerptOf = (html) => html.includes(MORE) ? html.slice(0, html.indexOf(MORE)) : null

function pageHtml (page, body) {
  return `<article class="page">
<header>
<h1>${escHtml(page.title)}</h1>
</header>
<div class="post-body">
${body}
</div>
</article>`
}

// ─── Feed ───
// The newest posts in full, as Atom, with the ids Jekyll's feed gave them.
function feedXml (entries) {
  const absolute = (html) => html.replace(/(href|src)="\//g, `$1="${SITE_URL}/`)
  const updated = entries[0]?.post.date.toISOString() ?? new Date().toISOString()
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<generator>bgen</generator>
<link href="${SITE_URL}/feed.xml" rel="self" type="application/atom+xml"/>
<link href="${SITE_URL}/" rel="alternate" type="text/html"/>
<updated>${updated}</updated>
<id>${SITE_URL}/feed.xml</id>
<title type="html">${escHtml(SITE_TITLE)}</title>
<subtitle>${escHtml(SITE_DESCRIPTION)}</subtitle>
<author><name>${escHtml(SITE_TITLE)}</name></author>
${entries.map(({ post, html }) => `<entry>
<title type="html">${escHtml(withoutOptOuts(post.title))}</title>
<link href="${SITE_URL}${post.url}" rel="alternate" type="text/html" title="${escHtml(withoutOptOuts(post.title))}"/>
<published>${post.date.toISOString()}</published>
<updated>${post.date.toISOString()}</updated>
<id>${SITE_URL}${post.url.slice(0, -1)}</id>
<content type="html" xml:base="${SITE_URL}${post.url}">${escHtml(absolute(html))}</content>
<author><name>${escHtml(post.data.author || 'Joey')}</name></author>
${(post.data.categories ?? []).map((c) => `<category term="${escHtml(c)}"/>`).join('\n')}
</entry>`).join('\n')}
</feed>
`
}

async function build ({ outputDir = OUTPUT_DIR } = {}) {
  await cleanOutputDir(outputDir)

  const vault = await loadVault({ outputDir })
  const renderLayout = createLayout({
    template: await fs.readFile(path.join(TEMPLATE_DIR, 'layout.ejs'), 'utf-8'),
    cacheBust: cacheBuster()
  })
  const output = await createOutput({ outputDir })

  const problems = []
  const render = (page) => renderBody(page, { partials: vault.partials, vault, problems })

  // Posts: each on its own page; the home page and the feed reuse the rendered body.
  const rendered = []
  for (const post of vault.posts) {
    const body = render(post)
    rendered.push({ post, body, excerpt: excerptOf(body) })
    await output.emit(post.url, renderLayout(articleHtml(post, body.replace(MORE, '')), {
      url: post.url,
      title: withoutOptOuts(post.title),
      type: 'article',
      description: post.data.description?.trim() || describe(body)
    }), post.filePath)
    info(`Built: ${post.filePath} -> ${output.fileFor(post.url)} (URL: ${post.url})`)
  }

  for (const page of vault.pages) {
    const body = render(page)
    await output.emit(page.url, renderLayout(pageHtml(page, body), {
      url: page.url,
      title: withoutOptOuts(page.title),
      description: page.data.description?.trim() || describe(body)
    }), page.filePath)
    info(`Built: ${page.filePath} -> ${output.fileFor(page.url)} (URL: ${page.url})`)
  }

  // The home page and /page/N/: the newest posts, a few at a time, each cut at its <!--more-->.
  // Their text is checked on the posts' own pages, so these pages keep quiet about it.
  const paginate = async (items, base, title, description) => {
    const pageCount = Math.max(1, Math.ceil(items.length / POSTS_PER_PAGE))
    const pageUrl = (n) => n === 1 ? base : `${base}page/${n}/`
    for (let n = 1; n <= pageCount; n++) {
      const articles = items.slice((n - 1) * POSTS_PER_PAGE, n * POSTS_PER_PAGE)
        .map(({ post, body, excerpt }) => articleHtml(post, (excerpt ?? body).replace(MORE, ''), { excerpt: excerpt !== null }))
      const nav = [
        n < pageCount ? `<a class="older" href="${pageUrl(n + 1)}">‹ Older posts</a>` : '',
        n > 1 ? `<a class="newer" href="${pageUrl(n - 1)}">Newer posts ›</a>` : ''
      ].join('')
      const url = pageUrl(n)
      const html = renderLayout(`${articles.join('\n')}\n<nav class="pagination" aria-label="Posts">${nav}</nav>`, {
        url,
        title: n === 1 ? title : base === '/' ? `Page ${n}` : `${title}, page ${n}`,
        description
      })
      await output.writeFile(path.join(url, 'index.html'), output.process(html, url, true))
    }
  }
  await paginate(rendered, '/', SITE_TITLE, SITE_DESCRIPTION)

  // The archives, not linked from anywhere yet: /YYYY/ and /YYYY/MM/, paginated the same way.
  const years = Map.groupBy(rendered, ({ post }) => post.day.slice(0, 4))
  for (const [year, inYear] of years) {
    await paginate(inYear, `/${year}/`, year, SITE_DESCRIPTION)
    for (const [month, inMonth] of Map.groupBy(inYear, ({ post }) => post.day.slice(5, 7))) {
      const name = new Date(Date.UTC(Number(year), Number(month) - 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
      await paginate(inMonth, `/${year}/${month}/`, `${name} ${year}`, SITE_DESCRIPTION)
    }
  }

  const failures = []
  if (problems.length > 0) failures.push(`Problems in pages:\n${problems.join('\n')}`)
  if (output.problems.length > 0) {
    failures.push(`Scripture references, abbreviations, initials and images that need attention (write a ! before a reference or an all-caps word to opt it out):\n${output.problems.join('\n')}`)
  }
  if (failures.length > 0) throw new BuildError(failures.join('\n\n'))

  await output.writeFile('feed.xml', feedXml(rendered.slice(0, FEED_POSTS).map(({ post, body }) => ({ post, html: output.process(body.replace(MORE, ''), post.filePath, true) }))))
  await output.writeFile('CNAME', 'joeyday.com\n')
  await output.writeFile('.nojekyll', '')
  await fs.cp(TEMPLATE_DIR, path.join(outputDir, 'asset'), { recursive: true, filter: (src) => path.basename(src) !== 'layout.ejs' })
  await output.finish()
}

// ─── Watching ─────────────────────────────────────────────────────────────────
// serve rebuilds when the vault or the template changes. A rebuild goes into a staging
// directory and replaces the served one only when it succeeds, so a mistake that fails the
// build leaves the last good site up. Pages open in a browser then reload themselves.

const STAGE_DIR = path.join(path.dirname(OUTPUT_DIR), `.${path.basename(OUTPUT_DIR)}-next`)
const OLD_DIR = path.join(path.dirname(OUTPUT_DIR), `.${path.basename(OUTPUT_DIR)}-old`)

const WATCHED_EXTENSIONS = new Set(['.md', '.json', '.ejs', '.css', '.js', '.html', '.svg', '.woff', '.woff2', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.mp4'])

function isSiteFile (relPath, skipNames) {
  const parts = relPath.split('/')
  if (parts.some((p) => p.startsWith('.') || skipNames.has(p))) return false
  return WATCHED_EXTENSIONS.has(path.extname(relPath).toLowerCase())
}

function watchAndRebuild ({ reloadPages }) {
  let building = false

  // A rebuild always says what started it and how long it took.
  async function rebuild (files) {
    if (building) {
      // The quiet period ended while a build was still running: those changes wait out a
      // fresh quiet period instead of starting a build the moment this one ends.
      watcher.notify(files)
      return
    }
    console.log(`Changed: ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` and ${files.length - 5} more` : ''}`)
    building = true
    const started = performance.now()
    try {
      await build({ outputDir: STAGE_DIR })
      await fs.rm(OLD_DIR, { recursive: true, force: true })
      await fs.rename(OUTPUT_DIR, OLD_DIR)
      await fs.rename(STAGE_DIR, OUTPUT_DIR)
      await fs.rm(OLD_DIR, { recursive: true, force: true })
      console.log(`Rebuilt in ${((performance.now() - started) / 1000).toFixed(2)} s.`)
      reloadPages()
    } catch (err) {
      console.error('Build failed (still serving the last good build):', err instanceof BuildError ? err.message : err)
    } finally {
      building = false
    }
  }

  const watcher = createWatcher({ onChange: rebuild, quietMs: 500 })
  const outputNames = new Set(['dist', 'node_modules', path.basename(OUTPUT_DIR)])
  watcher.watch('.', (rel) => isSiteFile(rel, outputNames))
  watcher.watch(TEMPLATE_DIR, (rel) => isSiteFile(rel, new Set()))

  // The staging directories are dot-folders inside the vault; don't leave them behind.
  const cleanUp = () => {
    watcher.stop()
    fsSync.rmSync(STAGE_DIR, { recursive: true, force: true })
    fsSync.rmSync(OLD_DIR, { recursive: true, force: true })
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      cleanUp()
      process.exit(0)
    })
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
// bgen [build]      build the site into the output directory (what CI runs).
// bgen serve        build, then serve the output locally (see serve.js) and rebuild whenever
//                   the vault or the template changes, with:
//   --verbose       print every "Built …" line; otherwise only warnings, errors and the address.
//   --port <n>      serve on port n instead of 4002 (also --port=n).
//   --no-watch      serve the first build without rebuilding on changes.

const USAGE = 'Usage: bgen [build | serve [--verbose] [--no-watch] [--port <n>]]'
const [command = 'build', ...args] = process.argv.slice(2)

let verbose = false
let watching = true
let port
let usageOk = command === 'build' ? args.length === 0 : command === 'serve'
for (let i = 0; usageOk && i < (command === 'serve' ? args.length : 0); i++) {
  const [flag, inlineValue] = args[i].split(/=(.*)/s)
  if (flag === '--verbose' && inlineValue === undefined) verbose = true
  else if (flag === '--no-watch' && inlineValue === undefined) watching = false
  else if (flag === '--port') {
    const value = inlineValue ?? args[++i]
    port = Number(value)
    if (!/^\d+$/.test(value ?? '') || port < 1 || port > 65535) usageOk = false
  } else usageOk = false
}
if (!usageOk) {
  console.error(USAGE)
  process.exit(1)
}

setVerbose(command === 'build' || verbose)

try {
  await build()
} catch (err) {
  console.error('Build failed:', err instanceof BuildError ? err.message : err)
  process.exit(1)
}

if (command === 'serve') {
  try {
    const { serve } = await import('./serve.js')
    const { reloadPages } = await serve(OUTPUT_DIR, port, { watching })
    if (watching) watchAndRebuild({ reloadPages })
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
