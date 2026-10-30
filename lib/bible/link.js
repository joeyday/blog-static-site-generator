// ─── Turning references into links ───
// renderBibleLinks rewrites a run of plain text, linking the references that
// scanBibleRefs found in it.

function buildReflyUrl (
  cwms,
  chapter,
  verseStart,
  rangeVal,
  endVerse,
  endChapter,
  translation = 'ESV'
) {
  // rangeVal = endVerse (same-chapter) or endChapter (cross-chapter verse ref)
  // endVerse = undefined (same-chapter) or the end verse (cross-chapter)
  // endChapter = end chapter for chapter-only ranges (no verse)
  // URL: https://ref.ly/{cwms}{chapter}[.{verse}[-{endVerse}|{endChapter}.{endVerse}]|[-{endChapter}]];{translation}
  let ref = `${cwms}${chapter}`
  if (verseStart) {
    ref += `.${verseStart}`
    if (rangeVal) {
      if (endVerse) {
        // Cross-chapter: rangeVal is end chapter, endVerse is end verse
        ref += `-${rangeVal}.${endVerse}`
      } else {
        // Same-chapter: rangeVal is end verse
        ref += `-${rangeVal}`
      }
    }
  } else if (endChapter) {
    // Chapter-only range, e.g. "Romans 1–2" → Ro1-2
    ref += `-${endChapter}`
  }
  return `https://ref.ly/${ref};${translation}`
}

function makeBibleRefLink (url, rawText) {
  let lt = rawText.replace(/\s/g, '\u00a0')
  lt = lt.replace(/(\d)\s*[-\u2014]\s*(\d)/g, '$1\u2013$2')
  return `<a href="${url}" class="external bible-ref" target="_blank" rel="noopener noreferrer">${lt}</a>`
}

const TRAILING_TRANSLATION_RE = /(<\/a>)\s+(ESV|KJV|NASB|NIV|NKJV|NLT|NRSV)\b/g

export function renderBibleLinks (text, items) {
  if (items.length === 0) return text
  let result = ''
  let pos = 0
  for (const item of items) {
    result += text.slice(pos, item.start)
    if (item.optOut) {
      // Show the text without the leading "!"
      result += text.slice(item.start + 1, item.end)
    } else {
      const url = buildReflyUrl(
        item.cwms,
        item.chapter,
        item.verseStart,
        item.rangeVal,
        item.endVerse,
        item.endChapter,
        item.translation
      )
      result += makeBibleRefLink(url, item.display ?? text.slice(item.start, item.end))
    }
    pos = item.end
  }
  result += text.slice(pos)
  // Move each trailing translation abbreviation inside the preceding closing </a>
  // e.g. "3:1–4</a> KJV" → "3:1–4 KJV</a>"
  return result.replace(TRAILING_TRANSLATION_RE, ' $2$1')
}
