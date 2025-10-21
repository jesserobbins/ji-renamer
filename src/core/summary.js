const { renderPanel } = require('../utils/asciiPanel')

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
      panel.forEach(line => logger.info(line))

      if (renamed.length) {
        logger.info('Renamed files:')
        renamed.forEach(item => {
          const subjectLabel = item.subject ? `${item.subject}` : 'n/a'
          const dateLabel = item.date && item.date.value ? item.date.value : 'none'
          logger.info(`  ${item.original} -> ${item.newName} (subject: ${subjectLabel}, date: ${dateLabel})`)
          if (Array.isArray(item.segments) && item.segments.length) {
            const segmentSummary = item.segments.map(segment => segment.value).join(' | ')
            logger.info(`    segments: ${segmentSummary}`)
          }
        })
      }
      if (moved.length) {
        logger.info('Moved files:')
        moved.forEach(item => {
          logger.info(`  ${item.file} -> ${item.destination}`)
        })
      }
      if (skipped.length) {
        logger.info('Skipped files:')
        skipped.forEach(item => {
          logger.info(`  ${item.file} (${item.reason})`)
        })
      }
      if (errors.length) {
        logger.error('Errors encountered:')
        errors.forEach(item => {
          logger.error(`  ${item.file}: ${item.error}`)
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
