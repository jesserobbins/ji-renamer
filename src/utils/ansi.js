const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

const STYLE_CODES = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  italic: '\u001b[3m',
  underline: '\u001b[4m',
  inverse: '\u001b[7m',
  hidden: '\u001b[8m',
  strike: '\u001b[9m',
  black: '\u001b[30m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  white: '\u001b[37m',
  gray: '\u001b[90m'
}

let cachedSupport = null

function supportsColor () {
  if (cachedSupport !== null) {
    return cachedSupport
  }
  const noColor = typeof process !== 'undefined' && process.env && Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR')
  const hasTty = typeof process !== 'undefined' && process.stdout && typeof process.stdout.isTTY === 'boolean' && process.stdout.isTTY
  cachedSupport = Boolean(hasTty && !noColor)
  return cachedSupport
}

function colorize (value, ...styles) {
  if (value === null || value === undefined) {
    return ''
  }
  const text = String(value)
  const styleList = styles.length === 1 && Array.isArray(styles[0]) ? styles[0] : styles
  if (!supportsColor() || !styleList.length) {
    return text
  }
  const codes = []
  for (const style of styleList) {
    if (STYLE_CODES[style]) {
      codes.push(STYLE_CODES[style])
    }
  }
  if (!codes.length) {
    return text
  }
  return `${codes.join('')}${text}${STYLE_CODES.reset}`
}

function stripAnsi (value) {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).replace(ANSI_PATTERN, '')
}

module.exports = {
  colorize,
  stripAnsi,
  supportsColor,
  STYLE_CODES
}
