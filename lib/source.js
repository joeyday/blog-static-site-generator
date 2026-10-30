import { maskCode, restoreCode } from './code.js'
import { expandPartials } from './partials.js'

// ─── A page's source ───
// Prepares a page's Markdown for the plain-text passes: code is masked, partials
// ({{name|arg}}) are expanded and %% comments are stripped (so a commented-out link does
// nothing). `restore` puts the code back; call it before markdown-it. `problems` hears
// about a missing or circular partial.
export function prepareSource (markdown, partials, problems) {
  const stash = []
  const mask = (text) => maskCode(text, stash)
  const text = expandPartials(mask(markdown), partials, mask, new Set(), (p) => problems.push(p))
    .replace(/%%[\s\S]*?%%/g, '')
  return { text, restore: (t) => restoreCode(t, stash) }
}
