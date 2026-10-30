// Progress messages ("Built …", "… processed 523 HTML file(s)"). They print unless
// the local preview server runs quietly (serve without --verbose). Warnings and
// errors go straight to console.warn / console.error and always print.
let verbose = true

export function setVerbose (value) {
  verbose = value
}

export function info (...args) {
  if (verbose) console.log(...args)
}
