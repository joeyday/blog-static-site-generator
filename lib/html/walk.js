// One tag-by-tag walk over an HTML string, shared by every post-pass.
//
// It splits the string into tags and the text between them, and keeps a stack
// of the "skip" tags currently open (for example <code>), so passes can leave
// those regions alone. It is a tokenizer, not a parser: a ">" inside an
// attribute value ends the tag early.

// Comments, CDATA, and opening/closing/self-closing tags (group 1 = tag name).
const TAG_SRC =
  '<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<\\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>'

// Calls onText(text, skipped) for each run of text, then onTag(tagName, tagFull)
// for the tag after it. skipped is true while inside one of skipTags. tagName is
// lowercase, or null for a comment or CDATA section. onTag runs before the skip
// stack is updated for that tag.
export function walkHtml (html, skipTags, { onText, onTag }) {
  const TAG_RE = new RegExp(TAG_SRC, 'g')
  const skipStack = []
  let lastIndex = 0
  let m
  while ((m = TAG_RE.exec(html)) !== null) {
    const tagFull = m[0]
    const tagName = m[1] ? m[1].toLowerCase() : null
    const before = html.slice(lastIndex, m.index)
    if (before) onText(before, skipStack.length > 0)
    onTag(tagName, tagFull)

    if (tagName && skipTags.has(tagName)) {
      if (tagFull.startsWith('</')) {
        if (skipStack.length > 0 && skipStack[skipStack.length - 1] === tagName) {
          skipStack.pop()
        }
      } else if (!tagFull.endsWith('/>')) {
        skipStack.push(tagName)
      }
    }
    lastIndex = m.index + tagFull.length
  }
  const tail = html.slice(lastIndex)
  if (tail) onText(tail, skipStack.length > 0)
}

// Returns html with fn applied to every text run outside skipTags. onTag, if
// given, sees each tag too (see walkHtml).
export function mapText (html, skipTags, fn, onTag) {
  const out = []
  walkHtml(html, skipTags, {
    onText: (text, skipped) => out.push(skipped ? text : fn(text)),
    onTag: (tagName, tagFull) => {
      onTag?.(tagName, tagFull)
      out.push(tagFull)
    }
  })
  return out.join('')
}
