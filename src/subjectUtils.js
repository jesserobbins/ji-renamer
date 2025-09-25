const LOW_SUBJECT_KEYS = new Set([
  'unknown',
  'misc',
  'various',
  'untitled',
  'na',
  'n-a',
  'other',
  'general'
])

const stripDiacritics = (value) => {
  try {
    return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  } catch (err) {
    return value
  }
}

const collapseSeparators = (value) => {
  return value
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const normalizeSubjectKey = (value) => {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const ascii = stripDiacritics(text)
  const collapsed = collapseSeparators(ascii)
  return collapsed ? collapsed.toLowerCase() : null
}

const sanitizeSubjectFolderName = (value, fallback = 'Subject') => {
  if (!value) return fallback
  const text = String(value).trim()
  if (!text) return fallback
  const ascii = stripDiacritics(text)
  const collapsed = collapseSeparators(ascii)
  return collapsed || fallback
}

const humanizeFolderName = (value) => {
  if (!value) return ''
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const normalizeSubjectConfidence = (value) => {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!text) return null
  const lowered = text.toLowerCase()

  if (/(^|\b)(high|strong|certain|confident|definite|clear)/.test(lowered)) {
    return 'high'
  }
  if (/(^|\b)(medium|moderate|fair|balanced)/.test(lowered)) {
    return 'medium'
  }
  if (/(^|\b)(low|weak|uncertain|doubtful|tentative|guess|maybe|unsure)/.test(lowered)) {
    return 'low'
  }
  if (/(unknown|unsure|n\/a|not sure|unclear|indeterminate)/.test(lowered)) {
    return 'unknown'
  }

  const numeric = Number.parseFloat(lowered)
  if (!Number.isNaN(numeric)) {
    if (numeric >= 0.75) return 'high'
    if (numeric >= 0.4) return 'medium'
    if (numeric > 0) return 'low'
    return 'unknown'
  }

  return null
}

const isLowConfidenceSubject = ({ subject, confidence }) => {
  if (!subject) return true
  const normalizedKey = normalizeSubjectKey(subject)
  if (!normalizedKey) return true
  if (LOW_SUBJECT_KEYS.has(normalizedKey.replace(/-/g, ''))) {
    return true
  }

  const normalizedConfidence = normalizeSubjectConfidence(confidence)
  if (!normalizedConfidence) return false
  return normalizedConfidence === 'low' || normalizedConfidence === 'unknown'
}

module.exports = {
  humanizeFolderName,
  isLowConfidenceSubject,
  normalizeSubjectConfidence,
  normalizeSubjectKey,
  sanitizeSubjectFolderName
}
