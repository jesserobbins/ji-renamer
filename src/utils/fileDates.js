const METADATA_DATE_KEYS = new Set([
  'date',
  'datetime',
  'creationdate',
  'createdate',
  'creationtime',
  'createdatetime',
  'moddate',
  'modifieddate',
  'modificationdate',
  'lastmodified',
  'capturedate',
  'capturedat',
  'recordeddate',
  'recordedat',
  'timestamp',
  'filedate',
  'releasedate',
  'publishdate',
  'publisheddate',
  'issuedate',
  'shootdate',
  'productiondate'
])

function normaliseDateInput (value) {
  if (!value) return null

  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      return value
    }
    return null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = Date.parse(trimmed)
    if (!Number.isNaN(parsed)) {
      return new Date(parsed)
    }

    const simpleMatch = trimmed.match(/^([0-9]{4})[-_/]?([0-9]{2})[-_/]?([0-9]{2})$/)
    if (simpleMatch) {
      const [, year, month, day] = simpleMatch
      const date = new Date(Number(year), Number(month) - 1, Number(day))
      return Number.isNaN(date.getTime()) ? null : date
    }
  }

  return null
}

function formatDateForFilename (date) {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function extractMetadataDateEntries (metadata, pathSegments = []) {
  if (!metadata || typeof metadata !== 'object') {
    return []
  }

  const entries = []

  if (Array.isArray(metadata)) {
    metadata.forEach((value, index) => {
      const nextPath = [...pathSegments, `[${index}]`]
      if (value && typeof value === 'object') {
        entries.push(...extractMetadataDateEntries(value, nextPath))
      } else if (value) {
        const parsed = normaliseDateInput(value)
        entries.push({
          source: nextPath.join('.'),
          rawValue: value,
          parsedValue: parsed
        })
      }
    })
    return entries
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (!value) continue

    const nextPath = [...pathSegments, key]

    if (typeof value === 'object' && value !== null) {
      entries.push(...extractMetadataDateEntries(value, nextPath))
      continue
    }

    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '')
    if (METADATA_DATE_KEYS.has(normalizedKey)) {
      const parsed = normaliseDateInput(value)
      entries.push({
        source: nextPath.join('.'),
        rawValue: value,
        parsedValue: parsed
      })
    }
  }

  return entries
}

function getDateCandidates (content) {
  if (!content || typeof content !== 'object') {
    return []
  }

  const candidates = []

  const metadataDates = extractMetadataDateEntries(content.metadata)
  if (metadataDates.length) {
    candidates.push(...metadataDates.map((entry) => ({
      source: `metadata.${entry.source}`.replace('.[', '['),
      rawValue: entry.rawValue,
      parsedValue: entry.parsedValue
    })))
  }

  if (content.createdAt) {
    candidates.push({
      source: 'file.createdAt',
      rawValue: content.createdAt,
      parsedValue: normaliseDateInput(content.createdAt)
    })
  }

  if (content.modifiedAt) {
    candidates.push({
      source: 'file.modifiedAt',
      rawValue: content.modifiedAt,
      parsedValue: normaliseDateInput(content.modifiedAt)
    })
  }

  const seen = new Set()

  return candidates.filter((candidate) => {
    const key = candidate.parsedValue ? candidate.parsedValue.toISOString() : String(candidate.rawValue)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  }).map((candidate) => ({
    ...candidate,
    formattedValue: candidate.parsedValue ? formatDateForFilename(candidate.parsedValue) : null
  }))
}

function parsePdfDate (value) {
  if (!value || typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) return null

  const withoutPrefix = trimmed.startsWith('D:') ? trimmed.slice(2) : trimmed
  const match = withoutPrefix.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/) // eslint-disable-line no-useless-escape
  if (!match) {
    return null
  }

  const [
    ,
    year,
    month = '01',
    day = '01',
    hour = '00',
    minute = '00',
    second = '00',
    tz = 'Z'
  ] = match

  let timezone = tz
  if (timezone && timezone !== 'Z') {
    const normalised = timezone.replace(/'/g, '')
    if (/^[+-]\d{4}$/.test(normalised)) {
      timezone = `${normalised.slice(0, 3)}:${normalised.slice(3)}`
    } else {
      timezone = 'Z'
    }
  }

  if (!timezone) {
    timezone = 'Z'
  }

  const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${timezone}`
  const date = new Date(isoString)
  return Number.isNaN(date.getTime()) ? null : date
}

module.exports = {
  getDateCandidates,
  parsePdfDate,
  formatDateForFilename,
  normaliseDateInput
}
