const { promisify } = require('util')
const { execFile } = require('child_process')

const execFileAsync = promisify(execFile)

const MAC_METADATA_KEYS = [
  'kMDItemAuthors',
  'kMDItemCreator',
  'kMDItemTitle',
  'kMDItemSubject',
  'kMDItemKind',
  'kMDItemWhereFroms',
  'kMDItemUserTags',
  'kMDItemSource',
  'kMDItemContentCreationDate',
  'kMDItemContentModificationDate',
  'kMDItemDateAdded',
  'kMDItemDownloadedDate',
  'kMDItemLastUsedDate',
  'kMDItemFinderComment',
  'kMDItemComment',
  'kMDItemFSCreationDate',
  'kMDItemFSContentChangeDate',
  'kMDItemFSName',
  'kMDItemFSSize'
]

function normaliseScalarValue (value) {
  if (value === undefined || value === null) return null

  const trimmed = value.trim()
  if (!trimmed || trimmed === '(null)') {
    return null
  }

  if (trimmed === '""') {
    return ''
  }

  if (/^".*"$/.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch (error) {
      return trimmed.slice(1, -1)
    }
  }

  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed)
    return Number.isNaN(asNumber) ? trimmed : asNumber
  }

  const macDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s([+-]\d{4})$/)
  if (macDateMatch) {
    const [, date, time, tz] = macDateMatch
    const formattedTz = `${tz.slice(0, 3)}:${tz.slice(3)}`
    const isoCandidate = `${date}T${time}${formattedTz}`
    const parsed = new Date(isoCandidate)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  return trimmed
}

function parseMdlsOutput (output) {
  const lines = output.split('\n')
  const result = {}
  let currentKey = null
  let arrayBuffer = []

  const flushArray = () => {
    if (currentKey) {
      result[currentKey] = arrayBuffer
    }
    currentKey = null
    arrayBuffer = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (!currentKey) {
      const separatorIndex = line.indexOf('=')
      if (separatorIndex === -1) {
        continue
      }

      const key = line.slice(0, separatorIndex).trim()
      const value = line.slice(separatorIndex + 1).trim()

      if (value === '(') {
        currentKey = key
        arrayBuffer = []
        continue
      }

      const normalised = normaliseScalarValue(value)
      if (normalised !== null && normalised !== undefined && !(Array.isArray(normalised) && normalised.length === 0)) {
        result[key] = normalised
      }
      continue
    }

    if (line === ')') {
      flushArray()
      continue
    }

    const candidate = line.replace(/,$/, '')
    if (candidate) {
      if (/^".*"$/.test(candidate)) {
        try {
          arrayBuffer.push(JSON.parse(candidate))
          continue
        } catch (error) {
          arrayBuffer.push(candidate.slice(1, -1))
          continue
        }
      }

      const normalised = normaliseScalarValue(candidate)
      if (normalised !== null && normalised !== undefined) {
        arrayBuffer.push(normalised)
      }
    }
  }

  if (currentKey) {
    flushArray()
  }

  return result
}

async function collectSystemMetadata (filePath, logger) {
  if (process.platform !== 'darwin') {
    return null
  }

  try {
    const args = MAC_METADATA_KEYS.flatMap((key) => ['-name', key])
    const { stdout } = await execFileAsync('mdls', [...args, filePath], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    })
    const parsed = parseMdlsOutput(stdout)
    return Object.keys(parsed).length ? parsed : null
  } catch (error) {
    if (error.code !== 'ENOENT' && logger) {
      logger.debug(`Unable to read macOS metadata for ${filePath}: ${error.message}`)
    }
    return null
  }
}

module.exports = {
  collectSystemMetadata
}
