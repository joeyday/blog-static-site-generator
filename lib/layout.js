import ejs from 'ejs'

// A web address that is its own link text ("see https://x.org") needn't be printed twice,
// so it is marked and print.css leaves its address off.
const bareUrl = (s) => s.replaceAll('&amp;', '&').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

// Marks every link in a page as external or internal; an external link whose text is its
// own address is also marked `bare-url`.
function classifyLinks (html) {
  return html.replace(/<a\s([^>]*href="([^"]*)"[^>]*)>/g, (match, attrs, href, offset, whole) => {
    const classes = []
    if (/^https?:\/\//.test(href)) {
      classes.push('external')
      const end = whole.indexOf('</a>', offset + match.length)
      const text = whole.slice(offset + match.length, end)
      if (end !== -1 && !text.includes('<') && bareUrl(text) === bareUrl(href)) classes.push('bare-url')
    } else {
      classes.push('internal')
    }
    return /class="/.test(attrs)
      ? `<a ${attrs.replace(/class="([^"]*)"/, `class="$1 ${classes.join(' ')}"`)}>`
      : `<a class="${classes.join(' ')}" ${attrs}>`
  })
}

// Compiles the page layout once and returns renderLayout(content, locals), which wraps
// content in the layout and classifies its links.
export function createLayout ({ template, cacheBust }) {
  const renderTemplate = ejs.compile(template)
  const year = new Date().getFullYear()
  return (content, locals) => classifyLinks(renderTemplate({
    cacheBust,
    year,
    description: '',
    type: 'website',
    ...locals,
    pageTitle: locals.title,
    title: locals.url === '/' ? locals.title : `${locals.title} ‹ Joey Day`,
    content
  }))
}
