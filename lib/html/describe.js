// The description of a page for a link preview: its first paragraph with any text,
// as plain text trimmed to a whole word. Returns "" when there is none.
const MAX_LENGTH = 160

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }

export function describe (html) {
  for (const [, inner] of html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)) {
    const text = inner
      .replace(/<sup class="footnote-ref">[\s\S]*?<\/sup>/g, '') // "[1]" markers
      .replace(/<[^>]*>/g, '')
      .replace(/&(amp|lt|gt|quot|#39);/g, (m, name) => ENTITIES[name])
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue // an image-only paragraph, say
    if (text.length <= MAX_LENGTH) return text
    const cut = text.slice(0, MAX_LENGTH + 1).replace(/\s+\S*$/, '')
    return cut.replace(/[\s,;:.\-–—]+$/, '') + '…'
  }
  return ''
}
