const MONTH_NAME_MAP = new Map([
  ['january', 1],
  ['february', 2],
  ['march', 3],
  ['april', 4],
  ['may', 5],
  ['june', 6],
  ['july', 7],
  ['august', 8],
  ['september', 9],
  ['october', 10],
  ['november', 11],
  ['december', 12]
])

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
  'productiondate',
  'dateadded',
  'downloadeddate',
  'lastuseddate'
])

const DATE_FORMAT_TOKENS = ['YYYY', 'YY', 'MM', 'DD', 'HH', 'mm', 'ss']

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

    const isoParsed = Date.parse(trimmed)
    if (!Number.isNaN(isoParsed)) {
      return new Date(isoParsed)
    }

    const compactMatch = trimmed.match(/^([0-9]{4})[-_/]?([0-9]{2})[-_/]?([0-9]{2})$/)
    if (compactMatch) {
      const [, year, month, day] = compactMatch
      const candidate = new Date(Number(year), Number(month) - 1, Number(day))
      return Number.isNaN(candidate.getTime()) ? null : candidate
    }

    const macMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s([+-]\d{4})$/)
    if (macMatch) {
      const [, datePart, timePart, tz] = macMatch
      const formattedTz = `${tz.slice(0, 3)}:${tz.slice(3)}`
      const candidate = new Date(`${datePart}T${timePart}${formattedTz}`)
      return Number.isNaN(candidate.getTime()) ? null : candidate
    }
  }

  return null
}

function pad (value, length = 2) {
  return String(value).padStart(length, '0')
}

function formatDate (date, format = 'YYYY-MM-DD') {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('formatDate requires a valid Date instance')
  }

  const replacements = {
    YYYY: pad(date.getUTCFullYear(), 4),
    YY: pad(date.getUTCFullYear() % 100, 2),
    MM: pad(date.getUTCMonth() + 1, 2),
    DD: pad(date.getUTCDate(), 2),
    HH: pad(date.getUTCHours(), 2),
    mm: pad(date.getUTCMinutes(), 2),
    ss: pad(date.getUTCSeconds(), 2)
  }

  let output = format
  for (const token of DATE_FORMAT_TOKENS.sort((a, b) => b.length - a.length)) {
    output = output.replace(new RegExp(token, 'g'), replacements[token])
  }
  return output
}

function buildDateFormatRegex (format = 'YYYY-MM-DD') {
  const escaped = format.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  let pattern = escaped

  const tokenPatterns = {
    YYYY: '(\\d{4})',
    YY: '(\\d{2})',
    MM: '(\\d{2})',
    DD: '(\\d{2})',
    HH: '(\\d{2})',
    mm: '(\\d{2})',
    ss: '(\\d{2})'
  }

  for (const token of DATE_FORMAT_TOKENS.sort((a, b) => b.length - a.length)) {
    pattern = pattern.replace(new RegExp(token, 'g'), tokenPatterns[token])
  }

  return new RegExp(pattern)
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

function extractTextDateCandidates (text, limit = 8000) {
  if (typeof text !== 'string' || !text.trim()) {
    return []
  }

  const sample = text.slice(0, limit)
  const results = []
  const seenOffsets = new Set()

  const pushResult = (raw, parsed, index) => {
    if (!parsed || Number.isNaN(parsed.getTime())) return
    if (seenOffsets.has(index)) return
    seenOffsets.add(index)
    const contextStart = Math.max(0, index - 60)
    const contextEnd = Math.min(sample.length, index + raw.length + 60)
    const context = sample.slice(contextStart, contextEnd).replace(/\s+/g, ' ').trim()
    results.push({ rawValue: raw, parsedValue: parsed, context })
  }

  const isoLike = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g
  let match
  while ((match = isoLike.exec(sample)) !== null) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const parsed = new Date(Date.UTC(year, month - 1, day))
      pushResult(match[0], parsed, match.index)
    }
  }

  const monthName = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/gi
  while ((match = monthName.exec(sample)) !== null) {
    const month = MONTH_NAME_MAP.get(match[1].toLowerCase())
    const day = Number(match[2])
    const year = Number(match[3])
    if (day >= 1 && day <= 31) {
      const parsed = new Date(Date.UTC(year, month - 1, day))
      pushResult(match[0], parsed, match.index)
    }
  }

  const dayMonth = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:,)?\s+(\d{4})\b/gi
  while ((match = dayMonth.exec(sample)) !== null) {
    const day = Number(match[1])
    const month = MONTH_NAME_MAP.get(match[2].toLowerCase())
    const year = Number(match[3])
    if (day >= 1 && day <= 31) {
      const parsed = new Date(Date.UTC(year, month - 1, day))
      pushResult(match[0], parsed, match.index)
    }
  }

  return results
}

function candidateFromSource (candidate, { dateFormat }) {
  const parsed = candidate.parsedValue || normaliseDateInput(candidate.rawValue)
  return {
    ...candidate,
    parsedValue: parsed,
    formattedValue: parsed ? formatDate(parsed, dateFormat) : null
  }
}

function addCandidate (map, candidate, options) {
  const parsedCandidate = candidateFromSource(candidate, options)
  if (!parsedCandidate.parsedValue && !parsedCandidate.rawValue) {
    return
  }

  const key = `${parsedCandidate.source}|${parsedCandidate.parsedValue ? parsedCandidate.parsedValue.toISOString() : String(parsedCandidate.rawValue)}`
  const existing = map.get(key)
  if (!existing) {
    map.set(key, parsedCandidate)
    return
  }

  if (parsedCandidate.priority < existing.priority || (parsedCandidate.priority === existing.priority && parsedCandidate.subPriority < existing.subPriority)) {
    map.set(key, { ...existing, ...parsedCandidate })
  }
}

function getMacMetadata (metadata) {
  if (metadata && typeof metadata === 'object' && metadata.mac && typeof metadata.mac === 'object') {
    return metadata.mac
  }
  return null
}

function getDocumentMetadata (metadata) {
  if (metadata && typeof metadata === 'object' && metadata.document && typeof metadata.document === 'object') {
    return metadata.document
  }
  return null
}

function getDateCandidates (content, { dateFormat = 'YYYY-MM-DD' } = {}) {
  if (!content || typeof content !== 'object') {
    return []
  }

  const options = { dateFormat }
  const map = new Map()

  if (content.text) {
    const textCandidates = extractTextDateCandidates(content.text)
    for (const [index, candidate] of textCandidates.entries()) {
      addCandidate(map, {
        source: 'content.text',
        rawValue: candidate.rawValue,
        parsedValue: candidate.parsedValue,
        priority: 1,
        subPriority: index,
        kind: 'content',
        description: 'Date detected within the document text',
        context: candidate.context
      }, options)
    }
  }

  const documentMetadata = getDocumentMetadata(content.metadata)
  if (documentMetadata) {
    if (documentMetadata.creationDate) {
      addCandidate(map, {
        source: 'metadata.document.creationDate',
        rawValue: documentMetadata.creationDate,
        priority: 2,
        subPriority: 0,
        kind: 'documentCreation',
        description: 'Document metadata creation date'
      }, options)
    }
    if (documentMetadata.modificationDate) {
      addCandidate(map, {
        source: 'metadata.document.modificationDate',
        rawValue: documentMetadata.modificationDate,
        priority: 4,
        subPriority: 1,
        kind: 'documentModification',
        description: 'Document metadata modification date'
      }, options)
    }
  }

  const macMetadata = getMacMetadata(content.metadata)
  if (macMetadata) {
    if (macMetadata.kMDItemContentCreationDate) {
      addCandidate(map, {
        source: 'metadata.mac.kMDItemContentCreationDate',
        rawValue: macMetadata.kMDItemContentCreationDate,
        priority: 2,
        subPriority: 1,
        kind: 'documentCreation',
        description: 'macOS content creation date'
      }, options)
    }
    if (macMetadata.kMDItemFSCreationDate) {
      addCandidate(map, {
        source: 'metadata.mac.kMDItemFSCreationDate',
        rawValue: macMetadata.kMDItemFSCreationDate,
        priority: 2,
        subPriority: 2,
        kind: 'fileCreation',
        description: 'Filesystem creation date (macOS)'
      }, options)
    }
    if (macMetadata.kMDItemDateAdded) {
      addCandidate(map, {
        source: 'metadata.mac.kMDItemDateAdded',
        rawValue: macMetadata.kMDItemDateAdded,
        priority: 3,
        subPriority: 0,
        kind: 'fileAdded',
        description: 'Date added to the filesystem'
      }, options)
    }
    if (macMetadata.kMDItemDownloadedDate) {
      addCandidate(map, {
        source: 'metadata.mac.kMDItemDownloadedDate',
        rawValue: macMetadata.kMDItemDownloadedDate,
        priority: 3,
        subPriority: 1,
        kind: 'fileAdded',
        description: 'Downloaded date from macOS metadata'
      }, options)
    }
    if (macMetadata.kMDItemFSContentChangeDate) {
      addCandidate(map, {
        source: 'metadata.mac.kMDItemFSContentChangeDate',
        rawValue: macMetadata.kMDItemFSContentChangeDate,
        priority: 4,
        subPriority: 0,
        kind: 'fileModified',
        description: 'Filesystem content change date'
      }, options)
    }
    if (macMetadata.kMDItemLastUsedDate) {
      addCandidate(map, {
        source: 'metadata.mac.kMDItemLastUsedDate',
        rawValue: macMetadata.kMDItemLastUsedDate,
        priority: 5,
        subPriority: 0,
        kind: 'lastUsed',
        description: 'Last used date from macOS metadata'
      }, options)
    }
  }

  if (content.createdAt) {
    addCandidate(map, {
      source: 'file.createdAt',
      rawValue: content.createdAt,
      priority: 2,
      subPriority: 3,
      kind: 'fileCreation',
      description: 'Filesystem creation timestamp'
    }, options)
  }

  if (content.modifiedAt) {
    addCandidate(map, {
      source: 'file.modifiedAt',
      rawValue: content.modifiedAt,
      priority: 4,
      subPriority: 1,
      kind: 'fileModified',
      description: 'Filesystem modified timestamp'
    }, options)
  }

  const metadataCandidates = extractMetadataDateEntries(content.metadata)
  for (const candidate of metadataCandidates) {
    const lowerSource = candidate.source.toLowerCase()
    let priority = 5
    const subPriority = 0
    let kind = 'metadata'
    let description = 'Other metadata date value'

    if (lowerSource.includes('creation') && priority > 2) {
      priority = 2
      kind = 'documentCreation'
      description = 'Metadata creation date'
    } else if (lowerSource.includes('dateadded') || lowerSource.includes('downloaded')) {
      priority = 3
      kind = 'fileAdded'
      description = 'Metadata added/downloaded date'
    } else if (lowerSource.includes('modified') || lowerSource.includes('modification')) {
      priority = 4
      kind = 'fileModified'
      description = 'Metadata modification date'
    }

    addCandidate(map, {
      source: `metadata.${candidate.source}`,
      rawValue: candidate.rawValue,
      parsedValue: candidate.parsedValue,
      priority,
      subPriority,
      kind,
      description
    }, options)
  }

  const candidates = Array.from(map.values())
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    if (a.subPriority !== b.subPriority) return a.subPriority - b.subPriority
    if (a.parsedValue && b.parsedValue) {
      return a.parsedValue.getTime() - b.parsedValue.getTime()
    }
    return 0
  })

  return candidates
}

function parsePdfDate (value) {
  if (!value || typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) return null

  const withoutPrefix = trimmed.startsWith('D:') ? trimmed.slice(2) : trimmed
  const match = withoutPrefix.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/)
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
  formatDate,
  normaliseDateInput,
  buildDateFormatRegex
}
