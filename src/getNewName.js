const changeCase = require('./changeCase')
const getModelResponse = require('./getModelResponse')

const LABEL_REGEX = /^(?:filename|file name|suggested filename|suggested file name|name|title)\s*(?:is|=|:)?\s*/i
const QUOTE_REGEX = /[`"'“”‘’]/g
const INVALID_FILENAME_CHARS = /[^\p{L}\p{N}\s_-]+/gu

const sanitizeSegment = (segment) => {
  if (!segment) return ''
  const withoutQuotes = segment.replace(QUOTE_REGEX, '')
  const withoutLabel = withoutQuotes.replace(LABEL_REGEX, '')
  return withoutLabel
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const shortenToLimit = (text, limit) => {
  if (!text || !limit || text.length <= limit) return text
  const words = text.split(/\s+/)
  let candidate = ''

  for (const word of words) {
    const next = candidate ? `${candidate} ${word}` : word
    if (next.length > limit) break
    candidate = next
  }

  return candidate || text.slice(0, limit)
}

const extractFilenameCandidate = ({ modelResult, maxChars }) => {
  if (!modelResult) return ''

  const normalized = modelResult
    .replace(/\r/g, '\n')
    .split('\u0000').join('')
    .trim()

  if (!normalized) return ''

  const segments = []
  const patternRegexes = [
    /(?:filename|file name)\s*(?:is|=|:)\s*([^\n]+)/i,
    /(?:suggested|proposed|recommended)\s*(?:filename|file name)\s*(?:is|=|:)?\s*([^\n]+)/i,
    /name\s*[:：]\s*([^\n]+)/i
  ]

  for (const regex of patternRegexes) {
    const match = normalized.match(regex)
    if (match && match[1]) segments.push(match[1])
  }

  segments.push(...normalized.split(/\r?\n/))
  segments.push(...normalized.split(/[,;]+/))

  const seen = new Set()

  for (const segment of segments) {
    const cleaned = sanitizeSegment(segment)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const shortened = shortenToLimit(cleaned, maxChars)
    if (shortened) return shortened
  }

  const fallback = sanitizeSegment(normalized)
  return shortenToLimit(fallback, maxChars)
}

const trimToBoundary = (text, limit) => {
  if (!text || !limit || text.length <= limit) return text

  const applySeparator = (separator) => {
    if (!text.includes(separator)) return ''
    const parts = text.split(separator)
    let result = ''

    for (const part of parts) {
      if (!part) continue
      const next = result ? `${result}${separator}${part}` : part
      if (next.length > limit) break
      result = next
    }

    return result
  }

  const byHyphen = applySeparator('-')
  if (byHyphen) return byHyphen

  const byUnderscore = applySeparator('_')
  if (byUnderscore) return byUnderscore

  return text.slice(0, limit).replace(/[-_]+$/g, '')
}

const enforceLengthLimit = (value, limit) => {
  if (!value) return value
  if (!Number.isFinite(limit) || limit <= 0) return value
  if (value.length <= limit) return value
  return trimToBoundary(value, limit) || value.slice(0, limit)
}

module.exports = async options => {
  const { _case, chars, content, language, videoPrompt, customPrompt, relativeFilePath } = options

  try {
    const promptLines = [
      'Generate filename:',
      '',
      `Use ${_case}`,
      `Max ${chars} characters`,
      `${language} only`,
      'No file extension',
      'No special chars',
      'Only key elements',
      'One word if possible',
      'Noun-verb format',
      '',
      'Respond ONLY with filename.'
    ]

    if (videoPrompt) {
      promptLines.unshift(videoPrompt, '')
    }

    if (content) {
      promptLines.push('', 'Content:', content)
    }

    if (customPrompt) {
      promptLines.push('', 'Custom instructions:', customPrompt)
    }

    const prompt = promptLines.join('\n')
    const modelResult = await getModelResponse({ ...options, prompt })

    const safeCharLimit = Number.isFinite(chars) && chars > 0 ? Math.floor(chars) : 20
    const candidateLimit = Math.min(safeCharLimit + 20, 120)
    const candidate = extractFilenameCandidate({ modelResult, maxChars: candidateLimit }) || 'renamed file'

    let filename = await changeCase({ text: candidate, _case })
    filename = enforceLengthLimit(filename, safeCharLimit)

    if (!filename) {
      const fallbackName = await changeCase({ text: 'renamed file', _case })
      filename = enforceLengthLimit(fallbackName, safeCharLimit)
    }

    return filename
  } catch (err) {
    console.log(`🔴 Model error: ${err.message} (${relativeFilePath})`)
  }
}
