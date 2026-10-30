// Minimal HTML escaper for inline text and attribute interpolation.
export const escHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// The reverse, for the entities markdown-it writes (& < > and quotes); &amp; goes last, so
// "&amp;lt;" comes back as "&lt;", not "<".
export const unescHtml = (s) =>
  String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
