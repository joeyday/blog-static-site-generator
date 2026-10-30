import { parse } from 'yaml'

// ─── Frontmatter ───
// Splits a leading `---` YAML block off a Markdown file. No frontmatter means
// empty data and the whole text as content.

// An optional BOM, the opening fence, the YAML (possibly empty), the closing
// fence and the line break after it.
const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

const OPENING_FENCE = /^\uFEFF?---[ \t]*\r?\n/

export function parseFrontmatter (text) {
  const match = FRONTMATTER.exec(text)
  if (!match) {
    if (OPENING_FENCE.test(text)) throw new Error('frontmatter is never closed')
    return { data: {}, content: text }
  }
  const data = parse(match[1] ?? '') ?? {}
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('frontmatter must be a set of key: value pairs')
  }
  return { data, content: text.slice(match[0].length) }
}
