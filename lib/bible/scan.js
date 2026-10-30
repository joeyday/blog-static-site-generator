import {
  BIBLE_REF_RE,
  CONT_REF_RE,
  LEADING_TRANS_RE,
  cwmsByName,
  oneChapterCwms
} from './refs.js'

// ─── Scanning a text run for references ───
// scanBibleRefs finds every reference in one run of plain text, once. The
// linker turns the result into links and the collector into Scripture-index
// entries, so the two can't disagree about what counts as a reference.

// A continuation ref that starts right here, after optional whitespace (sticky).
const CONT_AFTER_SPACE_RE = new RegExp(`\\s*${CONT_REF_RE.source}`, 'y')

// Pre-pass: build a map from each named-ref start index → translation abbreviation.
// A translation applies to a reference only when it follows the reference's chain
// directly: the named ref, its continuation refs ("; 5:1, 3"), then nothing but
// whitespace before the abbreviation ("Jn 3:16; 5:24 KJV"). Anything else between
// them, a word or punctuation, means the abbreviation isn't about this reference.
// ESV is the default.
function buildTranslationMap (text) {
  const map = new Map()

  BIBLE_REF_RE.lastIndex = 0
  const namedRefs = []
  let m
  while ((m = BIBLE_REF_RE.exec(text)) !== null) {
    if (m[1] !== '!') { namedRefs.push({ index: m.index, end: m.index + m[0].length }) }
  }

  for (const ref of namedRefs) {
    // Walk the chain of continuation refs under the same whitespace-only rule
    // as scanContinuations, to find where it ends.
    let pos = ref.end
    for (;;) {
      CONT_AFTER_SPACE_RE.lastIndex = pos
      const cont = CONT_AFTER_SPACE_RE.exec(text)
      if (!cont) break
      pos += cont[0].length
    }
    const trans = LEADING_TRANS_RE.exec(text.slice(pos))
    map.set(ref.index, trans ? trans[1] : 'ESV')
  }

  return map
}

// Continuation refs in `text`, the stretch of a run that starts at `offset`:
// the bare "5:1" and "7" after a named ref's "; " or ", ". Adds an item to
// `items` for each one that resolves, using and updating ctx.
//
// Strict chaining rule: the gap between the end of one ref (or the start of the
// text) and the opening separator of the next continuation ref must contain only
// whitespace.  Any non-whitespace character breaks the chain immediately and all
// remaining text is left alone.  This prevents distant numbers (e.g. a year in a
// timestamp like ", 20 April 2013") from being picked up as verses.
function scanContinuations (text, offset, ctx, items) {
  if (!ctx.lastCwms) return
  CONT_REF_RE.lastIndex = 0
  let pos = 0
  let m
  while ((m = CONT_REF_RE.exec(text)) !== null) {
    if (/\S/.test(text.slice(pos, m.index))) break

    const [match, sep, firstNum, verseStart, rangeVal, endVerse, bareRangeEnd] =
      m
    pos = m.index + match.length
    let ref
    if (verseStart !== undefined) {
      // Branch A: chapter:verse format — firstNum is the chapter
      // A bare verse after a run across chapters belongs to the chapter it ended in.
      ctx.lastChapter = endVerse !== undefined ? rangeVal : firstNum
      ctx.chapterLevel = false
      ref = { chapter: firstNum, verseStart, rangeVal, endVerse }
      // In a book of one chapter the chapter is dropped: "1:5" is shown as "5".
      if (oneChapterCwms.has(ctx.lastCwms) && firstNum === '1' && endVerse === undefined) {
        ref.display = rangeVal ? `${verseStart}\u2013${rangeVal}` : verseStart
      }
    } else if (ctx.chapterLevel) {
      // Branch B1: after a chapter-level ref ("Romans 3"), a bare number is a
      // chapter, or a range of chapters: "Romans 3, 5" is chapters 3 and 5.
      ref = { chapter: firstNum, endChapter: bareRangeEnd }
    } else if (ctx.lastChapter) {
      // Branch B2: bare verse — firstNum is a verse in the last known chapter
      ref = {
        chapter: ctx.lastChapter,
        verseStart: firstNum,
        rangeVal: bareRangeEnd,
        endVerse: undefined
      }
    } else {
      // No chapter context yet; can't resolve a bare verse
      continue
    }
    items.push({
      // The separator stays outside the item (outside the link).
      start: offset + m.index + sep.length,
      end: offset + pos,
      cwms: ctx.lastCwms,
      named: false,
      translation: ctx.translation,
      ...ref
    })
  }
}

// ctx = { lastCwms, lastChapter, chapterLevel, translation } — shared across the runs of a
// block so continuation refs can span inline tags; the caller resets it at
// block boundaries.
//
// Returns the items in order, each { start, end } into `text`:
//   { optOut: true }   a "!"-prefixed reference: show it without the "!", unlinked
//   { cwms, chapter, verseStart, rangeVal, endVerse, endChapter, translation, named }
//                      a reference to link and collect; `named` is false for a
//                      continuation
// A reference to an unknown book gets no item.
export function scanBibleRefs (text, ctx) {
  const items = []
  const transMap = buildTranslationMap(text)

  BIBLE_REF_RE.lastIndex = 0
  let lastIndex = 0
  let m
  while ((m = BIBLE_REF_RE.exec(text)) !== null) {
    const [
      match,
      bang,
      bookName,
      chapter,
      verseStart,
      rangeVal,
      endVerse,
      endChapter
    ] = m
    // Continuation refs in the gap before this named ref
    scanContinuations(text.slice(lastIndex, m.index), lastIndex, ctx, items)
    const end = m.index + match.length
    if (bang === '!') {
      // An opted-out ref ends the chain it opens, so the references after it ("!Ps 9:1; 21:14")
      // aren't read as continuing an earlier one.
      ctx.lastCwms = null
      items.push({ start: m.index, end, optOut: true })
    } else {
      const normalized = bookName.toLowerCase().replace(/\s+/g, ' ').trim()
      const cwms =
        cwmsByName.get(normalized) ||
        cwmsByName.get(normalized.replace(/\s/g, ''))
      if (cwms) {
        const ref = { chapter, verseStart, rangeVal, endVerse, endChapter }
        // A book of one chapter is written in full ("Phm 1:3"; a lone "Phm 3" is
        // chapter 3, which fails the build) and shown without the chapter.
        if (oneChapterCwms.has(cwms) && chapter === '1') {
          if (verseStart !== undefined && endVerse === undefined) {
            // "Phm 1:3" is shown as "Phm 3", "Phm 1:3–5" as "Phm 3–5".
            ref.display = `${bookName} ${verseStart}${rangeVal ? `\u2013${rangeVal}` : ''}`
          } else if (verseStart === undefined && endChapter === undefined) {
            // "Phm 1" is the whole letter, shown as just "Phm" and linked as the chapter.
            ref.display = bookName
          }
        }
        ctx.lastCwms = cwms
        ctx.lastChapter = endVerse !== undefined ? rangeVal : chapter
        // "Romans 3" and "Romans 3–5" cite whole chapters; what follows a comma
        // continues at chapter level.
        ctx.chapterLevel = verseStart === undefined
        ctx.translation = transMap.get(m.index) || 'ESV'
        items.push({
          start: m.index,
          end,
          cwms,
          named: true,
          translation: ctx.translation,
          ...ref
        })
      }
    }
    lastIndex = end
  }
  // Continuation refs in the trailing text after the last named ref
  scanContinuations(text.slice(lastIndex), lastIndex, ctx, items)
  return items
}
