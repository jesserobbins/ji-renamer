const fs = require('fs')
const fsPromises = require('fs/promises')
const path = require('path')

function createNoopLogger () {
  return {
    path: null,
    write: () => {},
    close: async () => {}
  }
}

async function createOperationLog ({ rootDirectory, explicitPath, logger }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const resolvedPath = explicitPath
    ? path.resolve(explicitPath)
    : path.join(rootDirectory, `ji-renamer-log-${timestamp}.jsonl`)

  try {
    await fsPromises.mkdir(path.dirname(resolvedPath), { recursive: true })
    const stream = fs.createWriteStream(resolvedPath, { flags: 'a' })

    stream.on('error', (error) => {
      if (logger) {
        logger.error(`Operation log write error: ${error.message}`)
      }
    })

    if (logger) {
      logger.info(`Logging operations to ${resolvedPath}`)
    }

    return {
      path: resolvedPath,
      write: (entry) => {
        if (!entry || typeof entry !== 'object') return
        try {
          stream.write(`${JSON.stringify(entry)}\n`)
        } catch (error) {
          if (logger) {
            logger.error(`Unable to write to operation log: ${error.message}`)
          }
        }
      },
      close: async () => {
        await new Promise((resolve) => {
          stream.end(resolve)
        })
      }
    }
  } catch (error) {
    if (logger) {
      logger.warn(`Unable to initialise operation log at ${resolvedPath}: ${error.message}`)
    }
    return createNoopLogger()
  }
}

module.exports = {
  createOperationLog
}
