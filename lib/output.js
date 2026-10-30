import fs from 'fs/promises'
import path from 'path'
import { BuildError } from './errors.js'
import { createWriter } from './io.js'
import { processBibleRefs } from './bible/process.js'
import {
  addHeadingIds,
  applyAltText,
  fixSpacedEllipses,
  makeAbbreviationWrapper,
  makeUnknownAbbreviationFinder,
  stripOptOuts,
  wrapDivineNames,
  wrapInitials,
  wrapRomanNumerals
} from './html/passes.js'

// Reads a required JSON object of { key: value } from the working directory.
async function loadJsonMap (file) {
  let data
  try {
    data = JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch (err) {
    throw new BuildError(err.code === 'ENOENT' ? `${file} not found` : `${file} is not valid JSON`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BuildError(`${file} must be a JSON object`)
  }
  return data
}

// The <title> is plain text; the passes would put markup in it (a span in a tab title).
// Park it behind a comment, which every pass already skips.
const TITLE_RE = /<title>[\s\S]*?<\/title>/i
const TITLE_SLOT = '<!--bgen-title-->'

// Every page goes through the post-passes in memory and is written once. The passes read
// the finished page, layout and all, so what the layout writes is checked too.
//
//   process(html, name, quiet)  the passes alone: the finished HTML. `quiet` drops the problems
//                           found, for text that is checked elsewhere (a post on the home page)
//   emit(url, html, name)   a page at the file its URL maps to; `name` is what its problems
//                           are reported under
//   writeFile(relPath, data) any other file under the output directory
//   problems                what is wrong in the pages emitted so far, for the build to fail on
//   finish()                waits for the writes
export async function createOutput ({ outputDir }) {
  const abbrMap = await loadJsonMap('abbreviations.json')
  const bareAbbreviations = Object.keys(abbrMap).filter((k) => typeof abbrMap[k] !== 'string' || abbrMap[k].trim() === '')
  if (bareAbbreviations.length > 0) {
    throw new BuildError(`abbreviations.json needs an expansion for: ${bareAbbreviations.join(', ')}`)
  }
  const initialsMap = await loadJsonMap('initials.json')
  const altMap = await loadJsonMap('alt-text.json')
  const findUnknownAbbreviations = makeUnknownAbbreviationFinder(abbrMap)
  const wrapAbbreviations = Object.keys(abbrMap).length > 0 ? makeAbbreviationWrapper(abbrMap) : null

  const writer = createWriter()
  const problems = []

  // /foo/ is written to foo/index.html; / to index.html. GitHub Pages serves 404.html as the
  // custom 404 page.
  function fileFor (url) {
    if (url === '/404/') return path.join(outputDir, '404.html')
    return path.join(outputDir, url, 'index.html')
  }

  function process (html, name, quiet = false) {
    const title = TITLE_RE.exec(html)?.[0]
    let out = title ? html.replace(TITLE_RE, TITLE_SLOT) : html
    const found = (messages) => {
      if (!quiet) problems.push(...new Set(messages).values().map((m) => `"${name}": ${m}`))
    }

    out = addHeadingIds(out)
    const bible = processBibleRefs(out)
    out = bible.html
    found(bible.problems)
    found(findUnknownAbbreviations(out).map((word) => `${word} is not in abbreviations.json`))
    out = stripOptOuts(out)
    if (wrapAbbreviations) out = wrapAbbreviations(out)
    const initialsProblems = []
    out = wrapInitials(out, initialsMap, initialsProblems)
    found(initialsProblems)
    out = wrapDivineNames(wrapRomanNumerals(out))
    out = fixSpacedEllipses(out)
    const altProblems = []
    out = applyAltText(out, altMap, altProblems)
    found(altProblems)
    if (title) out = out.replace(TITLE_SLOT, () => title)
    return out
  }

  const emit = (url, html, name = url) => writer.write(fileFor(url), process(html, name))

  return {
    problems,
    fileFor,
    process,
    emit,
    writeFile: (relPath, data) => writer.write(path.join(outputDir, relPath), data),
    finish: () => writer.flush()
  }
}
