import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BUILD_JS = fileURLToPath(new URL('../build.js', import.meta.url))

// What every build needs: the three JSON maps.
const BASE = {
  'abbreviations.json': JSON.stringify({ ESV: 'English Standard Version', 'U.S.': 'United States', KJV: 'King James Version' }),
  'initials.json': JSON.stringify({ 'R.C. Sproul': 'Robert Charles Sproul' }),
  'alt-text.json': JSON.stringify({ 'photo.png': 'A photo', 'avatar.png': 'Joey' }),
  'image/avatar.png': 'x'
}

// Builds a scratch vault (BASE plus `files`; a value of null removes a base file) with the
// real generator, in its own working directory like the real build. Resolves to
// { code, output, read(url), exists(url), cleanup() }; `output` is stdout and stderr together.
export async function buildVault (files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bgen-test-'))
  const vault = path.join(root, 'vault')
  const dist = path.join(root, 'dist')
  for (const [name, data] of Object.entries({ ...BASE, ...files })) {
    if (data === null) continue
    const file = path.join(vault, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, data)
  }
  let code = 0
  let output = ''
  try {
    const result = await run('node', [BUILD_JS], { cwd: vault, env: { ...process.env, BGEN_OUT: dist, GITHUB_SHA: 'abcdef0' } })
    output = result.stdout + result.stderr
  } catch (err) {
    code = err.code
    output = (err.stdout ?? '') + (err.stderr ?? '')
  }
  // A page is <url>index.html, except /404/, which is 404.html.
  const fileFor = (url) => url === '/404/' ? path.join(dist, '404.html') : url.endsWith('/') ? path.join(dist, url, 'index.html') : path.join(dist, url)
  return {
    code,
    output,
    read: (url) => fs.readFile(fileFor(url), 'utf-8'),
    exists: (url) => fs.access(fileFor(url)).then(() => true, () => false),
    cleanup: () => fs.rm(root, { recursive: true, force: true })
  }
}
