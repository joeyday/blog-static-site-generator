import markdownIt from 'markdown-it'
import markdownItFootnote from 'markdown-it-footnote'
import markdownItMark from 'markdown-it-mark'
import markdownItContainer from 'markdown-it-container'
import markdownItDeflist from 'markdown-it-deflist'
import markdownItBracketedSpans from 'markdown-it-bracketed-spans'
import markdownItAttrs from 'markdown-it-attrs'
import { BuildError } from './errors.js'
import { escHtml } from './html/escape.js'

function parseFencedAttrs (info) {
  const attrs = { classes: [], id: null, other: {} }
  if (!info) return attrs
  // eslint-disable-next-line no-control-regex
  const m = info.match(/^\x01(.*)\x01$/)
  if (!m) {
    attrs.classes.push(info)
    return attrs
  }
  const tokens = m[1].match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  for (const token of tokens) {
    if (token.startsWith('.')) {
      attrs.classes.push(token.slice(1))
    } else if (token.startsWith('#')) {
      attrs.id = token.slice(1)
    } else if (token.includes('=')) {
      const eq = token.indexOf('=')
      const key = token.slice(0, eq)
      let val = token.slice(eq + 1)
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      attrs.other[key] = val
    }
  }
  return attrs
}

export function protectFencedAttrs (text) {
  return text.replace(
    /^(:::)\s*\{([^}]+)\}/gm,
    (m, colons, content) => colons + '\x01' + content + '\x01'
  )
}

// ─── Small text ───
// `~text~` is <small>text</small>. It is an inline rule of its own, paired like emphasis, so a
// pair never crosses a block (a term and its definition, two list items) or overlaps other
// markup: `~a *b~ c*` can't make crossing tags, and a lone `~` ("~100 arguments") stays a tilde.
// It may span a line break inside a paragraph. `~~` is strikethrough, which comes first. The
// delimiters carry a marker of their own so strikethrough's `~~` never pairs with a single `~`.
const SMALL = 0x7E00

function markdownItSmall (md) {
  md.inline.ruler.before('strikethrough', 'small', (state, silent) => {
    if (silent || state.src.charCodeAt(state.pos) !== 0x7E) return false
    const scanned = state.scanDelims(state.pos, true)
    if (scanned.length !== 1) return false
    state.push('text', '', 0).content = '~'
    if (scanned.can_open || scanned.can_close) {
      state.delimiters.push({
        marker: SMALL,
        length: 0,
        token: state.tokens.length - 1,
        end: -1,
        open: scanned.can_open,
        close: scanned.can_close
      })
    }
    state.pos++
    return true
  })
  const pair = (state, delimiters) => {
    for (const open of delimiters) {
      if (open.marker !== SMALL || open.end === -1) continue
      const closer = delimiters[open.end]
      for (const [token, nesting] of [[state.tokens[open.token], 1], [state.tokens[closer.token], -1]]) {
        token.type = nesting === 1 ? 'small_open' : 'small_close'
        token.tag = 'small'
        token.nesting = nesting
        token.markup = '~'
        token.content = ''
      }
    }
  }
  md.inline.ruler2.before('emphasis', 'small', (state) => {
    pair(state, state.delimiters)
    for (const meta of state.tokens_meta) {
      if (meta?.delimiters) pair(state, meta.delimiters)
    }
  })
}

export const md = markdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false
})
  .enable('strikethrough')
  .use(markdownItFootnote)
  .use(markdownItMark)
  .use(markdownItSmall)
  .use(markdownItDeflist)
  .use(markdownItBracketedSpans)
  .use(markdownItContainer, '', {
    validate: () => true,
    render (tokens, idx) {
      const info = tokens[idx].info.trim()
      if (tokens[idx].nesting === 1) {
        if (!info) return '<div class="callout">\n'
        const parsed = parseFencedAttrs(info)
        let tag = '<div'
        if (parsed.id) tag += ` id="${escHtml(parsed.id)}"`
        if (parsed.classes.length) { tag += ` class="${escHtml(parsed.classes.join(' '))}"` }
        for (const [k, v] of Object.entries(parsed.other)) {
          // A name like `a"b` would break out of the tag.
          if (!/^[A-Za-z_:][-\w:.]*$/.test(k)) {
            throw new BuildError(`Bad attribute name "${k}" in a fenced div: ::: ${info}`)
          }
          tag += ` ${k}="${escHtml(v)}"`
        }
        return tag + '>\n'
      }
      return '</div>\n'
    }
  })
  .use(markdownItAttrs)

// A wide table scrolls inside its own box instead of widening the page.
md.renderer.rules.table_open = (tokens, idx, options, env, self) =>
  '<div class="table-scroll">\n' + self.renderToken(tokens, idx, options)
md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
  self.renderToken(tokens, idx, options) + '</div>\n'

// ─── Footnotes ───
// markdown-it-footnote emits bare links; add the DPUB-ARIA roles, and give
// each backlink a name that says which footnote it returns to.
const footnoteRules = md.renderer.rules
const renderFootnoteRef = footnoteRules.footnote_ref
footnoteRules.footnote_ref = (...args) =>
  renderFootnoteRef(...args).replace('<a ', '<a role="doc-noteref" ')
const renderFootnoteAnchor = footnoteRules.footnote_anchor
footnoteRules.footnote_anchor = (tokens, idx, ...rest) =>
  renderFootnoteAnchor(tokens, idx, ...rest).replace(
    '<a ',
    `<a role="doc-backlink" aria-label="Back to footnote ${tokens[idx].meta.id + 1}" `
  )
// The footnotes get their heading here, so a page never writes one.
footnoteRules.footnote_block_open = () =>
  '<section class="footnotes" role="doc-endnotes" aria-labelledby="notes">\n' +
  '<h2 id="notes">Notes</h2>\n<ol>\n'
