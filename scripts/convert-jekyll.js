#!/usr/bin/env node
// The one-time migration of Joey's Jekyll vault (~/Obsidian/Blog) to bgen's layout and syntax.
// Run it in a git-tracked vault and read the diff:
//
//   node ~/Projects/bgen/scripts/convert-jekyll.js [vault-dir] [--wp-public <folder>]
//
// The vault defaults to . ; --wp-public is the old WordPress site's web root (the backup's
// joeyday.com/public), where the images the posts use but the vault never had are copied from.
//
// It
//   - moves _posts/YYYY/… to post/YYYY/YYYY-MM-DD-slug.md (the date in the name is the post's
//     UTC date, which is what Jekyll built the address from), _drafts to draft/, assets/images
//     to image/, and resume/, supercut/ and docs/ to static/;
//   - rewrites frontmatter (no `layout`, no empty values, one key order);
//   - finishes the old WordPress migration in the text: Textile lists (`\# item`) and links
//     (`“text”:url`), escaped brackets, the endmark include and image, `{% highlight %}`;
//   - turns the escaped Textile emphasis (\_like this\_) into *em*;
//   - turns WP-Footnotes' ((notes)) into Markdown footnotes;
//   - turns the old AutoLinker plugin's "[Name]" into [Name](url) from scripts/autolinks.json;
//   - turns links to other posts into wikilinks and images into `![[…]]` embeds, filling
//     alt-text.json from the alt text they had;
//   - removes Jekyll's own files (_config.yml, _layouts, _includes, _sass, Gemfile …).
// What it can't decide it leaves alone and lists in the report it prints.

import fs from 'fs'
import path from 'path'
import { stringify } from 'yaml'
import { maskCode, restoreCode } from '../lib/code.js'
import { parseFrontmatter } from '../lib/frontmatter.js'

// The old AutoLinker plugin's "[Movable Type]" → link table (scripts/autolinks.json).
const autolinks = JSON.parse(fs.readFileSync(new URL('./autolinks.json', import.meta.url), 'utf-8'))

const args = process.argv.slice(2)
const wpFlag = args.indexOf('--wp-public')
const wpPublic = wpFlag === -1 ? null : path.resolve(args.splice(wpFlag, 2)[1])
const root = path.resolve(args[0] ?? '.')
const at = (...parts) => path.join(root, ...parts)
const report = { renamed: [], missingImages: new Map(), unresolvedLinks: [], remoteImages: [], htmlImages: [], noAlt: [], other: [] }

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|avif)$/i

function walk (dir, keep = () => true) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const file = path.join(dir, entry.name)
      return entry.isDirectory() ? walk(file, keep) : keep(entry.name) ? [file] : []
    })
}

const move = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(from, to)
}

// ─── 1. Read every post ───

const posts = walk(at('_posts'), (name) => name.endsWith('.md')).map((file) => {
  const { data, content } = parseFrontmatter(fs.readFileSync(file, 'utf-8'))
  const old = /^(\d{4})-(\d\d)-(\d\d)-(.+)\.md$/.exec(path.basename(file))
  const date = new Date(/T/.test(String(data.date)) ? String(data.date) : `${data.date}T00:00:00Z`)
  const day = date.toISOString().slice(0, 10)
  const [year, month, dayOfMonth] = day.split('-')
  const slug = old[4]
  const name = `${day}-${slug}`
  if (name !== path.basename(file, '.md')) report.renamed.push(`${path.basename(file)} → ${name}.md (its date is ${data.date})`)
  return { file, data, content, slug, name, year, oldUrl: `/${year}/${month}/${dayOfMonth}/${slug}`, id: data.id }
})

const byUrl = new Map(posts.map((p) => [p.oldUrl, p]))
const byId = new Map(posts.filter((p) => p.id != null).map((p) => [String(p.id), p]))

// ─── 2. Images ───

// Every image that will be in image/: the ones in assets/images and the two the layout used.
const images = new Set(fs.existsSync(at('assets', 'images')) ? fs.readdirSync(at('assets', 'images')).filter((n) => IMAGE_EXTENSIONS.test(n)) : [])
const altText = {}
const recovered = new Map() // image name → file in the old site, copied into image/
const lowerImages = new Map([...images].map((n) => [n.toLowerCase(), n]))

// An image on this site, by the name it will have in image/. WordPress kept uploads in
// wp-content/uploads/YYYY/MM/name; the names there aren't unique, so the folder joins the name.
function localImageName (url) {
  let m = /^(?:https?:\/\/(?:www\.)?joeyday\.com)?\/wp-content\/uploads\/(\d{4})\/(\d\d)\/([^/?#]+)/.exec(url)
  if (m) return `${m[1]}-${m[2]}-${decodeURIComponent(m[3])}`
  m = /^(?:https?:\/\/(?:www\.)?joeyday\.com)?\/(?:assets\/)?images\/([^/?#]+)/.exec(url)
  if (m) return decodeURIComponent(m[1])
  m = /^\/wp-content\/themes\/[^/]+\/images\/([^/?#]+)/.exec(url)
  if (m) return decodeURIComponent(m[1])
  return null
}

// Where the old site kept the file for such a URL, under --wp-public.
function wpSource (url) {
  if (!wpPublic) return null
  const m = /^(?:https?:\/\/(?:www\.)?joeyday\.com)?(\/(?:wp-content\/(?:uploads|themes)|assets\/images|images)\/[^?#]+)/.exec(url)
  if (!m) return null
  const rel = decodeURIComponent(m[1]).replace(/^\/assets\/images\//, '/images/')
  const file = path.join(wpPublic, rel)
  return fs.existsSync(file) ? file : null
}

function embed (url, alt, where, linkOnly = false) {
  const name = localImageName(url)
  if (name === null) return null
  const known = lowerImages.get(name.toLowerCase())
  if (!known && !images.has(name) && !recovered.has(name)) {
    const source = wpSource(url)
    if (source) {
      recovered.set(name, source)
    } else {
      const list = report.missingImages.get(name) ?? []
      list.push(where)
      report.missingImages.set(name, list)
    }
  }
  const final = known ?? name
  if (!linkOnly && (!(final in altText) || (!altText[final] && alt))) altText[final] = alt
  return final
}

// ─── 3. The text ───

const PLACEHOLDER = (n) => `${n}`

// Textile lists survive from WordPress as `\# item` and `\** item` lines (hard-broken with two
// spaces). Each run of them becomes a Markdown list: # numbered, * bulleted, nested by count.
function convertBlocks (text, where) {
  return text.split('\n').map((line) => {
    let m
    if ((m = /^bq\.\.? (.*)$/.exec(line))) return `> ${m[1]}`
    if ((m = /^p\. (.*)$/.exec(line))) return m[1]
    if ((m = /^h([1-6])\. (.*)$/.exec(line))) return `${'#'.repeat(Number(m[1]))} ${m[2]}`
    if ((m = /^fn(\d+)\. (.*)$/.exec(line))) {
      report.other.push(`${where}: footnote ${m[1]} had no reference in the text; it is now a paragraph`)
      return m[2]
    }
    return line
  }).join('\n')
}

// Textile's @code@
const convertCode = (text) => text.replace(/(^|[\s(])@([^@\s](?:[^@\n]*[^@\s])?)@(?=[\s.,;:!?)]|$)/g, (m, before, code) => `${before}\`${code}\``)

function convertLists (text) {
  const lines = text.split('\n')
  const out = []
  let inList = false
  for (const line of lines) {
    const numbered = /^(\d+)\\\.[ \t]+(.*?)[ \t]*$/.exec(line)
    const m = numbered ? [line, '\\#', numbered[2]] : /^((?:\\[#*])+)[ \t]+(.*?)[ \t]*$/.exec(line)
    if (!m) {
      inList = false
      out.push(line)
      continue
    }
    if (!inList && out.length > 0 && out.at(-1).trim() !== '') out.push('')
    inList = true
    const marks = m[1].replaceAll('\\', '')
    const bullet = marks.at(-1) === '#' ? '1.' : '-'
    out.push(`${'   '.repeat(marks.length - 1)}${bullet} ${m[2]}`)
  }
  return out.join('\n')
}

// “text”:http://url (Textile) → [text](url), without the sentence's punctuation after the URL.
function convertTextileLinks (text) {
  return text.replace(/(?:“([^”“\n]{1,200})”|‘([^’‘\n]{1,200})’):(https?:\/\/[^\s<>"]+)/g, (match, doubleLabel, singleLabel, url) => {
    const label = doubleLabel ?? singleLabel
    url = url.replaceAll('\\_', '_')
    const tail = /[.,;:!?)]+$/.exec(url)?.[0] ?? ''
    if (tail) url = url.slice(0, -tail.length)
    return `[${label}](${url})${tail}`
  })
}

function convertImages (text, where, stash) {
  const keep = (s) => PLACEHOLDER(stash.push(s) - 1)
  // ![alt](url "title"), optionally the only thing in a link
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, alt, url, title) => {
    const name = localImageName(url)
    if (name === null) {
      report.remoteImages.push(`${where}: ${url}`)
      altText[decodeURIComponent(url.split('/').pop().split(/[?#]/)[0])] ??= alt || title || ''
      return match
    }
    if (/^endmark\.png$/i.test(name) || /endmark/i.test(url)) return keep('@@ENDMARK@@')
    const final = embed(url, alt || title || '', where)
    if (!(alt || title)) report.noAlt.push(`${where}: ${final}`)
    return keep(`![[${final}]]`)
  })
  // <img …>: an embed when it has no class, else HTML pointing at the image's new address
  text = text.replace(/<img\s+([^>]*?)\/?>/gi, (match, attrs) => {
    const get = (name) => new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs)?.slice(1).find((v) => v !== undefined)
    const src = get('src')
    if (src === undefined) return match
    if (/endmark/i.test(src)) return keep('@@ENDMARK@@')
    const name = localImageName(src)
    if (name === null) {
      report.remoteImages.push(`${where}: ${src}`)
      altText[decodeURIComponent(src.split('/').pop().split(/[?#]/)[0])] ??= get('alt') ?? ''
      return match
    }
    const final = embed(src, get('alt') ?? '', where)
    const className = get('class')
    const [width, height] = [get('width'), get('height')]
    if (!className) {
      const size = width && height ? `|${width}x${height}` : width ? `|${width}` : ''
      return keep(`![[${final}${size}]]`)
    }
    report.htmlImages.push(`${where}: ${final} (class ${className})`)
    return keep(`<img src="/assets/images/${final}" class="${className}"${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''}>`)
  })
  return text
}

// [text](link to another post) → [[post|text]]
function convertLinks (text, where) {
  return text.replace(/(?<!!)\[((?:[^\][]|\[[^\]]*\])*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g, (match, label, url) => {
    if (/^(?:https?:\/\/(?:www\.)?joeyday\.com)?\/about\/?$/.test(url)) return `[[About|${label}]]`
    const image = IMAGE_EXTENSIONS.test(url) ? embed(url, '', where, true) : null
    if (image) return /\uE002/.test(label) ? `[${label}](/assets/images/${image})` : `[[${image}|${label}]]`
    const m = /^(?:https?:\/\/(?:www\.)?joeyday\.com)?(\/\d{4}\/\d\d\/\d\d\/[^/?#]+|\/\?p=\d+)\/?(#[^\s]*)?$/.exec(url)
    if (!m) {
      if (/^(https?:\/\/(www\.)?joeyday\.com)?\/(?!\/)/.test(url) && !/^https?:\/\/(www\.)?joeyday\.com\/?$/.test(url)) report.unresolvedLinks.push(`${where}: ${url}`)
      return match
    }
    const target = m[1].startsWith('/?p=') ? byId.get(m[1].slice(4)) : byUrl.get(m[1])
    if (!target) {
      report.unresolvedLinks.push(`${where}: ${url} (no such post)`)
      return match
    }
    const heading = m[2] ?? ''
    return label === target.data.title ? `[[${target.name}${heading}]]` : `[[${target.name}${heading}|${label}]]`
  })
}

// A few posts were saved as Latin-1 once; the damage is regular.
const MOJIBAKE = { 'â€œ': '“', 'â€?': '”', 'â€™': '’', 'â€˜': '‘', 'â€¦': '…', 'â€“': '–', 'â€”': '—' }
const fixMojibake = (text) => text.replace(/â€[œ?™˜¦“”]/g, (m) => MOJIBAKE[m] ?? m)

// Titles carry WordPress's HTML entities (&#039;, &amp;); the frontmatter wants the characters.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeEntities = (text) => text.replace(/&(?:#(\d+)|([a-z]+));/g, (m, code, name) => code ? String.fromCodePoint(Number(code)) : ENTITIES[name] ?? m)

// WordPress wrapped pictures and file tiles in <div class="lpic">…</div> with the Markdown (and
// sometimes the paragraph after it) on the same line. markdown-it reads that whole line as HTML,
// so each tag gets its own paragraph and what is inside is Markdown again.
const splitDivs = (text) => text
  .replace(/[ \t]*(<div\b[^>]*>)[ \t]*/g, '\n\n$1\n\n')
  .replace(/[ \t]*<\/div>[ \t]*/g, '\n\n</div>\n\n')
  .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')

// The same for WordPress's captioned pictures, <figure>[![[img]]](url)<figcaption>…</figcaption></figure>
// followed by the next paragraph, all on one line.
const splitFigures = (text) => text
  .replace(/(<figure\b[^>\n]*>)([^\n]*?)(<figcaption\b[^>\n]*>)([^\n]*?)<\/figcaption>[ \t]*<\/figure>[ \t]*/g, '\n\n$1\n\n$2\n\n$3\n\n$4\n\n</figcaption>\n\n</figure>\n\n')
  .replace(/(<figure\b[^>\n]*>)((?:(?!<figcaption)[^\n])+?)<\/figure>[ \t]*(?=\S)/g, '\n\n$1\n\n$2\n\n</figure>\n\n')
  .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')

// WP-Footnotes wrote a footnote inline, as ((the note)). Each becomes [^n] where it stood, and
// its text a [^n]: definition at the end, numbered after any footnotes the post already has.
function convertFootnotes (text) {
  let n = Math.max(0, ...[...text.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1])))
  const notes = []
  let out = ''
  let i = 0
  for (;;) {
    const start = text.indexOf('((', i)
    if (start === -1) break
    let depth = 0
    let end = start
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++
      else if (text[end] === ')' && --depth === 0) break
    }
    if (depth !== 0) {
      out += text.slice(i, start + 2)
      i = start + 2
      continue
    }
    const note = text.slice(start + 2, end - 1).trim().replace(/\n[ \t]*/g, '\n    ')
    n++
    notes.push(`[^${n}]: ${note}`)
    out += `${text.slice(i, start).replace(/[ \t]+$/, '')}[^${n}]`
    i = end + 1
  }
  return notes.length === 0 ? text : `${out}${text.slice(i)}\n\n${notes.join('\n\n')}`
}

function convertBody (body, where) {
  body = fixMojibake(body)
  // {% highlight js %} … {% endhighlight %} → a fence
  body = body.replace(/\{%\s*highlight\s*(\w*)\s*%\}\n?([\s\S]*?)\n?\{%\s*endhighlight\s*%\}/g, (m, lang, code) => `\`\`\`${lang}\n${code}\n\`\`\``)
  // SyntaxHighlighter's [code language="js"]…[/code]. (Its quotes come out curly in the export;
  // the two posts that have it were re-read from the WordPress dump for the exact code.)
  body = body.replace(/\[code(?:\s+language=["“”]?(\w+)[^\]]*)?\]\n?([\s\S]*?)\n?\[\/code\]/g, (m, lang, code) => `\`\`\`${lang ?? ''}\n${code.replace(/ +$/gm, '')}\n\`\`\``)
  const stash = []
  body = maskCode(body, stash)
  if (body.includes('((')) body = convertFootnotes(body)
  const images = []
  body = body.replace(/\[(!\[[^\]]*\]\([^)]*endmark[^)]*\))\]\([^)]*\)/gi, '$1')
  body = body.replace(/[ \t]*\{%\s*include\s+endmark\.html\s*%\}/g, () => '@@ENDMARK@@')
  if (body.includes('<div')) body = splitDivs(body)
  if (body.includes('<figure')) body = splitFigures(body)
  body = convertBlocks(body, where)
  body = convertCode(body)
  body = convertLists(body)
  body = convertTextileLinks(body)
  body = convertImages(body, where, images)
  body = convertLinks(body, where)
  // WordPress escaped the brackets of text that was never a link.
  body = body.replace(/\\\[([^\]\\\n[]*)\\\](?![([:])/g, '[$1]')
  // Textile's *strong* and _emphasis_ came out escaped; Joey wants them all <em>.
  body = body.replace(/(?<![\w\\])\\([*_])([^\s*_\\](?:[^*_\\\n]*[^\s*_\\])?)\\\1(?!\w)/g, '*$2*')
  body = body.replace(/(?<![[\\!])\[([^[\]\n]{1,60})\](?![([:])/g, (m, name) => autolinks[name] ? `[${name}](${autolinks[name]})` : m)
  body = body.replace(/[ \t]*@@ENDMARK@@/g, '{{endmark}}')
  body = body.replace(/(\d+)/g, (m, i) => images[i].replace(/^\s*@@ENDMARK@@$/, '{{endmark}}'))
  body = body.replace(/[ \t]*\{\{endmark\}\}/g, '{{endmark}}')
  body = restoreCode(body, stash)
  for (const m of body.matchAll(/\{%.*?%\}|<(object|embed|param|script|form|input)\b/g)) report.other.push(`${where}: ${m[0]}`)
  return body
}

// ─── 4. Write the posts ───

const KEY_ORDER = ['title', 'subtitle', 'date', 'author', 'categories', 'tags', 'id', 'guid', 'dsq_thread_id', 'enclosure']

function frontmatter (data) {
  const out = {}
  for (const key of KEY_ORDER) {
    const value = data[key]
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue
    out[key] = key === 'date' ? String(value) : typeof value === 'string' && (key === 'title' || key === 'subtitle') ? decodeEntities(value) : value
  }
  for (const key of Object.keys(data)) {
    if (!KEY_ORDER.includes(key) && key !== 'layout') report.other.push(`unknown frontmatter key "${key}"`)
  }
  return `---\n${stringify(out, { lineWidth: 0 })}---\n`
}

for (const post of posts) {
  const where = `${post.name}`
  const text = frontmatter(post.data) + '\n' + convertBody(post.content.trim(), where) + '\n'
  const target = at('post', post.year, `${post.name}.md`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
  fs.rmSync(post.file)
}

// ─── 5. Everything else ───

// Drafts keep their text; they aren't built.
if (fs.existsSync(at('_drafts'))) {
  for (const file of walk(at('_drafts'))) move(file, at('draft', path.basename(file)))
}

// Pages
if (fs.existsSync(at('about.md'))) {
  const { data, content } = parseFrontmatter(fs.readFileSync(at('about.md'), 'utf-8'))
  fs.rmSync(at('about.md'))
  fs.writeFileSync(at('About.md'), `---\n${stringify({ title: data.title ?? 'About' }, { lineWidth: 0 })}---\n\n${convertBody(content.trim(), 'About')}\n`)
}
if (fs.existsSync(at('404.html'))) {
  fs.writeFileSync(at('404.md'), '---\ntitle: Page not found\n---\n\nSorry, a page couldn’t be found at the address you requested.\n')
  fs.rmSync(at('404.html'))
}

// Images the site's own template uses stay in image/ with the rest.
for (const name of images) move(at('assets', 'images', name), at('image', name))
for (const name of ['avatar.png', 'endmark.png']) altText[name] ??= name === 'avatar.png' ? 'Joey Day' : ''
for (const [name, source] of recovered) {
  fs.mkdirSync(at('image'), { recursive: true })
  fs.copyFileSync(source, at('image', name))
  images.add(name)
  altText[name] ??= ''
}
for (const name of images) altText[name] ??= ''

// Hand-written HTML pages and their media are copied to the site as they are.
for (const dir of ['resume', 'supercut', 'docs']) {
  if (fs.existsSync(at(dir))) move(at(dir), at('static', dir))
}

// The files Jekyll needed and bgen doesn't.
for (const gone of ['_config.yml', '_includes', '_layouts', '_sass', '_posts', '_drafts', '_site', 'assets', 'Gemfile', 'Gemfile.lock', 'index.html', 'CNAME']) {
  fs.rmSync(at(gone), { recursive: true, force: true })
}
fs.writeFileSync(at('.gitignore'), '.DS_Store\n')

fs.mkdirSync(at('partial'), { recursive: true })
fs.writeFileSync(at('partial', 'endmark.md'), '&nbsp;<img src="/assets/images/endmark.png" class="endmark">\n')
const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
if (!fs.existsSync(at('abbreviations.json'))) fs.writeFileSync(at('abbreviations.json'), '{}\n')
if (!fs.existsSync(at('initials.json'))) fs.writeFileSync(at('initials.json'), '{}\n')
fs.writeFileSync(at('alt-text.json'), JSON.stringify(sortKeys(altText), null, 2) + '\n')

// ─── 6. Report ───

const section = (title, items) => {
  if (items.length === 0) return
  console.log(`\n## ${title} (${items.length})`)
  for (const item of items) console.log(`- ${item}`)
}
console.log(`Converted ${posts.length} posts.`)
section('Files renamed to match the post date', report.renamed)
section('Images the posts use that are not in image/', [...report.missingImages].map(([name, wheres]) => `${name}: ${[...new Set(wheres)].join(', ')}`))
section('Links to this site that matched no post', report.unresolvedLinks)
section('Images kept as HTML because of a class', report.htmlImages)
section('Images on other sites (they stay as they are)', report.remoteImages)
section('Images with no alt text', report.noAlt)
section('Other things to look at', report.other)
