import { VERSES_PER_CHAPTER } from './versification.js'

// Definitions shared by the Bible-ref linker and the Scripture collector.

// Each book is a list of its names: the full name first, then abbreviations.
// The last entry is the CWMS abbreviation used in ref.ly URLs.
export const BIBLE_BOOKS = [
  ['Genesis', 'Ge'],
  ['Exodus', 'Ex'],
  ['Leviticus', 'Lev'],
  ['Numbers', 'Nu'],
  ['Deuteronomy', 'Dt'],
  ['Joshua', 'Jos'],
  ['Judges', 'Jdg'],
  ['Ruth', 'Ru'],
  ['1 Samuel', '1Samuel', '1Sa'],
  ['2 Samuel', '2Samuel', '2Sa'],
  ['1 Kings', '1Kings', '1Ki'],
  ['2 Kings', '2Kings', '2Ki'],
  ['1 Chronicles', '1Chronicles', '1Ch'],
  ['2 Chronicles', '2Chronicles', '2Ch'],
  ['Ezra', 'Ezr'],
  ['Nehemiah', 'Ne'],
  ['Esther', 'Est'],
  ['Job'],
  ['Psalms', 'Psalm', 'Ps'],
  ['Proverbs', 'Pr'],
  ['Ecclesiastes', 'Ecc'],
  ['Song of Solomon', 'Song of Songs', 'SS'],
  ['Isaiah', 'Isa'],
  ['Jeremiah', 'Jer'],
  ['Lamentations', 'La'],
  ['Ezekiel', 'Eze'],
  ['Daniel', 'Da'],
  ['Hosea', 'Hos'],
  ['Joel'],
  ['Amos', 'Am'],
  ['Obadiah', 'Ob'],
  ['Jonah', 'Jnh'],
  ['Micah', 'Mic'],
  ['Nahum', 'Na'],
  ['Habakkuk', 'Hab'],
  ['Zephaniah', 'Zep'],
  ['Haggai', 'Hag'],
  ['Zechariah', 'Zec'],
  ['Malachi', 'Mal'],
  ['Matthew', 'Mt'],
  ['Mark', 'Mk'],
  ['Luke', 'Lk'],
  ['John', 'Jn'],
  ['Acts', 'Ac'],
  ['Romans', 'Ro'],
  ['1 Corinthians', '1Corinthians', '1Co'],
  ['2 Corinthians', '2Corinthians', '2Co'],
  ['Galatians', 'Gal'],
  ['Ephesians', 'Eph'],
  ['Philippians', 'Php'],
  ['Colossians', 'Col'],
  ['1 Thessalonians', '1Thessalonians', '1Th'],
  ['2 Thessalonians', '2Thessalonians', '2Th'],
  ['1 Timothy', '1Timothy', '1Ti'],
  ['2 Timothy', '2Timothy', '2Ti'],
  ['Titus', 'Tit'],
  ['Philemon', 'Phm'],
  ['Hebrews', 'Heb'],
  ['James', 'Jas'],
  ['1 Peter', '1Peter', '1Pe'],
  ['2 Peter', '2Peter', '2Pe'],
  ['1 John', '1John', '1Jn'],
  ['2 John', '2John', '2Jn'],
  ['3 John', '3John', '3Jn'],
  ['Jude'],
  ['Revelation', 'Rev']
]

// Lowercased name or abbreviation → CWMS abbreviation.
export const cwmsByName = new Map()
// CWMS abbreviation → book info, for checking a reference.
export const bookInfoByCwms = new Map()
BIBLE_BOOKS.forEach((names, bookIndex) => {
  const cwms = names[names.length - 1]
  for (const name of names) cwmsByName.set(name.toLowerCase(), cwms)
  bookInfoByCwms.set(cwms, {
    bookIndex,
    bookName: names[0],
    bookCwms: cwms
  })
})

// Books of one chapter (Obadiah, Philemon, 2 and 3 John, Jude), by CWMS code. A
// lone number after one of them is a verse: "Phm 3" is Philemon 1:3.
export const oneChapterCwms = new Set(
  [...bookInfoByCwms.values()]
    .filter((info) => VERSES_PER_CHAPTER[info.bookIndex].length === 1)
    .map((info) => info.bookCwms)
)

// Build the reference regex
// Sorted by length desc so longer matches win (e.g. "Song of Solomon" before "Song")
const allBookNames = BIBLE_BOOKS.flat().sort(
  (a, b) => b.length - a.length
)
// Each book name pattern: allow optional \s* between words ("Song of Solomon").
// A numbered abbreviation is written without a space ("1Co", "2Ki"), and "1 Co"
// or "2 Ki" is not a reference; only the full names ("1 Corinthians") have one.
const bookPattern = allBookNames
  .map((n) => {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return escaped.replace(/\\ /g, '\\s*').replace(/\s+/g, '\\s*')
  })
  .join('|')

// Matches: optional !opt-out, book name/abbr, chapter, optional verse+range.
// Case-sensitive, so "I am 30 years old" is not Amos 30.
// Word-boundary anchored via (?<!\w) / (?!\w). A book preceded by a lone 1, 2 or 3 (not the end
// of a year such as 2013) and a space ("1 Jn 2:2") isn't one: it's a numbered book spelled with a space,
// which isn't a reference, and must not turn into a link to Jn 2:2.
//
// Capture groups:
//   1: bang ("!" or "")
//   2: book name/abbr
//   3: chapter
//   — colon branch (verse ref):
//   4: verseStart
//   5: rangeVal  — end verse (same-ch) OR end chapter (cross-ch)
//   6: endVerse  — only present in cross-chapter range
//   — dash branch (chapter-only range, no colon):
//   7: endChapter  — e.g. "2" in "Romans 1–2"
export const BIBLE_REF_RE = new RegExp(
  `(?<![\\w])(?<!(?:^|[^\\w])[123]\\s+)(\\!?)(${bookPattern})\\s+(\\d+)(?::(\\d+)(?:\\s*[-\u2013\u2014]\\s*(\\d+)(?::(\\d+))?)?|\\s*[-\u2013\u2014]\\s*(\\d+))?(?![\\w])`,
  'g'
)

// Supported translation abbreviations (case-sensitive, whole words). One directly
// after a reference and its continuations ("Jn 3:16; 5:24 KJV") makes them all link
// to that translation instead of the default ESV.
export const TRANSLATIONS = ['ESV', 'KJV', 'NASB', 'NIV', 'NKJV', 'NLT', 'NRSV']
export const LEADING_TRANS_RE = new RegExp(`^\\s*(${TRANSLATIONS.join('|')})\\b`)

// Matches bare chapter:verse OR bare verse continuations after a separator.
// Two branches via alternation:
//   A) chapter:verse[-range] — colon present after firstNum
//   B) number[-number]       — no colon; requires ctx.lastChapter to resolve: a verse
//                              range, or chapters after a chapter-level ref
//
// Groups: 1=sep  2=firstNum  3=verseStart(A)  4=rangeVal(A)  5=endVerse(A cross-ch)  6=bareRangeEnd(B)
// A 1, 2 or 3 followed by a capitalized word is the start of a numbered book
// ("; 1 Tim 3:3"), not a continuation, hence the (?![123]\s*[A-Z]) after the separator.
export const CONT_REF_RE =
  /([;,]\s*)(?![123]\s*[A-Z])(\d+)(?::(\d+)(?:\s*[-\u2013\u2014]\s*(\d+)(?::(\d+))?)?|(?:\s*[-\u2013\u2014]\s*(\d+))?)?(?![\w:])/g

// Tags whose content we skip entirely (no Bible-ref linking inside these)
export const SKIP_TAGS = new Set([
  'a',
  'code',
  'pre',
  'script',
  'style',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6'
])

// A topic page's terms are its headings (see addHeadingIds), so they are skipped too.
export const SKIP_TAGS_WITH_TERMS = new Set([...SKIP_TAGS, 'dt'])

// Block-level tags that reset the continuation-ref context between paragraphs/items
export const BLOCK_TAGS = new Set([
  'p',
  'li',
  'dd',
  'dt',
  'blockquote',
  'div',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'td',
  'th',
  'figcaption'
])
