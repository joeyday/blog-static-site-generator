import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVault } from './helpers.js'

// Each test builds a tiny scratch vault with the real generator and checks that the build
// passes or fails for the right reason. A failing build exits non-zero and prints
// "Build failed: <what is wrong>".

const builds = []
const build = async (files) => {
  const result = await buildVault(files)
  builds.push(result)
  return result
}
after(() => Promise.all(builds.map((b) => b.cleanup())))

const page = (body, data = '') => `---\ntitle: T\n${data}---\n${body}\n`
const post = (body, { title = 'T', date = '2004-10-03T23:38:55+00:00', extra = '' } = {}) =>
  `---\ntitle: ${title}\ndate: '${date}'\n${extra}---\n${body}\n`

function assertFails (result, pattern) {
  assert.notEqual(result.code, 0, `expected the build to fail:\n${result.output}`)
  assert.match(result.output, /Build failed:/)
  assert.match(result.output, pattern)
}

describe('posts', { concurrency: true }, () => {
  test('a post lives at its date and slug, shows its header, and links to the home page', async () => {
    const b = await build({ 'post/2004/2004-10-03-towards-parity.md': post('Text.', { title: 'Towards Parity', extra: 'subtitle: A sub\nauthor: Stuart\n' }) })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/2004/10/03/towards-parity/')
    assert.match(html, /<h1><a [^>]*href="\/2004\/10\/03\/towards-parity\/"[^>]*>Towards Parity<\/a><\/h1>/)
    assert.match(html, /<div class="subtitle">A sub<\/div>/)
    assert.match(html, /By guest author Stuart/)
    assert.match(html, /<time datetime="2004-10-03T23:38:55\.000Z">Sunday, October 3, 2004<\/time>/)
    assert.match(await b.read('/'), /Towards Parity/)
  })

  test('the address comes from the date, which the file name must agree with', async () => {
    assertFails(await build({ 'post/2004-10-04-x.md': post('x') }), /file name says 2004-10-04 but its date is/)
    assertFails(await build({ 'post/x.md': post('x') }), /file name is YYYY-MM-DD-slug\.md/)
    assertFails(await build({ 'post/2004-10-03-x.md': '---\ntitle: T\n---\nx\n' }), /needs a "date"/)
    assertFails(await build({ 'post/2004-10-03-x.md': '---\ndate: 2004-10-03\n---\nx\n' }), /needs a "title"/)
  })

  test('a bare day is midnight UTC, and a post can link another by file name or title', async () => {
    const b = await build({
      'post/2004-10-03-a.md': post('See [[2004-10-04-b]] and [[Bee]].', { date: '2004-10-03' }),
      'post/2004-10-04-b.md': post('Text.', { title: 'Bee', date: '2004-10-04' })
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/2004/10/03/a/')
    assert.equal(html.match(/href="\/2004\/10\/04\/b\/"/g).length, 2)
  })

  test('a wikilink to no post, or to a title two posts share, fails the build', async () => {
    assertFails(await build({ 'post/2004-10-03-a.md': post('[[Nowhere]]') }), /\[\[Nowhere\]\] matches no page/)
    assertFails(await build({
      'post/2004-10-03-a.md': post('[[Same]]', { title: 'Same' }),
      'post/2004-10-04-b.md': post('x', { title: 'Same', date: '2004-10-04' })
    }), /title of more than one page/)
  })

  test('a title can opt out of the all-caps check; the tab and the feed show it plain', async () => {
    const b = await build({ 'post/2002-03-05-a.md': post('x', { title: "'!ANNOUNCEMENT'", date: '2002-03-05' }) })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/2002/03/05/a/')
    assert.match(html, /<title>ANNOUNCEMENT ‹ Joey Day<\/title>/)
    assert.match(html, /<a [^>]*>ANNOUNCEMENT<\/a><\/h1>/)
    assert.match(await b.read('/feed.xml'), /<title type="html">ANNOUNCEMENT<\/title>/)
  })

  test('a draft is not built', async () => {
    const b = await build({ 'draft/idea.md': 'not a page' })
    assert.equal(b.code, 0, b.output)
    assert.equal(await b.exists('/idea/'), false)
  })
})

describe('the home page and feed', { concurrency: true }, () => {
  const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    return [`post/2010-01-${day}-p${i + 1}.md`, post(`Body ${i + 1}.`, { title: `Post ${i + 1}`, date: `2010-01-${day}` })]
  }))

  test('the newest five posts are on the home page, the rest on /page/2/, newest first', async () => {
    const b = await build(many(7))
    assert.equal(b.code, 0, b.output)
    const home = await b.read('/')
    assert.ok(home.indexOf('Post 7') < home.indexOf('Post 3'))
    assert.doesNotMatch(home, /Post 2</)
    assert.match(home, /class="older internal" href="\/page\/2\/"/)
    const second = await b.read('/page/2/')
    assert.match(second, /Post 2/)
    assert.match(second, /class="newer internal" href="\/"/)
    assert.doesNotMatch(second, /class="older/)
  })

  test('a post is cut at <!--more--> on the home page, with a link to the rest', async () => {
    const b = await build({ 'post/2010-01-01-a.md': post('First.\n\n<!--more-->\n\nSecond.', { date: '2010-01-01' }) })
    assert.equal(b.code, 0, b.output)
    const home = await b.read('/')
    assert.match(home, /First\./)
    assert.doesNotMatch(home, /Second\./)
    assert.match(home, /Continue reading “T” ›/)
    assert.match(await b.read('/2010/01/01/a/'), /Second\./)
    assert.match(await b.read('/feed.xml'), /Second\./)
  })

  test('the feed is Atom with absolute links and the old entry ids', async () => {
    const b = await build({ 'post/2010-01-01-a.md': post('See [x](/y/) and ![[photo.png]].', { date: '2010-01-01', extra: 'categories: [essay]\n' }), 'image/photo.png': 'x' })
    assert.equal(b.code, 0, b.output)
    const feed = await b.read('/feed.xml')
    assert.match(feed, /<id>https:\/\/joeyday\.com\/2010\/01\/01\/a<\/id>/)
    assert.match(feed, /href=&quot;https:\/\/joeyday\.com\/y\/&quot;/)
    assert.match(feed, /<category term="essay"\/>/)
  })
})

describe('pages and static files', { concurrency: true }, () => {
  test('a page lives at its file name, 404 is 404.html, static/ is copied as it is', async () => {
    const b = await build({ 'About.md': page('Text.'), '404.md': page('Gone.'), 'static/resume/index.html': '<p>résumé</p>', 'static/robots.txt': 'x' })
    assert.equal(b.code, 0, b.output)
    assert.ok(await b.exists('/about/'))
    assert.ok(await b.exists('/404/'))
    assert.equal(await b.read('/resume/'), '<p>résumé</p>')
    assert.ok(await b.exists('/robots.txt'))
  })

  test('a static name that a page or the site already uses fails the build', async () => {
    assertFails(await build({ 'About.md': page('x'), 'static/about/index.html': 'x' }), /static\/about collides/)
    assertFails(await build({ 'static/2010/x.html': 'x' }), /static\/2010 collides/)
  })

  test('images are served from /assets/images/', async () => {
    const b = await build({ 'About.md': page('![[photo.png]]'), 'image/photo.png': 'x' })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/about/'), /src="\/assets\/images\/photo\.png" alt="A photo"/)
    assert.ok(await b.exists('/assets/images/photo.png'))
  })
})

describe('the pipeline', { concurrency: true }, () => {
  test('a Scripture reference links, a ! opts one out, one that cannot exist fails', async () => {
    const b = await build({ 'A.md': page('See John 3:16 KJV and !Romans 17.') })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/a/')
    assert.match(html, /href="https:\/\/ref\.ly\/Jn3\.16;KJV"/)
    assert.match(html, /Romans 17\./)
    assertFails(await build({ 'A.md': page('See Romans 17.') }), /Romans has 16 chapters/)
  })

  test('abbreviations, initials, Roman numerals and divine names are wrapped', async () => {
    const b = await build({ 'A.md': page('R.C. Sproul on chapter XXVII in the U.S.; the LORD, in the ESV.') })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/a/')
    assert.match(html, /<abbr title="Robert Charles Sproul">R\.C\.<\/abbr>/)
    assert.match(html, /<abbr title="United States">U\.S\.<\/abbr>/)
    assert.match(html, /<span class="roman-num">XXVII<\/span>/)
    assert.match(html, /<span class="divine-name"><span class="divine-name-initial">L<\/span>ORD<\/span>/)
    assert.match(html, /<abbr title="English Standard Version">ESV<\/abbr>/)
  })

  test('an unexplained all-caps word, or initials, or an image fail the build', async () => {
    assertFails(await build({ 'A.md': page('NASA') }), /NASA is not in abbreviations\.json/)
    assertFails(await build({ 'A.md': page('J.K. Rowling') }), /initials "J\.K\." need an entry/)
    assertFails(await build({ 'A.md': page('![[other.png]]'), 'image/other.png': 'x' }), /other\.png has no entry in alt-text\.json/)
  })

  test('a post is checked once, not again for the home page and the feed', async () => {
    const b = await build({ 'post/2010-01-01-a.md': post('NASA', { date: '2010-01-01' }) })
    assert.equal(b.output.match(/NASA is not in/g).length, 1)
  })

  test('a partial takes arguments, and the endmark is one', async () => {
    const b = await build({
      'partial/greet.md': 'Hello {{1}}',
      'partial/endmark.md': '&nbsp;<img src="/assets/images/avatar.png" class="endmark">',
      'A.md': page('{{greet|Joey}}{{endmark}}')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/a/'), /Hello Joey\u00a0<img [^>]*class="endmark"/)
    assertFails(await build({ 'A.md': page('{{nope}}') }), /partial "nope" not found/)
  })
})

test('a slug that is not safe in a URL fails the build', async () => {
  assertFails(await buildVault({ 'Bad.md': '---\nslug: a/b\n---\nx\n' }).then((r) => { builds.push(r); return r }), /can't be a slug/)
})
