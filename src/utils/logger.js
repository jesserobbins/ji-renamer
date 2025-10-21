const levels = ['debug', 'info', 'warn', 'error']

function buildLogger (options = {}) {
  const levelFromEnv = options.level || process.env.AI_RENAMER_LOG_LEVEL || 'info'

  let threshold = levels.indexOf(levelFromEnv)
  if (threshold === -1) {
    threshold = levels.indexOf('info')
  }

  const setLevel = (level) => {
    if (typeof level !== 'string') return
    const nextThreshold = levels.indexOf(level)
    if (nextThreshold === -1) return
    threshold = nextThreshold
  }

  const getLevel = () => levels[threshold] || 'info'

  const log = (level, message, ...rest) => {
    const levelIndex = levels.indexOf(level)
    if (levelIndex === -1 || levelIndex < threshold) return
    const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}:`
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message, ...rest)
  }

  const formatStepMessage = (symbol, label, detail) => {
    const parts = [symbol]
    if (label) {
      parts.push(label)
    }
    if (detail) {
      if (label) {
        parts.push('-')
      }
      parts.push(detail)
    }
    return parts.join(' ')
  }

  const time = async (label, intention, fn) => {
    if (typeof fn !== 'function') {
      throw new TypeError('logger.time expects a function returning a value or promise')
    }

    log('debug', formatStepMessage('→', label, intention))

    const start = process.hrtime.bigint()

    try {
      const result = await fn()
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6
      log('debug', formatStepMessage('✓', label, `Completed in ${durationMs.toFixed(2)}ms`))
      return result
    } catch (error) {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6
      log('debug', formatStepMessage('✗', label, `Failed after ${durationMs.toFixed(2)}ms: ${error.message}`))
      throw error
    }
  }

  return {
    debug: (message, ...rest) => log('debug', message, ...rest),
    info: (message, ...rest) => log('info', message, ...rest),
    warn: (message, ...rest) => log('warn', message, ...rest),
    error: (message, ...rest) => log('error', message, ...rest),
    time,
    setLevel,
    getLevel
  }
}

module.exports = {
  buildLogger,
  levels
}
