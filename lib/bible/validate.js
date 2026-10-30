import { bookInfoByCwms } from './refs.js'
import { VERSES_PER_CHAPTER } from './versification.js'

// ─── Checking that a reference exists ───
// A reference to a chapter or verse its book doesn't have fails the build (see
// processBibleRefs), against the verse counts in versification.js. Items are the
// ones scanBibleRefs makes.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// What a reference says, for messages: "Romans 12:71", "Jude 1:3–5".
export function referenceLabel (item) {
  const { bookName } = bookInfoByCwms.get(item.cwms)
  let label = `${bookName} ${item.chapter}`
  if (item.verseStart !== undefined) {
    label += `:${item.verseStart}`
    if (item.endVerse !== undefined) label += `–${item.rangeVal}:${item.endVerse}`
    else if (item.rangeVal) label += `–${item.rangeVal}`
  } else if (item.endChapter) {
    label += `–${item.endChapter}`
  }
  return label
}

// Why the reference can't exist, or null when it can.
export function checkReference (item) {
  const { bookIndex, bookName } = bookInfoByCwms.get(item.cwms)
  const chapters = VERSES_PER_CHAPTER[bookIndex]
  const hasChapters = (n) => `${bookName} has ${plural(n, 'chapter')}`
  const hasVerses = (chapter) =>
    `${bookName} ${chapter} has ${plural(chapters[chapter - 1], 'verse')}`

  const chapter = parseInt(item.chapter)
  if (chapter < 1 || chapter > chapters.length) {
    // "Phm 3" is chapter 3 of a book of one chapter: say how to write a verse.
    if (chapters.length === 1 && item.verseStart === undefined && item.endChapter === undefined) {
      return `${bookName} has one chapter, so this is chapter ${chapter}; for a verse write ${bookName} 1:${chapter}`
    }
    return hasChapters(chapters.length)
  }

  if (item.verseStart === undefined) {
    // A whole chapter, or a run of chapters.
    if (item.endChapter === undefined) return null
    const last = parseInt(item.endChapter)
    if (last < chapter) return 'the range runs backwards'
    if (last > chapters.length) {
      return chapters.length === 1 && chapter === 1
        ? `${bookName} has one chapter; for verses 1–${last} write ${bookName} 1:1–${last}`
        : hasChapters(chapters.length)
    }
    return null
  }

  const verse = parseInt(item.verseStart)
  if (verse < 1) return 'verses start at 1'
  if (verse > chapters[chapter - 1]) return hasVerses(chapter)
  if (item.endVerse !== undefined) {
    // From chapter:verse to another chapter:verse; rangeVal is the end chapter.
    const lastChapter = parseInt(item.rangeVal)
    if (lastChapter < chapter) return 'the range runs backwards'
    if (lastChapter > chapters.length) return hasChapters(chapters.length)
    const lastVerse = parseInt(item.endVerse)
    if (lastVerse < 1) return 'verses start at 1'
    if (lastVerse > chapters[lastChapter - 1]) return hasVerses(lastChapter)
    if (lastChapter === chapter && lastVerse < verse) return 'the range runs backwards'
    return null
  }
  if (item.rangeVal !== undefined) {
    const lastVerse = parseInt(item.rangeVal)
    if (lastVerse > chapters[chapter - 1]) return hasVerses(chapter)
    if (lastVerse < verse) return 'the range runs backwards'
  }
  return null
}
