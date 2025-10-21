const { colorize } = require('./ansi')

const levels = ['debug', 'info', 'warn', 'error']

const levelStyles = {
  debug: ['dim'],
  info: ['bold', 'cyan'],
  warn: ['bold', 'yellow'],
  error: ['bold', 'red']
}

function buildLogger () {
  const levelFromEnv = process.env.AI_RENAMER_LOG_LEVEL || 'info'
  const threshold = levels.indexOf(levelFromEnv) === -1 ? 1 : levels.indexOf(levelFromEnv)

  const log = (level, message, ...rest) => {
    const levelIndex = levels.indexOf(level)
    if (levelIndex === -1 || levelIndex < threshold) return
    const styledLevel = levelStyles[level] ? colorize(level.toUpperCase(), levelStyles[level]) : level.toUpperCase()
    const prefix = `[${new Date().toISOString()}] ${styledLevel}:`
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message, ...rest)
  }

  return {
    debug: (message, ...rest) => log('debug', message, ...rest),
    info: (message, ...rest) => log('info', message, ...rest),
    warn: (message, ...rest) => log('warn', message, ...rest),
    error: (message, ...rest) => log('error', message, ...rest)
  }
}

module.exports = {
  buildLogger
}
