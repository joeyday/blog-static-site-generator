import fs from 'fs'
import path from 'path'

// Watches directories and calls onChange(paths) once things have been quiet for
// quietMs: every relevant change restarts the wait, so a burst of saves is one
// call. `notify(paths)` counts as a change too (the caller uses it to put changes
// back on the clock when a build is still running). Returns { watch, notify, stop }.
export function createWatcher ({ onChange, quietMs = 2500 }) {
  let timer = null
  const changed = new Set()
  const watchers = []

  function notify (paths) {
    for (const p of paths) changed.add(p)
    clearTimeout(timer)
    timer = setTimeout(() => {
      const files = [...changed]
      changed.clear()
      onChange(files)
    }, quietMs)
  }

  // `relevant(relPath)` says whether a changed path counts; without a file name
  // (some platforms omit it) every event counts. `recursive: false` watches only the
  // files directly in `dir`.
  function watch (dir, relevant, { recursive = true } = {}) {
    watchers.push(
      fs.watch(dir, { recursive }, (_event, filename) => {
        const rel = filename ? filename.split(path.sep).join('/') : null
        if (rel && !relevant(rel)) return
        notify([rel ?? '(unknown file)'])
      })
    )
  }

  function stop () {
    clearTimeout(timer)
    for (const w of watchers) w.close()
  }

  return { watch, notify, stop }
}
