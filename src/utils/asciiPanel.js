const { colorize } = require('./ansi')

const MIN_WIDTH = 20
const MAX_WIDTH = 100

function getTerminalWidth () {
  if (typeof process !== 'undefined' && process.stdout && typeof process.stdout.columns === 'number') {
    return Math.max(MIN_WIDTH, Math.min(process.stdout.columns - 4, MAX_WIDTH))
  }
  return 76
}

function chunkLongWord (word, width) {
  const chunks = []
  let index = 0
  while (index < word.length) {
    chunks.push(word.slice(index, index + width))
    index += width
  }
  return chunks
}

function wrapSingleLine (line, width) {
  if (!line) return ['']
  const words = line.split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const wrapped = []
  let current = ''

  for (const word of words) {
    if (!current) {
      if (word.length <= width) {
        current = word
      } else {
        const parts = chunkLongWord(word, width)
        wrapped.push(...parts.slice(0, -1))
        current = parts.at(-1)
      }
      continue
    }

    if ((current.length + 1 + word.length) <= width) {
      current += ` ${word}`
      continue
    }

    wrapped.push(current)

    if (word.length <= width) {
      current = word
    } else {
      const parts = chunkLongWord(word, width)
      wrapped.push(...parts.slice(0, -1))
      current = parts.at(-1)
    }
  }

  if (current) {
    wrapped.push(current)
  }

  return wrapped
}

function wrapLine (line, width) {
  if (line === null || line === undefined) {
    return []
  }
  const normalized = String(line)
  return normalized
    .split(/\r?\n/)
    .flatMap(segment => wrapSingleLine(segment.trim(), width))
}

function applyStyle (line, style) {
  if (!style) return line
  return colorize(line, style)
}

function highlightLabel (line, style) {
  if (!style) return line
  return line.replace(/(│\s*)([^:]+:)/, (_, prefix, label) => `${prefix}${colorize(label, style)}`)
}

function highlightValue (line, style) {
  if (!style) return line
  return line.replace(/(│\s*[^:]+:\s*)(.*?)(\s*│)$/, (_, prefix, value, suffix) => {
    if (!value.trim()) {
      return `${prefix}${value}${suffix}`
    }
    const trailing = value.match(/\s*$/)?.[0] ?? ''
    const core = value.slice(0, value.length - trailing.length)
    return `${prefix}${colorize(core, style)}${trailing}${suffix}`
  })
}

function renderPanel (title, lines = [], options = {}) {
  const sanitizedTitle = typeof title === 'string' ? title.trim() : ''
  const filteredLines = Array.isArray(lines) ? lines.filter(line => line !== null && line !== undefined) : []
  const terminalWidth = options.maxWidth ? Math.min(options.maxWidth, MAX_WIDTH) : getTerminalWidth()
  const wrapWidth = Math.max(MIN_WIDTH, Math.min(terminalWidth, MAX_WIDTH))

  const titleLines = sanitizedTitle ? wrapLine(sanitizedTitle, wrapWidth) : ['']
  const primaryTitle = titleLines.shift() || ''
  const extraTitleCount = titleLines.length
  const bodyLines = [
    ...titleLines,
    ...filteredLines.flatMap(line => wrapLine(String(line), wrapWidth))
  ]

  const contentLengths = [primaryTitle.length, ...bodyLines.map(line => line.length)]
  const panelWidth = Math.max(Math.min(wrapWidth, Math.max(...contentLengths, MIN_WIDTH)), MIN_WIDTH)

  const top = `╭${'─'.repeat(panelWidth + 2)}╮`
  const header = `│ ${primaryTitle.padEnd(panelWidth)} │`
  const separator = `├${'─'.repeat(panelWidth + 2)}┤`
  const body = bodyLines.map((line, index) => ({
    type: index < extraTitleCount ? 'header-continued' : 'body',
    value: `│ ${line.padEnd(panelWidth)} │`
  }))
  const bottom = `╰${'─'.repeat(panelWidth + 2)}╯`

  if (!body.length) {
    return {
      width: panelWidth,
      lines: [top, header, bottom],
      meta: ['border', 'header', 'border']
    }
  }

  return {
    width: panelWidth,
    lines: [
      top,
      header,
      separator,
      ...body.map(entry => entry.value),
      bottom
    ],
    meta: [
      'border',
      'header',
      'border',
      ...body.map(entry => entry.type),
      'border'
    ]
  }
}

function applyPanelTheme (panel, theme = {}) {
  if (!panel || !Array.isArray(panel.lines)) {
    return []
  }

  const lines = []

  for (let index = 0; index < panel.lines.length; index += 1) {
    const line = panel.lines[index]
    const type = panel.meta[index]
    if (type === 'border') {
      lines.push(applyStyle(line, theme.border))
      continue
    }
    if (type === 'header') {
      lines.push(applyStyle(line, theme.header || theme.title))
      continue
    }

    let themed = line
    if (type === 'header-continued' && theme.headerContinuation) {
      themed = applyStyle(themed, theme.headerContinuation)
    }
    if (theme.label) {
      themed = highlightLabel(themed, theme.label)
    }
    if (theme.value) {
      themed = highlightValue(themed, theme.value)
    }
    lines.push(themed)
  }

  return lines
}

module.exports = {
  renderPanel,
  applyPanelTheme
}
