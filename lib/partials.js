// Split a partial's args string on | separators, but treat [[...]] as atomic
// so pipes inside wikilinks (display text) are not treated as separators.
// e.g. "[[topic/Trinity|Trinity]]|simple" → ["[[topic/Trinity|Trinity]]", "simple"]
function splitPartialArgs (argsStr) {
  const args = []
  let current = ''
  let depth = 0
  let i = 0
  while (i < argsStr.length) {
    if (argsStr[i] === '[' && argsStr[i + 1] === '[') {
      depth++
      current += '[['
      i += 2
    } else if (argsStr[i] === ']' && argsStr[i + 1] === ']') {
      depth--
      current += ']]'
      i += 2
    } else if (argsStr[i] === '|' && depth === 0) {
      args.push(current.trim())
      current = ''
      i++
    } else {
      current += argsStr[i]
      i++
    }
  }
  args.push(current.trim())
  return args
}

// Expand {{name}} / {{name|arg1|arg2}} using the files in partial/. Names are
// looked up by basename only (case-insensitive); there is no path syntax.
// `mask` is applied to each partial's body so its code stays literal. `warn`
// hears about a missing or circular partial; it is silent unless given one, since a
// page's source is expanded more than once and each problem should be reported once.
export function expandPartials (
  text,
  partials,
  mask = (t) => t,
  seen = new Set(),
  warn = () => {}
) {
  return text.replace(
    /\{\{([^}|]+?)(?:\|([^}]*))?\}\}/g,
    (match, name, argsStr, offset, whole) => {
      name = name.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim()
      const key = name.toLowerCase().trim()

      // Numeric names are unfilled positional placeholders — leave as empty
      if (/^\d+$/.test(key)) return ''

      if (seen.has(key)) {
        warn(`circular partial "${name}"`)
        return `<!-- circular partial: ${name} -->`
      }

      let partial = partials[key]
      if (partial === undefined) {
        warn(`partial "${name}" not found`)
        return `<!-- partial not found: ${name} -->`
      }

      const args = argsStr ? splitPartialArgs(argsStr) : []

      for (let i = 0; i < args.length; i++) {
        // A function, so a `$` in an argument isn't read as a replacement pattern.
        partial = partial.replace(
          new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'),
          () => args[i]
        )
      }

      // Replace any remaining unfilled {{N}} placeholders with empty string
      partial = partial.replace(/\{\{\d+\}\}/g, '')

      partial = partial.replace(/\{\{\$args\}\}/g, () => args.join(', '))
      partial = partial.replace(/\{\{\$n\}\}/g, String(args.length))

      const expanded = expandPartials(mask(partial), partials, mask, new Set(seen).add(key), warn)

      // After a definition marker (": {{partial}}") the expansion's other lines belong to the
      // definition, so they are indented to stay inside it, and its trailing line breaks go,
      // so the next ": " line still follows directly.
      const lineStart = whole.lastIndexOf('\n', offset - 1) + 1
      if (!/^:[ \t]+$/.test(whole.slice(lineStart, offset))) return expanded
      return expanded.trimEnd().replace(/\n(?=[^\n])/g, '\n  ')
    }
  )
}
