import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('../scripts/convert-jekyll.js', import.meta.url))

// A small Jekyll vault with one of each thing the migration has to change.
const JEKYLL = {
  '_config.yml': 'title: x\n',
  '_posts/2004/2004-10-03-towards-parity.md': `---
id: 90
title: Towards Parity
date: '2004-10-03T23:38:55+00:00'
author: Joey
layout: post
subtitle: ''
guid: 'http://www.joeyday.com/2004/10/03/towards-parity'
categories:
    - essay
---

I matched my former \\[Movable Type\\] blog \\_really\\_ ((A note (with parentheses) of its own.)).

\\# <del>Validate.</del>  
\\# Fix:  
\\*\\* Nested.  

See “Hivelogic”:http://www.hivelogic.com/a\\_b. And [a post](http://www.joeyday.com/2004/10/04/second/) or [again](/?p=91).

![A photo](http://joeyday.com/wp-content/uploads/2004/10/photo.png "Title") and ![](/assets/images/local.png) {% include endmark.html %}

{% highlight javascript %}
const a = \\[1];
{% endhighlight %}
`,
  '_posts/2004/2004-10-04-second.md': "---\nid: 91\ntitle: Second\ndate: '2004-10-04T01:00:00+00:00'\nlayout: post\n---\n\nText ![End mark](http://joeyday.com/wp-content/uploads/2009/08/endmark.png \"End mark\")\n",
  'assets/images/local.png': 'x',
  'about.md': '---\nlayout: page\ntitle: About\npermalink: /about/\n---\n\nAbout me.\n',
  'resume/index.html': '<p>résumé</p>'
}

test('the migration moves, rewrites and reports', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bgen-convert-'))
  try {
    for (const [name, data] of Object.entries(JEKYLL)) {
      await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true })
      await fs.writeFile(path.join(dir, name), data)
    }
    const { stdout } = await run('node', [SCRIPT, dir])
    const read = (name) => fs.readFile(path.join(dir, name), 'utf-8')
    const exists = (name) => fs.access(path.join(dir, name)).then(() => true, () => false)

    const post = await read('post/2004/2004-10-03-towards-parity.md')
    assert.doesNotMatch(post, /layout:|subtitle:/)
    assert.match(post, /^---\ntitle: Towards Parity\ndate: .*2004-10-03T23:38:55\+00:00/)
    assert.match(post, /blog \*really\*\[\^1\]\./)
    assert.match(post, /\n\[\^1\]: A note \(with parentheses\) of its own\./)
    assert.match(post, /\[Movable Type\]\(http:\/\/www\.movabletype\.org\)/)
    assert.match(post, /1\. <del>Validate\.<\/del>\n1\. Fix:\n {3}- Nested\./)
    assert.match(post, /\[Hivelogic\]\(http:\/\/www\.hivelogic\.com\/a_b\)\./)
    assert.match(post, /\[\[2004-10-04-second\|a post\]\]/)
    assert.match(post, /\[\[2004-10-04-second\|again\]\]/)
    assert.match(post, /!\[\[2004-10-photo\.png\]\]/)
    assert.match(post, /!\[\[local\.png\]\]\{\{endmark\}\}/)
    assert.match(post, /```javascript\nconst a = \\\[1\];\n```/)
    assert.match(await read('post/2004/2004-10-04-second.md'), /Text\{\{endmark\}\}/)

    const alt = JSON.parse(await read('alt-text.json'))
    assert.equal(alt['2004-10-photo.png'], 'A photo')
    assert.match(stdout, /2004-10-photo\.png: 2004-10-03-towards-parity/)

    assert.ok(await exists('image/local.png'))
    assert.ok(await exists('static/resume/index.html'))
    assert.match(await read('About.md'), /^---\ntitle: About\n---\n\nAbout me\./)
    assert.match(await read('partial/endmark.md'), /class="endmark"/)
    for (const gone of ['_config.yml', '_posts', 'assets', 'about.md.bak']) assert.equal(await exists(gone), false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
