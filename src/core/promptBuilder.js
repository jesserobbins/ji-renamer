const { getDateCandidates } = require('../utils/fileDates')

function buildDefaultSystemMessage (options) {
  const instructions = [
    'You are an analyst tasked with renaming downloaded diligence artifacts. Read the provided context and return a JSON object with the following shape:\n{\n  "filename": string,\n  "subject": string | null,\n  "subject_confidence": number (0-1),\n  "summary": string\n}.',
    '- The filename MUST be concise, descriptive, and avoid filesystem-invalid characters.',
    `- Prefer ${options.case || 'kebabCase'} case.`,
    `- Honour the requested language: ${options.language || 'English'}.`,
    '- Subjects represent the company, project, or person tied to the file. Use null if you are unsure.',
    '- subject_confidence should reflect how certain you are about the subject.'
  ]

  if (options.appendDate) {
    const format = options.dateFormat || 'YYYY-MM-DD'
    instructions.push(`- When date candidates are provided, append the most relevant date to the filename in ${format} format.`)
    instructions.push('- Prioritise dates in this order: (1) dates clearly identified in the document text/OCR, (2) the original document creation date (document metadata first, then filesystem metadata), (3) the download/added date when no better option exists, and only then fall back to other dates.')
    instructions.push('- Include an "applied_date" object in your JSON response describing the date you appended. Use the shape { "value": string | null, "source": string | null, "rationale": string | null } and ensure "value" matches the appended date.')
  }

  return instructions.join('\n')
}

function flattenMetadata (metadata, path = []) {
  if (!metadata || typeof metadata !== 'object') {
    return []
  }

  const rows = []
  for (const [key, value] of Object.entries(metadata)) {
    const nextPath = [...path, key]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      rows.push(...flattenMetadata(value, nextPath))
      continue
    }

    if (Array.isArray(value)) {
      rows.push({ key: nextPath.join('.'), value: value.join(', ') })
      continue
    }

    rows.push({ key: nextPath.join('.'), value })
  }
  return rows
}

function buildPrompt ({ content, options, subjectHints, instructionSet, dateCandidates }) {
  const systemMessage = instructionSet?.systemMessage || buildDefaultSystemMessage(options)

  const segments = []
  segments.push(`Original filename: ${content.fileName}`)
  segments.push(`Extension: ${content.extension}`)
  segments.push(`Size: ${content.sizeBytes} bytes`)
  segments.push(`Modified: ${content.modifiedAt}`)
  if (content.createdAt) {
    segments.push(`Created: ${content.createdAt}`)
  }

  if (content.metadata) {
    const metadataLines = flattenMetadata(content.metadata)
      .filter((entry) => entry.value !== undefined && entry.value !== null && entry.value !== '')
      .map((entry) => `${entry.key}: ${entry.value}`)
    if (metadataLines.length) {
      segments.push('Metadata:')
      segments.push(...metadataLines)
    }
  }

  if (content.ocr) {
    const ocrDetails = Object.entries(content.ocr)
      .map(([key, value]) => `${key}: ${value}`)
    if (ocrDetails.length) {
      segments.push('OCR details:')
      segments.push(...ocrDetails)
    }
  }

  if (options.appendDate) {
    const resolvedCandidates = dateCandidates && Array.isArray(dateCandidates) ? dateCandidates : getDateCandidates(content, { dateFormat: options.dateFormat })
    const format = options.dateFormat || 'YYYY-MM-DD'
    segments.push(`Append-date mode is enabled. Include the most relevant date in the filename using ${format} format.`)
    segments.push('Date selection priority reminder: 1) Document text/OCR dates 2) Original creation (metadata then filesystem) 3) Added/downloaded dates 4) Other candidates as a last resort.')
    if (resolvedCandidates.length) {
      segments.push('Available date candidates (highest priority first):')
      for (const candidate of resolvedCandidates) {
        const raw = typeof candidate.rawValue === 'string' ? candidate.rawValue : JSON.stringify(candidate.rawValue)
        const formatted = candidate.formattedValue ? `parsed=${candidate.formattedValue}` : 'parsed=unavailable'
        const detailParts = [`priority=${candidate.priority}`, `source=${candidate.source}`, formatted, `raw=${raw}`]
        if (candidate.description) {
          detailParts.push(`note=${candidate.description}`)
        }
        if (candidate.context) {
          detailParts.push(`context=${candidate.context}`)
        }
        segments.push(detailParts.join(' | '))
      }
    } else {
      segments.push('No explicit date metadata detected; infer from content if possible.')
    }
  }

  if (content.text) {
    segments.push('Extracted text snippet:')
    segments.push(content.text)
  }

  if (content.image) {
    const preview = content.image.base64.slice(0, 4000)
    segments.push('Image preview (base64, truncated):')
    segments.push(preview)
  }

  if (content.binarySnippet) {
    segments.push('Binary preview (base64, truncated):')
    segments.push(content.binarySnippet)
  }

  if (content.frames && content.frames.length) {
    const duration = typeof content.duration === 'number' ? content.duration.toFixed(1) : content.duration
    segments.push(`Video context: ${content.frameCount} frames sampled over ${duration} seconds.`)
    if (content.frameError) {
      segments.push(`Frame extraction warning: ${content.frameError}`)
    }
  }

  if (content.frameError && !content.frames?.length) {
    segments.push(`Unable to extract frames: ${content.frameError}`)
  }

  if (subjectHints && subjectHints.length) {
    segments.push(`Known subjects in this workspace: ${subjectHints.join(', ')}`)
  }

  if (instructionSet?.subjectStopwords?.length) {
    segments.push('Subject tokens to ignore:')
    segments.push(instructionSet.subjectStopwords.join(', '))
  }

  if (options.customPrompt) {
    segments.push(`Additional instructions: ${options.customPrompt}`)
  }

  const userMessage = segments.join('\\n\\n')

  return {
    systemMessage,
    userMessage,
    images: content.image ? [content.image] : [],
    frames: content.frames || []
  }
}

module.exports = {
  buildPrompt
}
