const { renderPanel, applyPanelTheme } = require('../utils/asciiPanel')
const { colorize } = require('../utils/ansi')

function createSummary () {
  const renamed = []
  const moved = []
  const skipped = []
  const errors = []

  return {
    addRename (entry) {
      renamed.push(entry)
    },
    addMove (entry) {
      moved.push(entry)
    },
    addSkip (entry) {
      skipped.push(entry)
    },
    addError (entry) {
      errors.push(entry)
    },
    print (logger) {
      const panel = renderPanel('RUN SUMMARY', [
        `Renamed : ${renamed.length}`,
        `Moved   : ${moved.length}`,
        `Skipped : ${skipped.length}`,
        `Errors  : ${errors.length}`
      ])
      const themedPanel = applyPanelTheme(panel, {
        border: 'magenta',
        header: ['bold', 'magenta'],
        label: ['bold', 'magenta'],
        value: 'white'
      })
      themedPanel.forEach(line => logger.info(line))

      if (renamed.length) {
        logger.info(colorize('Renamed files:', ['bold', 'green']))
        renamed.forEach(item => {
          const subjectLabel = item.subject ? colorize(item.subject, 'cyan') : colorize('n/a', 'gray')
          const dateLabel = item.date && item.date.value
            ? colorize(item.date.formatted || item.date.value, 'magenta')
            : colorize('none', 'gray')
          const originalPath = colorize(item.original, 'dim')
          const newPath = colorize(item.newName, 'green')
          logger.info(`  ${originalPath} -> ${newPath} (subject: ${subjectLabel}, date: ${dateLabel})`)
          if (Array.isArray(item.segments) && item.segments.length) {
            const segmentSummary = item.segments.map(segment => segment.value).join(' | ')
            logger.info(`    ${colorize('segments:', ['bold', 'cyan'])} ${segmentSummary}`)
          }
        })
      }
      if (moved.length) {
        logger.info(colorize('Moved files:', ['bold', 'cyan']))
        moved.forEach(item => {
          logger.info(`  ${colorize(item.file, 'dim')} -> ${colorize(item.destination, 'cyan')}`)
        })
      }
      if (skipped.length) {
        logger.info(colorize('Skipped files:', ['bold', 'yellow']))
        skipped.forEach(item => {
          logger.info(`  ${colorize(item.file, 'dim')} (${colorize(item.reason, 'yellow')})`)
        })
      }
      if (errors.length) {
        logger.error(colorize('Errors encountered:', ['bold', 'red']))
        errors.forEach(item => {
          logger.error(colorize(`  ${item.file}: ${item.error}`, 'red'))
        })
      }
    },
    export () {
      return { renamed, moved, skipped, errors }
    }
  }
}

module.exports = {
  createSummary
}
