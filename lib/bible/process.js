import { walkHtml } from '../html/walk.js'
import { renderBibleLinks } from './link.js'
import { BLOCK_TAGS, SKIP_TAGS } from './refs.js'
import { scanBibleRefs } from './scan.js'
import { checkReference, referenceLabel } from './validate.js'

// ─── The Bible-reference pass ───
// One walk over a page's HTML finds the references in each text run (scan.js) and
// links them. Returns { html, problems }. A reference that can't exist (a chapter or
// verse its book doesn't have) is a problem, which the output turns into a build
// failure; a `!` opts a reference out.
export function processBibleRefs (html) {
  const out = []
  const problems = []
  const ctx = {
    lastCwms: null,
    lastChapter: null,
    chapterLevel: false,
    translation: 'ESV'
  }

  walkHtml(html, SKIP_TAGS, {
    onText (text, skipped) {
      // A reference needs a digit, and most text runs have none.
      if (skipped || !/\d/.test(text)) {
        out.push(text)
        return
      }
      const items = scanBibleRefs(text, ctx)
      for (const item of items) {
        if (item.optOut) continue
        const reason = checkReference(item)
        if (!reason) continue
        // A continuation ("71" after "Romans 12:1–15:13") says what it was read as.
        const written = text.slice(item.start, item.end)
        problems.push(
          item.named
            ? `"${written}": ${reason}`
            : `"${written}" (read as ${referenceLabel(item)}): ${reason}`
        )
      }
      out.push(renderBibleLinks(text, items))
    },
    onTag (tagName, tagFull) {
      out.push(tagFull)
      if (!tagName) return // HTML comment or CDATA
      // Continuation refs don't carry across a block boundary, or past an italic title
      // ("*Interpreter's Bible*, 12:293" is a page, not a verse)
      if (BLOCK_TAGS.has(tagName) || tagFull === '</em>' || tagFull === '</cite>') {
        ctx.lastCwms = null
        ctx.lastChapter = null
        ctx.chapterLevel = false
        ctx.translation = 'ESV'
      }
    }
  })

  return { html: out.join(''), problems }
}
