import slugify from 'slugify'
import { escHtml, unescHtml } from './escape.js'
import { mapText, walkHtml } from './walk.js'

// Pure HTML → HTML post-passes. Each takes a whole page's HTML and returns it
// rewritten. Passes that touch text use mapText and leave tags alone.

// Text inside these tags is left alone by the abbreviation, initials, Roman
// numeral and divine-name passes. (An inline SVG's text can't hold a <span>; a diagram
// writes its own <tspan class="divine-name">.)
const WRAP_SKIP_TAGS = new Set(['abbr', 'code', 'pre', 'script', 'style', 'svg'])

// A web address in running text (a bare link's display text is its own address). The
// text passes leave these alone: a "VH" or "QA" in a path isn't an abbreviation.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"]+)/g

// mapText for the text passes: fn sees only the stretches of text outside tags in
// WRAP_SKIP_TAGS and outside web addresses.
function mapProse (html, fn) {
  return mapText(html, WRAP_SKIP_TAGS, (text) =>
    // split with a capture group: the odd pieces are the addresses
    text.split(URL_RE).map((piece, i) => i % 2 === 1 ? piece : fn(piece)).join('')
  )
}

// Builds the one regex that matches any abbreviation (case-sensitive), longest
// first to prevent prefix collisions. Null if there are none.
//   - If a key ends with a word character, use \b on both sides
//   - If it ends with punctuation (e.g. "e.g."), use \b on the left only
function abbreviationRegex (abbrMap) {
  const sorted = Object.keys(abbrMap).sort((a, b) => b.length - a.length)
  if (sorted.length === 0) return null
  const parts = sorted.map((abbr) => {
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const lastChar = abbr[abbr.length - 1]
    const rightBoundary = /\w/.test(lastChar) ? '\\b' : ''
    return `\\b${escaped}${rightBoundary}`
  })
  return new RegExp(`(${parts.join('|')})`, 'g')
}

// Returns a function that wraps abbreviations in a page's HTML. The regex is
// built once, not once per page.
export function makeAbbreviationWrapper (abbrMap) {
  const combinedRe = abbreviationRegex(abbrMap)

  return (html) =>
    mapProse(html, (text) =>
      text.replace(combinedRe, (match) => {
        return `<abbr title="${escHtml(abbrMap[match])}">${match}</abbr>`
      })
    )
}

// Adds or replaces the alt attribute on any <img> whose src basename matches
// a key in altMap.  Matching is case-sensitive and against the filename only
// (no directory path, no query string).  Values are HTML-escaped.  An image with
// no entry is pushed to `problems`: it fails the build.
export function applyAltText (html, altMap, problems) {
  return html.replace(/<img\s[^>]*>/g, (tag) => {
    const srcMatch = tag.match(/\bsrc=(["'])([^"']+)\1/)
    if (!srcMatch) {
      problems.push(`an image with no src: ${tag}`)
      return tag
    }

    const src = srcMatch[2]
    // Strip any query/hash, then take the last path segment
    const basename = src.split('/').pop().split(/[?#]/)[0]
    if (!Object.prototype.hasOwnProperty.call(altMap, basename)) {
      problems.push(`image ${basename} has no entry in alt-text.json`)
      return tag
    }

    const altText = escHtml(altMap[basename])

    if (/\balt=/.test(tag)) {
      // Replace existing alt value (handles both quote styles)
      return tag.replace(/\balt=(["'])[^"']*\1/, () => `alt="${altText}"`)
    }
    // Insert alt before the closing > or />
    return tag.replace(/(\s?\/?>)$/, (end) => ` alt="${altText}"${end}`)
  })
}

// ─── Initials Wrapping ────────────────────────────────────────────────────────

// Matches two or more consecutive "UppercaseLetter + period" groups, e.g.
// "D.A.", "R.C.", "J.R.R.", "U.S.A."  Single-letter abbreviations like "Dr."
// are intentionally excluded (they require two or more such groups).
const INITIALS_RE = /\b([A-Z]\.){2,}/g

// The surname beside the initials: "Sproul, " just before them, or " Sproul" just after.
const SURNAME_BEFORE_RE = /([A-Z][\p{L}-]*),\s*$/u
const SURNAME_AFTER_RE = /^\s+([A-Z][\p{L}-]*)/u

// Wraps initials in <abbr>, titled with the expansion that initials.json gives the
// person: the key is the initials and the surname, "R.C. Sproul", found whether the
// name reads "R.C. Sproul" or "Sproul, R.C." Initials with no entry (or no surname beside
// them) are pushed to `problems` and left plain: they fail the build.
export function wrapInitials (html, initialsMap, problems) {
  return mapProse(html, (text) =>
    text.replace(INITIALS_RE, (match, _group, offset) => {
      const before = SURNAME_BEFORE_RE.exec(text.slice(0, offset))?.[1]
      const after = SURNAME_AFTER_RE.exec(text.slice(offset + match.length))?.[1]
      // A name before the initials ("Carson, D.A. The Difficult…") beats one after them.
      const keys = [before, after].filter(Boolean).map((surname) => `${match} ${surname}`)
      const key = keys.find((k) => typeof initialsMap[k] === 'string')
      if (key) return `<abbr title="${escHtml(initialsMap[key])}">${match}</abbr>`
      problems.push(keys.length > 0
        ? `initials "${match}" need an entry in initials.json: ${keys.map((k) => `"${k}"`).join(' or ')}`
        : `initials "${match}" have no surname beside them to look up in initials.json (write "${match} Surname" or "Surname, ${match}")`)
      return match
    })
  )
}

// ─── End Initials Wrapping ────────────────────────────────────────────────────

// ─── Spaced Ellipsis Normalisation ───────────────────────────────────────────

// Converts spaced ellipses (". . ." with any whitespace, including U+00A0) to
// the typographically correct form with non-breaking spaces as HTML entities.
// The longer pattern (leading space) is applied first so it is not partially
// consumed by the shorter one.
export function fixSpacedEllipses (html) {
  return html
    .replace(/\s\.\s\.\s\./g, '&nbsp;.&nbsp;.&nbsp;.')
    .replace(/\.\s\.\s\./g, '.&nbsp;.&nbsp;.')
}

// ─── End Spaced Ellipsis Normalisation ───────────────────────────────────────

// ─── Roman Numeral Wrapping ───────────────────────────────────────────────────

// Matches strictly valid Roman numerals (1–3999), uppercase only.
// Two branches:
//   1. Dotted pair ROMAN.ROMAN — each half ≥ 1 char (e.g. X.III, I.I, XIV.II)
//   2. Standalone — ≥ 2 chars (lookahead (?=[MDCLXVI]{2}) excludes bare I, V, X, etc.)
// Dotted branch is listed first so it wins the longer match.
// The match.length >= 2 guard in the replacement callback is a safety net against
// empty matches that the all-optional structural pattern can produce at word boundaries.
const ROMAN_RE_SRC =
  'M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})'
const ROMAN_NUM_RE = new RegExp(
  `\\b(?=[MDCLXVI])${ROMAN_RE_SRC}\\.(?=[MDCLXVI])${ROMAN_RE_SRC}\\b` +
    `|\\b(?=[MDCLXVI]{2})${ROMAN_RE_SRC}\\b`,
  'g'
)

export function wrapRomanNumerals (html) {
  return mapProse(html, (text) =>
    text.replace(ROMAN_NUM_RE, (match) =>
      match.length >= 2 ? `<span class="roman-num">${match}</span>` : match
    )
  )
}

// ─── End Roman Numeral Wrapping ───────────────────────────────────────────────

// ─── Divine Name Wrapping ─────────────────────────────────────────────────────
// LORD, GOD, YHWH, I AM, etc. (all-caps) →
//   <span class="divine-name">
//     <span class="divine-name-initial">L</span>ORD
//   </span>
// First letter wrapped in .divine-name-initial so it can be styled independently
// of the remaining small-capped letters (::first-letter only works on block elements).

const DIVINE_NAME_RE =
  /\b(LORD|GOD|YHWH|I AM( THAT I AM| WHAT I AM| WHO I AM)?|I WILL BE( THAT I WILL BE| WHAT I WILL BE| WHO I WILL BE)?)\b/g

export function wrapDivineNames (html) {
  return mapProse(html, (text) =>
    text.replace(DIVINE_NAME_RE, (match) => {
      const newMatch = match.replace(
        /\b(G|L|I\b)/g,
        '<span class="divine-name-initial">$1</span>'
      )
      return `<span class="divine-name">${newMatch}</span>`
    })
  )
}

// ─── End Divine Name Wrapping ─────────────────────────────────────────────────

// ─── Unknown Abbreviations ────────────────────────────────────────────────────

// Two or more capitals, then more capitals or digits: "NASA", "UBS5". Dotted forms
// ("A.5") are not looked for.
const ALL_CAPS_RE = /\b[A-Z]{2,}[A-Z0-9]*\b/g
// A "!" in front of one opts it out of the check, as it does for a Scripture reference.
// (?<![\w<]) keeps "Wow!NASA" from counting, and the "<!DOCTYPE" the walker sees as text.
const OPT_OUT_RE = /(?<![\w<])!([A-Z]{2,}[A-Z0-9]*)\b/g
const ROMAN_WHOLE_RE = new RegExp(`^(?=[MDCLXVI])${ROMAN_RE_SRC}$`)

// Returns a function that lists the all-caps words in a page's text that nothing
// explains: not covered by a key of abbreviations.json (a key like "JS–H" covers its "JS"),
// not a Roman numeral, not a divine name. Same skip list as the passes, which means it
// runs before they wrap anything.
export function makeUnknownAbbreviationFinder (abbrMap) {
  const knownRe = abbreviationRegex(abbrMap)
  return (html) => {
    const unknown = new Set()
    walkHtml(html.replace(/^<!DOCTYPE[^>]*>/i, ''), WRAP_SKIP_TAGS, {
      onText: (text, skipped) => {
        if (skipped) return
        let rest = text.replace(URL_RE, ' ').replace(DIVINE_NAME_RE, ' ').replace(OPT_OUT_RE, ' ')
        if (knownRe) rest = rest.replace(knownRe, ' ')
        for (const [word] of rest.matchAll(ALL_CAPS_RE)) {
          if (!ROMAN_WHOLE_RE.test(word)) unknown.add(word)
        }
      },
      onTag: () => {}
    })
    return [...unknown]
  }
}

// A title written with opt-outs ("!ANNOUNCEMENT") as plain text, for the <title>, the link previews and the feed.
export const withoutOptOuts = (text) => text.replace(OPT_OUT_RE, '$1')

// Drops the "!" of each opt-out, once the check has seen it. Runs before the wrapping
// passes, which then treat the word like any other.
export function stripOptOuts (html) {
  return mapProse(html, (text) => text.replace(OPT_OUT_RE, '$1'))
}

// ─── End Unknown Abbreviations ────────────────────────────────────────────────

// ─── Heading IDs ──────────────────────────────────────────────────────────────
// Adds an id to each <h2> and <h3> without one, slugified from its text (a repeat of a
// name gets -2, -3 …), so a wikilink or a reader can link to a section.

const HEADING_RE = /<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<(h[23])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi

// The slug of a heading's HTML: its plain text, decoded (markdown-it writes "&amp;"), slugified.
// An empty or symbol-only heading is "section".
export function headingSlug (html) {
  return slugify(unescHtml(html.replace(/<[^>]*>/g, '')).trim(), { lower: true, strict: true }) || 'section'
}

export function addHeadingIds (html) {
  const used = new Set()
  for (const [, , attrs] of html.matchAll(HEADING_RE)) {
    const id = /\bid\s*=\s*["']([^"']+)["']/.exec(attrs ?? '')?.[1]
    if (id) used.add(id)
  }
  return html.replace(HEADING_RE, (match, tag, attrs = '', inner) => {
    if (!tag || /\bid\s*=/.test(attrs)) return match
    const base = headingSlug(inner)
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return `<${tag}${attrs} id="${id}">${inner}</${tag}>`
  })
}
