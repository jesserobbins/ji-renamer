function renderPanel (title, lines = []) {
  const sanitizedTitle = typeof title === 'string' && title.trim() ? title.trim() : ''
  const filteredLines = (Array.isArray(lines) ? lines : []).filter(Boolean).map(String)
  const contentLengths = [sanitizedTitle.length, ...filteredLines.map(line => line.length)]
  const width = Math.max(10, ...contentLengths)
  const top = `╭${'─'.repeat(width + 2)}╮`
  const header = `│ ${sanitizedTitle.padEnd(width)} │`
  if (!filteredLines.length) {
    const bottom = `╰${'─'.repeat(width + 2)}╯`
    return [top, header, bottom]
  }
  const separator = `├${'─'.repeat(width + 2)}┤`
  const body = filteredLines.map(line => `│ ${line.padEnd(width)} │`)
  const bottom = `╰${'─'.repeat(width + 2)}╯`
  return [top, header, separator, ...body, bottom]
}

module.exports = {
  renderPanel
}
