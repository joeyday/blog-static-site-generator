# Decisions

Settled questions, so they aren't re-litigated. Each says who decided and when.

## Scope
- **The tool is `bgen`** (Joey, 2026-10-29), built on `pgen`'s copy of the tsgen pipeline, not tsgen's (no book, notes pages, hyphenation or PDF). Work happens directly on `main` until the first release.
- **A bespoke unitasker; code is copied, not shared** (Joey, 2026-10-29), as for pgen.
- **Content conforms to the generator** (Joey, 2026-10-29). Anything Jekyll or WordPress left in the posts that bgen doesn't read is migrated by `scripts/convert-jekyll.js`, not supported.
- **Failures are loud for the whole archive** (Joey, 2026-10-29). The cleanup of 2002–2023 posts may take a while and no new build can be published until it is done; that is accepted.
- **Everything the Jekyll site did stays**: home page (5 per page, `/page/N/`), `/feed.xml`, About, 404, the résumé, supercut and docs pages, the head links (`rel="me"`, Typekit). Dropped because they were already dead: Disqus (the config never set a shortname, so the include never rendered) and Google Analytics (commented out in the config).
- **`layout` is gone from the frontmatter** (2026-10-29): all 561 posts said `layout: post`. The "lifestream" layouts Joey once used are not in the vault; recovering them (archive.org) is open work, and a `layout:` key can return then.

## Addresses
- **Permalinks are the Jekyll ones** (Joey, 2026-10-29): `/YYYY/MM/DD/slug/`, the date being the post's `date` in UTC (Jekyll's way), so two posts whose file name disagreed with their date were renamed. The slugs with a ’ in them (two posts) are kept. The build fails if a file name and its date disagree.
- **Images stay at `/assets/images/`** (2026-10-29), flat, from the vault's `image/`. WordPress's `wp-content/uploads/YYYY/MM/name` images are named `YYYY-MM-name` there, since the names weren't unique.
- **The feed is Atom at `/feed.xml`**, the ten newest posts in full, entry ids as jekyll-feed made them (`https://joeyday.com/YYYY/MM/DD/slug`, no trailing slash). The post `guid` and `id` are kept in frontmatter but not used.

## Content
- **Posts link to posts with wikilinks, and embed images with `![[…]]`** (Joey, 2026-10-29). A wikilink resolves by file name, else by title (unless two pages share it).
- **The end mark is a partial for now** (2026-10-29): `{{endmark}}`, which the migration put in place of the `include` and of the image. A cleverer way to place it is open (see `plan.md`).
- **Initials that aren't a person's** (`U.S.`, `D.C.`, `A.D.`) go in `abbreviations.json`, not `initials.json` (Joey, 2026-10-29), as always.
- **Wrapper divs and one-line figures get blank lines round their tags** (2026-10-29): `<div class="lpic">…</div>`, `<figure>…<figcaption>…</figcaption></figure>` and the paragraph after them, because markdown-it reads a block-tag line as HTML to its end and the Markdown inside (links, `![[…]]`) never rendered. An image embed inside a `<figure>` stays inline rather than becoming a second figure.
- **The old AutoLinker's `[Name]` became ordinary links** (Joey, 2026-10-29): 65 in the posts, from the plugin's table (`scripts/autolinks.json`); the feature itself is not kept. SyntaxHighlighter's `[code language="…"]` in the two ServiceNow posts became fenced blocks, with the exact code read back from the WordPress dump (the export had made its quotes curly).
- **WP-Footnotes' `((note))` became Markdown footnotes** (2026-10-29): 74 in 43 posts, `[^n]` where each stood and its `[^n]:` text at the end of the post. The generator writes the Notes heading.
- **Emphasis is `<em>`** (Joey, 2026-10-29): Textile's `_like this_` and `*like this*`, which the WordPress export had left escaped (`\_like this\_`), became `*like this*`. Nothing is strong.
- **A picture on its own line gets blank lines round its `<figure>`** (2026-10-29), so the text on the next line is Markdown again.
- **`{% highlight %}` became a fenced block.** There is no syntax highlighting yet.

- **A title may opt a word out with `!`** (2026-10-29): `title: '!ANNOUNCEMENT'` (quoted, since YAML reads a bare `!` as a tag). The page's heading is checked like any text; the `<title>`, link previews and feed show the title without the `!`.
- **The WordPress comments are not kept** (Joey, 2026-10-29); the backup has them. The WordPress drafts were put in `draft/` for Joey to keep or delete.
- **A bare number after a semicolon is a chapter** (2026-10-30, from pgen and tsgen): `Heb 4:2; 11` is Heb 4:2 and all of Heb 11; after a comma it is a verse, `Heb 4:2, 11`. A chapter the book doesn't have fails the build.
- **Dead links inside the site stay as they are for now** (Joey, 2026-10-29).

## Look
- **Captions hang in the margin when the window is at least 75em wide** (2026-10-29), as on the Jekyll site: the figure's caption sits beside it (left, or right for `alignright`), above that width it stays under the picture.
- **The old look is kept, rewritten** (Joey, 2026-10-29): the orange masthead with the avatar, blue uppercase titles, Typekit's Meta fonts and Mr Eaves, 22px text that scales with the window below that, in modern CSS with OKLCH variables; a dark theme follows the system.
