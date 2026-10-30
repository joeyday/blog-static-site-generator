// ─── Code masking ───
// The plain-text passes over a page's Markdown (partials, wikilinks, EJS,
// comments) must leave code alone. maskCode swaps each fenced
// block and inline code span for a placeholder (kept in `stash`); restoreCode
// puts them back just before markdown-it runs.
//
// Indented code blocks aren't masked: four spaces is also how list items
// continue, so they can't be told apart without a Markdown parse.

// A fence of 3+ backticks or tildes at the start of a line, through the matching
// fence (or the end of the text, as in CommonMark). The same character closes it, and at
// at least as many as opened it (\1 is the whole opening run, so the closer is that
// run and any more of the character).
const FENCED = /^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*$|(?![\s\S]))/gm

// A run of N backticks, then the next run of exactly N, within one paragraph.
const INLINE = /(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])+?(?<!`)\1(?!`)/g

// Private-use characters delimit a placeholder, so nothing in a page matches it.
const PLACEHOLDER = /(\d+)/g

export function maskCode (text, stash) {
  const keep = (code) => `${stash.push(code) - 1}`
  return text.replace(FENCED, keep).replace(INLINE, keep)
}

// A masked span can hold the placeholder of an argument passed into a partial,
// so restoring recurses.
export function restoreCode (text, stash) {
  return text.replace(PLACEHOLDER, (_, i) => restoreCode(stash[i], stash))
}
