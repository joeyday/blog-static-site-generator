import fs from 'fs/promises'
import path from 'path'
import slugify from 'slugify'
import { BuildError } from './errors.js'
import { parseFrontmatter } from './frontmatter.js'
import { mapLimit } from './io.js'

// Reading the vault (the working directory):
//   post/      the blog posts, <anywhere>/YYYY-MM-DD-slug.md
//   partial/   named snippets (see partials.js), never pages
//   image/     pictures, copied flat to <output>/assets/images/
//   static/    copied as it is to the root of the output (the résumé, the supercut, CNAME …)
//   draft/     unfinished posts; left alone
// Any other Markdown file is a page (About, 404).

const SKIP_DIRS = new Set(['node_modules', 'dist', 'post', 'partial', 'image', 'static', 'draft'])

// Markdown that sits beside the content but is never a page. Compared in lowercase, since
// the vault sits on a case-insensitive filesystem.
const NEVER_PAGES = new Set(['claude.md', 'plan.md', 'readme.md'])

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif'])

export const IMAGE_URL = '/assets/images'

const slugOf = (text) => slugify(text, { lower: true, strict: true })

// A slug is one segment of a URL path. These names are the site's own folders.
// (Two old posts have a ’ in theirs, which their addresses keep.)
const SLUG_RE = /^[\p{L}\p{N}_~*!$()+,;:@=’-][\p{L}\p{N}_.~*!$()+,;:@=’-]*$/u
const RESERVED_SLUGS = new Set(['assets', 'asset', 'page', 'feed.xml'])

const POST_RE = /^(\d{4})-(\d\d)-(\d\d)-(.+)\.md$/
const DATE_RE = /^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d))?$/

async function findFiles (dir, keep, root = dir, skip = SKIP_DIRS) {
  const found = []
  // readdir order is up to the filesystem; sort so output doesn't depend on it.
  const entries = (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
  for (const entry of entries) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !skip.has(entry.name)) found.push(...await findFiles(file, keep, root, skip))
    } else if (entry.isFile() && keep(entry.name)) {
      // iCloud leaves ".Name.md.icloud" for a file that isn't downloaded.
      found.push(file)
    } else if (entry.name.endsWith('.icloud')) {
      throw new BuildError(`"${file}" isn't downloaded from iCloud; download it and build again`)
    }
  }
  return found
}

const isTextList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')

// Frontmatter keys are lowercase (`Title:` would otherwise be silently ignored). The text
// keys must be text (a title may be a number, `title: 1984`).
function checkFrontmatter (data, filePath, isPost) {
  const problems = []
  for (const key of Object.keys(data)) {
    if (key !== key.toLowerCase()) problems.push(`"${filePath}": the frontmatter key "${key}" must be lowercase`)
  }
  for (const key of ['title', 'slug', 'description', 'subtitle', 'author', 'guid']) {
    if (typeof data[key] === 'number') data[key] = String(data[key])
    if (data[key] != null && typeof data[key] !== 'string') problems.push(`"${filePath}": "${key}" must be text`)
  }
  for (const key of ['categories', 'tags']) {
    if (data[key] != null && !isTextList(data[key])) problems.push(`"${filePath}": "${key}" must be a list of text`)
  }
  if (typeof data.slug === 'string' && (!SLUG_RE.test(data.slug) || RESERVED_SLUGS.has(data.slug))) {
    problems.push(`"${filePath}": "${data.slug}" can't be a slug; use letters, digits and . _ - ~ * ! $ ( ) + , ; : @ = only, and not ${[...RESERVED_SLUGS].join(', ')}`)
  }
  if (isPost && data.slug != null) problems.push(`"${filePath}": a post's slug is its file name; remove "slug"`)
  if (isPost && typeof data.title !== 'string') problems.push(`"${filePath}": a post needs a "title"`)
  if (isPost && !DATE_RE.test(String(data.date ?? ''))) {
    problems.push(`"${filePath}": a post needs a "date" like 2004-10-03 or 2004-10-03T23:38:55+00:00`)
  }
  if (data.hidden != null && typeof data.hidden !== 'boolean') problems.push(`"${filePath}": "hidden" must be true or false`)
  return problems
}

// Copies image/ flat into <outputDir>/assets/images/. Two files with one name would overwrite
// each other, so that fails the build. Returns the image map: lowercase name → URL.
async function copyImages (outputDir) {
  const files = await findFiles('image', (name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()), 'image')
  const imageMap = {}
  const seen = new Map()
  for (const file of files) {
    const name = path.basename(file).toLowerCase()
    if (seen.has(name)) throw new BuildError(`Two images are named "${path.basename(file)}": "${seen.get(name)}" and "${file}"; image names are flat, so each must be unique`)
    seen.set(name, file)
    imageMap[name] = `${IMAGE_URL}/${path.basename(file)}`
  }
  if (files.length > 0) await fs.mkdir(path.join(outputDir, 'assets', 'images'), { recursive: true })
  await mapLimit(files, (file) => fs.copyFile(file, path.join(outputDir, 'assets', 'images', path.basename(file))))
  return imageMap
}

// static/ goes to the root of the output as it is. Its top-level names must not collide with
// the generated ones (a year, `page`, `assets`, `feed.xml`, or a page's slug).
async function copyStatic (outputDir, taken) {
  const entries = await fs.readdir('static', { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (taken.has(entry.name) || /^\d{4}$/.test(entry.name)) {
      throw new BuildError(`static/${entry.name} collides with a generated address (/${entry.name}/)`)
    }
  }
  if (entries.length > 0) await fs.cp('static', outputDir, { recursive: true })
}

// A post's date is the `date` in its frontmatter (the way Jekyll read it), as an instant;
// a bare day is midnight UTC. Its address and the dates shown are in UTC.
const pad = (n) => String(n).padStart(2, '0')

// Reads the whole vault. A page is { name, filePath, title, slug, url, data, content }; a post
// is a page with `isPost`, `date` (a Date), and `day` ('YYYY-MM-DD', its UTC day).
//   posts     newest first
//   pages     the other pages
//   byName    lowercase file name → page or post, for wikilinks
//   byTitle   lowercase title → page or post, or null where two share a title
//   partials  lowercase name → text
export async function loadVault ({ outputDir }) {
  const imageMap = await copyImages(outputDir)

  const partials = {}
  for (const file of await findFiles('partial', (name) => name.endsWith('.md'))) {
    partials[path.basename(file, '.md').toLowerCase()] = (await fs.readFile(file, 'utf-8')).trim()
  }

  const problems = []
  const read = async (file, isPost) => {
    const filePath = path.relative('.', file)
    let parsed
    try {
      parsed = parseFrontmatter(await fs.readFile(file, 'utf-8'))
    } catch (err) {
      problems.push(`Bad frontmatter in "${filePath}": ${err.message}`)
      return null
    }
    problems.push(...checkFrontmatter(parsed.data, filePath, isPost))
    return { filePath, data: parsed.data, content: parsed.content }
  }

  const postFiles = await findFiles('post', (name) => name.endsWith('.md'), 'post', new Set())
  const posts = await mapLimit(postFiles, async (file) => {
    const base = path.basename(file)
    const m = POST_RE.exec(base)
    const parsed = await read(file, true)
    if (!parsed) return null
    if (!m) {
      problems.push(`"${parsed.filePath}": a post's file name is YYYY-MM-DD-slug.md`)
      return null
    }
    const [, year, month, day, name] = m
    const date = new Date(/T/.test(String(parsed.data.date)) ? String(parsed.data.date) : `${parsed.data.date}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return null
    const utcDay = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    if (utcDay !== `${year}-${month}-${day}`) {
      problems.push(`"${parsed.filePath}": its file name says ${year}-${month}-${day} but its date is ${parsed.data.date} (${utcDay} UTC); the address comes from the date, so they must agree`)
      return null
    }
    if (!SLUG_RE.test(name) || RESERVED_SLUGS.has(name)) {
      problems.push(`"${parsed.filePath}": "${name}" can't be a slug`)
      return null
    }
    return {
      ...parsed,
      isPost: true,
      name: base.slice(0, -3),
      title: parsed.data.title,
      slug: name,
      date,
      day: utcDay,
      url: `/${year}/${month}/${day}/${name}/`
    }
  })

  const pageFiles = await findFiles('.', (name) => name.endsWith('.md') && !NEVER_PAGES.has(name.toLowerCase()))
  const pages = await mapLimit(pageFiles, async (file) => {
    const parsed = await read(file, false)
    if (!parsed) return null
    const name = path.basename(file, '.md')
    const slug = parsed.data.slug || slugOf(name)
    if (!slug) problems.push(`"${parsed.filePath}" has no usable slug; its name has no letters or digits (add a slug in its frontmatter)`)
    return { ...parsed, name, title: parsed.data.title || name, slug, url: `/${slug}/` }
  })
  if (problems.length > 0) throw new BuildError(problems.join('\n'))

  const live = [...posts, ...pages].filter((page) => page && !page.data.hidden)
  const byUrl = new Map()
  const byName = new Map()
  const byTitle = new Map()
  for (const page of live) {
    const clash = byUrl.get(page.url)
    if (clash) throw new BuildError(`"${page.filePath}" and "${clash.filePath}" both have the address ${page.url}; give one a slug in its frontmatter or change its file name`)
    byUrl.set(page.url, page)
    const nameClash = byName.get(page.name.toLowerCase())
    if (nameClash) throw new BuildError(`"${page.filePath}" and "${nameClash.filePath}" have the same file name; wikilinks need names to be unique`)
    byName.set(page.name.toLowerCase(), page)
    const title = page.title.toLowerCase()
    byTitle.set(title, byTitle.has(title) ? null : page)
  }

  await copyStatic(outputDir, new Set(['assets', 'asset', 'page', 'feed.xml', ...live.filter((p) => !p.isPost).map((p) => p.slug)]))

  return {
    posts: live.filter((p) => p.isPost).toSorted((a, b) => b.date - a.date || (a.name < b.name ? 1 : -1)),
    pages: live.filter((p) => !p.isPost),
    byName,
    byTitle,
    partials,
    imageMap
  }
}

export { slugOf }
