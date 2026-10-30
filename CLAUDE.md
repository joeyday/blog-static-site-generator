# Joey's Blog Static Site Generator

A bespoke static site generator for Joey's blog (https://joeyday.com), which used to be built by Jekyll from an Obsidian vault (`~/Obsidian/Blog`). It turns a vault of dated Markdown posts into a GitHub Pages site: a home page of the newest posts, five at a time, the posts themselves at their old Jekyll addresses, an Atom feed, a few pages, and the hand-written pages (résumé, supercut, docs) passed through as they are.

It is a sibling of `../pgen` (the Papers generator) and `../tsgen` (Tota Scriptura), from which the Markdown pipeline was lifted: markdown-it and its plugins, partials, the Bible-reference linker, and the HTML post-passes (abbreviations, initials, Roman numerals, divine names, ellipses, alt text). Code was *copied*, not shared, and may drift on purpose.

## Working rules

- **A unitasker.** One site, hardcoded roles, names and frontmatter keys; no options or plugin hooks. Fewer lines, not more generality. Remove abstractions rather than adding them.
- **Failures are loud.** A broken wikilink, a missing partial or image, an unexplained all-caps word, initials or image, or a Scripture reference that can't exist fails the build, for the whole archive back to 2002. Cleaning the content up is the work, not loosening the checks.
- **The content conforms to the generator, not the other way round** (Joey). Syntax that Jekyll accepted and bgen doesn't gets migrated (`scripts/convert-jekyll.js`), not supported.
- Style is **JavaScript Standard Style**: `npm run fix` then `npm run lint`; `npm test` before committing. CSS is hand-written, with OKLCH colors as variables on `:root` and a dark theme that only redefines them.
- Only commit when asked. Never put content in this repo. `vault/` (gitignored) is a local copy for testing; otherwise test with scratch vaults in the scratchpad.

## Layout

- `build.js`: CLI (`bgen [build | serve]`) and the build. The vault is the working directory; output goes to `./dist` or `$BGEN_OUT` (use the scratchpad for test builds). Renders the posts and pages, the home pages, the feed.
- `lib/vault.js` (files → post and page records, images, `static/`), `lib/render.js` (partials → EJS → wikilinks → markdown-it), `lib/source.js`, `lib/partials.js`, `lib/markdown.js`, `lib/output.js` (the post-passes and the writer), `lib/layout.js`, `lib/html/` (the tag walker and passes), `lib/bible/` (reference table, scanner, linker, checks), `serve.js`/`lib/watch.js` (preview).
- `template/`: `layout.ejs`, `style.css`, the favicon. Copied to `/asset/` in the output.
- `scripts/convert-jekyll.js`: the one-time Jekyll → bgen migration (kept for the record).
- `docs/decisions.md`: settled questions. Record new decisions there. `docs/plan.md`: open work.

## The vault

- `post/YYYY/YYYY-MM-DD-slug.md`: a post. Frontmatter: `title`, `date` (a day, or a full timestamp with offset; the address and the dates shown are in UTC and must agree with the file name), and optionally `subtitle`, `author` (shown as "By guest author X" unless Joey), `categories`, `tags`, `description`, plus the WordPress leftovers `id`, `guid`, `dsq_thread_id`, `enclosure`. Address: `/YYYY/MM/DD/slug/`. A post is cut at `<!--more-->` on the home page.
- Any other Markdown file outside `post/`, `partial/`, `image/`, `static/`, `draft/` is a page (`About.md` is `/about/`; `404.md` is `/404.html`). `hidden: true` leaves a page or post out.
- `partial/name.md`: `{{name|arg}}` expands it (`{{1}}` is the first argument). `{{endmark}}` is the end mark.
- `image/`: pictures, flat, served from `/assets/images/` (the old address). Embed with `![[name.png]]` (`|300` or `|300x200` for a size); every image needs an entry in `alt-text.json`.
- `static/`: copied as it is to the site root (`resume/`, `supercut/`, `docs/`). `draft/`: not built.
- `abbreviations.json`, `initials.json` (a person's initials by `"R.C. Sproul"`; other initials like `U.S.` go in `abbreviations.json`), `alt-text.json`: all required.
- Links between posts are wikilinks: `[[2004-10-03-towards-parity|text]]`, or by title when it is unique.
- Scripture: abbreviations without a space for numbered books (`1Co`, `2Ti`); `!` opts a reference or all-caps word out.
