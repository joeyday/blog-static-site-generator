# Plan

Open work only. When something is finished, delete it here; `decisions.md` records what is settled.

## Getting the archive to build (Joey, with Claude)

The migration has been run on the vault (uncommitted, in `~/Obsidian/Blog`; `git checkout . && git clean -fd -e .obsidian` undoes it). What still fails the build, to work through one at a time:

- [x] ~~Build fails on content~~: **the whole archive builds** (2026-10-29). The 48 `!` opt-outs (32 files) are worth skimming in the vault's diff; `Acts 17:38` (a commenter's slip for 17:28) was opted out rather than changing their words; a commenter's initials in "The Definition of Dichotomy" were reworded to "a commenter" at Joey's request.
- [ ] **Check `abbreviations.json` and `initials.json`**. The expansions come from the old WordPress plugin (`abbr.php`, kept where the posts use them), Joey's answers for `UPC` (Union Programming Council), `POP`, `EFS`, `ERAS`, `IHC`, `KSL`, `K-LOVE`, `CAIR` (Council on American–Islamic Relations) and `SLTS`, and about 110 Claude wrote from memory (`XP`, `GNU`, `ID`, `MO`, `US` vs `U.S.` …). The plugin's own entries include two that are wrong: `NASB` ("Version", is "Bible") and `PBS` ("System", is "Service"), and its capitalisation is inconsistent; decide whether to correct them.
- [ ] **Dead links inside the site** (`/contact`, `/computers`, `/friends`, `/archives/individual/000475.php`, `/to/lds-linker` …): about 50, listed by the migration. They stay as they are for now (they were already dead in WordPress: `/contact` and `/info` were drafts). Rewrite, point at archive.org, or remove, later.
- [ ] **Single-bracket text that was probably a link once**: `[Salt Lake Theological Seminary]` ("Testimony at SLTS"), `[Southeast Baptist Church]`, `[Wesley]`, `[the ancient American disciples]` and a few more aren't in the AutoLinker table, so they stay bracketed text. Link them or unbracket them. (The `[contact]` links the table made point at the dead `/contact`, with the other dead links.)
- [ ] **Links to `downloads.joeyday.com`** (14, the PDFs, `.reg` files and `.wmv`): that site is in the Rackspace backup; decide where the files live.
- [ ] **Old Flash embeds** (`<object>`, `<embed>`, `<param>`: about 20 posts) and the `<script>` embeds (Twitter widgets): replace or drop.
- [ ] **Alt text**: the migration kept what the posts had; empty ones are decorative until written. `blog_postmeta` (`_wp_attachment_image_alt`, 45) and the attachment titles (100) in the WordPress dump could fill some.
- [ ] Keep looking at posts in a browser. Checked so far (2026-10-29): home, rebuilt lists, images, code, floated figures, footnotes, dark and phone width. The `lpic`/`rpic`/`pic`/`filetile`/`donate` classes had no CSS in the theme; the styles in `template/style.css` are guesses. Not yet looked at: the About page, the résumé and supercut pass-throughs, `/page/2/`, the Flash-embed posts, print.

## WordPress drafts

- [ ] **Decide what to do with `draft/`**: 90 files were added from the Rackspace backup's WordPress dump, the 86 unpublished drafts (78 with text), the private post ("LDS Linker regression tests") and the draft pages, with their Textile roughly converted to Markdown (`wp_id`, `wp_status`, `wp_type` in the frontmatter). They aren't built. Delete any you don't want; the repo may become public. The WordPress-era comments (1,746) are not kept; Joey has the backup.

## Later

- [ ] **The end mark.** Placed automatically at the end of every post, but movable where it would land somewhere odd.
- [ ] **The résumé as Markdown** with its own stylesheet (a per-page layout), instead of the passed-through HTML. Same for the other `static/` pages.
- [ ] **Lifestream layouts**: dig through archive.org for what `layout:` used to mean.
- [ ] Syntax highlighting for fenced code (9 posts, one language).
- [ ] CI and GitHub rulesets (`.github/workflows/ci.yml` is pgen's), the content repo's deploy workflow, `joeyday.com` DNS.
- [ ] Old WordPress addresses (`/?p=123`) if the live site ever answered them.
