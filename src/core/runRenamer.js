const fs = require('fs/promises')
const fssync = require('fs')
const path = require('path')
const { discoverFiles } = require('./discoverFiles')
const { applyFilters } = require('./applyFilters')
const { extractContent } = require('../extractors/contentExtractor')
const { buildPrompt } = require('./promptBuilder')
const { createProviderClient } = require('../providers/createProviderClient')
const { applyCase } = require('../utils/caseFormat')
const { sanitizeFilename, truncateFilename, ensureUniqueName } = require('../utils/sanitize')
const { getExtension } = require('../utils/fileType')
const { createSubjectManager } = require('./subjectManager')
const { createSummary } = require('./summary')
const { parseModelResponse } = require('../utils/parseModelResponse')
const { createInstructionSet } = require('./instructionSet')
const { getDateCandidates, buildDateFormatRegex } = require('../utils/fileDates')
const { createOperationLog } = require('../utils/operationLog')
const { renderPanel, applyPanelTheme } = require('../utils/asciiPanel')
const { colorize } = require('../utils/ansi')

const DATE_TOKEN_PATTERN = /(YYYY|YY|MM|DD|HH|mm|ss)/

function resolveDatePreferences (options = {}) {
  const rawTemplate = typeof options.dateFormat === 'string' ? options.dateFormat.trim() : ''
  const rawValueFormat = typeof options.dateValueFormat === 'string' ? options.dateValueFormat.trim() : ''
  const hasPlaceholder = /\$\{(value|cased)\}/.test(rawTemplate)
  const containsTokens = DATE_TOKEN_PATTERN.test(rawTemplate)

  const valueFormat = rawValueFormat || (containsTokens ? rawTemplate : 'YYYY-MM-DD')

  let template = '${value}'
  if (hasPlaceholder) {
    template = rawTemplate
  } else if (!rawTemplate && rawValueFormat) {
    template = '${value}'
  } else if (containsTokens && !hasPlaceholder) {
    template = '${value}'
  } else if (rawTemplate) {
    template = '${value}'
  }

  return { template, valueFormat }
}

function stripTrailingDate (value, pattern) {
  if (!value || typeof value !== 'string' || !(pattern instanceof RegExp)) {
    return value
  }

  const source = pattern.source
  if (!source) return value

  const trailingPattern = new RegExp(`(?:[\n\r\t\s._-]*${source})$`, 'i')
  if (!trailingPattern.test(value)) {
    return value
  }

  return value
    .replace(trailingPattern, '')
    .replace(/[-_.\s]+$/, '')
}

function emitPanel (logger, level, title, lines, theme = {}) {
  if (!logger || typeof logger[level] !== 'function') {
    return
  }
  const panel = renderPanel(title, lines)
  const panelLines = applyPanelTheme(panel, theme)
  for (const line of panelLines) {
    logger[level](line)
  }
}

const PANEL_THEMES = {
  dryRun: {
    border: 'cyan',
    header: ['bold', 'cyan'],
    label: ['bold', 'cyan'],
    value: 'white'
  },
  success: {
    border: 'green',
    header: ['bold', 'green'],
    label: ['bold', 'green'],
    value: 'white'
  }
}

function formatSegmentSummary (segmentDetails, separator) {
  if (!Array.isArray(segmentDetails) || segmentDetails.length === 0) {
    return 'none'
  }
  const joiner = separator ? ` ${separator} ` : ' '
  return segmentDetails.map(detail => detail.value).join(joiner)
}

function formatConfidence (value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a'
  }
  const percentage = Math.round(value * 100)
  return `${Math.max(0, Math.min(100, percentage))}%`
}

function formatTemplateSegment (template, value, caseStyle) {
  if (!template || typeof template !== 'string') return ''
  if (!value || typeof value !== 'string') return ''

  const trimmed = value.trim()
  if (!trimmed) return ''

  const replacements = {
    value: trimmed,
    cased: applyCase(trimmed, caseStyle || 'kebabCase')
  }

  return template.replace(/\$\{(value|cased)\}/g, (_, key) => replacements[key] || '')
    .trim()
}

function normaliseModelResult (rawResult) {
  if (!rawResult || typeof rawResult !== 'object') {
    throw new Error('Model response missing expected JSON object')
  }

  if (rawResult.data && typeof rawResult.data === 'string') {
    return normaliseModelResult(parseModelResponse(rawResult.data))
  }

  const filename = rawResult.filename || rawResult.fileName || rawResult.name
  const subject = rawResult.subject ?? rawResult.topic ?? null
  const summary = rawResult.summary || rawResult.reason || ''
  const subjectConfidence = rawResult.subject_confidence ?? rawResult.subjectConfidence ?? null
  const subjectBriefRaw = rawResult.subject_brief ?? rawResult.subjectBrief ?? null
  const documentDescriptionRaw = rawResult.document_description ?? rawResult.documentDescription ?? null
  const appliedDateRaw = rawResult.applied_date ?? rawResult.appliedDate ?? null

  if (!filename) {
    throw new Error('Model response missing "filename" field')
  }

  let appliedDate = { value: null, source: null, rationale: null }
  if (appliedDateRaw && typeof appliedDateRaw === 'object') {
    appliedDate = {
      value: typeof appliedDateRaw.value === 'string' ? appliedDateRaw.value.trim() || null : null,
      source: typeof appliedDateRaw.source === 'string' ? appliedDateRaw.source : null,
      rationale: typeof appliedDateRaw.rationale === 'string' ? appliedDateRaw.rationale : null
    }
  } else if (typeof appliedDateRaw === 'string') {
    appliedDate = {
      value: appliedDateRaw.trim() || null,
      source: null,
      rationale: null
    }
  }

  return {
    filename,
    subject,
    summary,
    subjectConfidence: typeof subjectConfidence === 'number' ? subjectConfidence : null,
    subjectBrief: typeof subjectBriefRaw === 'string' ? subjectBriefRaw.trim() || null : null,
    documentDescription: typeof documentDescriptionRaw === 'string' ? documentDescriptionRaw.trim() || null : null,
    appliedDate
  }
}

async function runRenamer (targetPath, options, logger) {
  const runStep = async (label, intention, fn) => {
    if (logger && typeof logger.time === 'function') {
      return logger.time(label, intention, fn)
    }
    return fn()
  }

  const stats = await runStep('fs.stat', `Inspecting target path ${targetPath}`, () => fs.stat(targetPath))
  const rootDirectory = stats.isDirectory() ? targetPath : path.dirname(targetPath)
  const files = await runStep('discoverFiles', `Scanning for files starting at ${targetPath}`, () => discoverFiles(targetPath, options.includeSubdirectories))
  logger.debug(`discoverFiles returned ${files.length} candidate file(s).`)
  if (!files.length) {
    logger.warn(colorize('No files found to process.', 'yellow'))
    return
  }

  const provider = await runStep('createProviderClient', `Initialising provider client (${options.provider || 'ollama'})`, () => createProviderClient(options, logger))
  const instructionSet = await runStep('createInstructionSet', 'Loading instruction set', () => createInstructionSet(options, logger))

  const { template: dateTemplate, valueFormat: dateValueFormat } = resolveDatePreferences(options)

  const operationLog = await runStep('operationLog.create', 'Preparing operation log', () => createOperationLog({
    rootDirectory,
    explicitPath: options.logFile,
    logger
  }))
  const datePattern = buildDateFormatRegex(dateValueFormat)

  let subjectManager = null
  if (options.organizeBySubject) {
    const subjectBase = path.resolve(options.subjectDestination || rootDirectory)
    subjectManager = await runStep('subjectManager.init', `Preparing subject folders at ${subjectBase}`, () => createSubjectManager({
      baseDirectory: subjectBase,
      moveUnknownSubjects: Boolean(options.moveUnknownSubjects)
    }, logger))
  }

  const summary = createSummary()

  for (const filePath of files) {
    try {
      const filterResult = await runStep('applyFilters', `Evaluating filters for ${path.basename(filePath)}`, () => applyFilters(filePath, options))
      if (filterResult.skipped) {
        logger.info(colorize(`Skipping ${filePath}: ${filterResult.reason}`, 'yellow'))
        summary.addSkip({ file: filePath, reason: filterResult.reason })
        operationLog.write({
          timestamp: new Date().toISOString(),
          operation: 'skip',
          file: filePath,
          reason: filterResult.reason
        })
        continue
      }

      logger.info(`Processing ${filePath}`)
      const content = await runStep('extractContent', `Extracting content from ${path.basename(filePath)}`, () => extractContent(filePath, options, logger))
      const dateCandidates = options.appendDate ? getDateCandidates(content, { dateFormat: dateValueFormat }) : []
      const subjectHints = subjectManager ? subjectManager.getHints() : []
      const promptOptions = { ...options, dateValueFormat, dateFormatTemplate: dateTemplate }
      const prompt = await runStep('buildPrompt', `Constructing prompt for ${path.basename(filePath)}`, () => buildPrompt({ content, options: promptOptions, subjectHints, instructionSet, dateCandidates }))
      const modelResponse = await runStep('provider.generateFilename', `Requesting filename suggestion for ${path.basename(filePath)}`, () => provider.generateFilename(prompt))
      const { filename, subject, summary: fileSummary, subjectConfidence, appliedDate, subjectBrief, documentDescription } = normaliseModelResult(modelResponse)

      const cleanedSubject = instructionSet?.sanitizeSubject ? instructionSet.sanitizeSubject(subject) : subject
      const effectiveSubject = cleanedSubject || null
      const effectiveConfidence = effectiveSubject ? subjectConfidence : 0

      const extension = getExtension(filePath).replace('.', '')
      const caseStyle = options.case || 'kebabCase'
      const baseWithoutExt = filename.replace(/\.[^./]+$/, '')
      let workingBase = baseWithoutExt

      let appliedDateValue = appliedDate?.value ? appliedDate.value.trim() : ''
      let appliedDateSource = appliedDate?.source || null
      const appliedDateRationale = appliedDate?.rationale || null

      if (options.appendDate && !appliedDateValue) {
        const baseMatch = workingBase ? workingBase.match(datePattern) : null
        if (baseMatch) {
          appliedDateValue = baseMatch[0]
          if (!appliedDateSource) {
            appliedDateSource = 'filename'
          }
        }
      }

      if (options.appendDate && appliedDateValue) {
        workingBase = stripTrailingDate(workingBase, datePattern)
      }

      const formattedBase = workingBase ? applyCase(workingBase, caseStyle) : ''
      const subjectTemplateValue = effectiveSubject || null
      const formattedSubjectSegment = formatTemplateSegment(options.subjectFormat, subjectTemplateValue, caseStyle)
      const formattedSubjectBriefSegment = formatTemplateSegment(options.subjectBriefFormat, subjectBrief, caseStyle)
      const formattedDocumentDescriptionSegment = formatTemplateSegment(options.documentDescriptionFormat, documentDescription, caseStyle)

      const separator = typeof options.segmentSeparator === 'string' ? options.segmentSeparator : '-'
      const segmentDetails = []
      const segments = []

      if (formattedSubjectSegment) {
        segments.push(formattedSubjectSegment)
        segmentDetails.push({ type: 'subject', value: formattedSubjectSegment, raw: subjectTemplateValue, template: options.subjectFormat || null })
      }
      if (formattedSubjectBriefSegment) {
        segments.push(formattedSubjectBriefSegment)
        segmentDetails.push({ type: 'subject-brief', value: formattedSubjectBriefSegment, raw: subjectBrief, template: options.subjectBriefFormat || null })
      }
      if (formattedDocumentDescriptionSegment) {
        segments.push(formattedDocumentDescriptionSegment)
        segmentDetails.push({ type: 'document-description', value: formattedDocumentDescriptionSegment, raw: documentDescription, template: options.documentDescriptionFormat || null })
      }

      if (!segments.length && formattedBase) {
        segments.push(formattedBase)
        segmentDetails.push({ type: 'title', value: formattedBase, raw: workingBase })
      }

      if (!segments.length) {
        const fallbackSource = workingBase || baseWithoutExt || 'untitled'
        const fallbackValue = applyCase(fallbackSource, caseStyle)
        segments.push(fallbackValue)
        segmentDetails.push({ type: 'title', value: fallbackValue, raw: fallbackSource })
      }

      let formattedDateSegment = ''
      if (options.appendDate && appliedDateValue) {
        formattedDateSegment = formatTemplateSegment(dateTemplate, appliedDateValue, caseStyle) || ''
        if (formattedDateSegment) {
          segments.push(formattedDateSegment)
          segmentDetails.push({ type: 'date', value: formattedDateSegment, raw: appliedDateValue, template: dateTemplate, source: appliedDateSource || null })
        }
      }

      const combinedBase = segments.join(separator)
      const truncatedCombined = options.chars ? truncateFilename(combinedBase, options.chars) : combinedBase
      const sanitizedName = sanitizeFilename(truncatedCombined, extension)

      let destinationDirectory = path.dirname(filePath)
      let resolvedSubject = effectiveSubject

      if (subjectManager) {
        const subjectResolution = await runStep('subjectManager.resolve', `Resolving destination for ${path.basename(filePath)}`, () => subjectManager.resolveDestination({
          subject: effectiveSubject,
          confidence: effectiveConfidence
        }))
        if (subjectResolution) {
          destinationDirectory = subjectResolution.directory
          resolvedSubject = subjectResolution.subject
        }
      }

      await runStep('fs.mkdir', `Ensuring destination directory ${destinationDirectory}`, () => fs.mkdir(destinationDirectory, { recursive: true }))

      const finalName = await runStep('ensureUniqueName', `Ensuring unique filename for ${sanitizedName}`, () => ensureUniqueName(destinationDirectory, sanitizedName, fssync.existsSync))
      const destinationPath = path.join(destinationDirectory, finalName)

      if (options.appendDate && !appliedDateValue) {
        const baseWithoutExtension = finalName.replace(/\.[^./]+$/, '')
        const match = baseWithoutExtension.match(datePattern)
        if (match) {
          appliedDateValue = match[0]
          if (!appliedDateSource) {
            appliedDateSource = 'filename'
          }
          if (!formattedDateSegment) {
            formattedDateSegment = formatTemplateSegment(dateTemplate, appliedDateValue, caseStyle) || ''
            if (formattedDateSegment) {
              segmentDetails.push({ type: 'date', value: formattedDateSegment, raw: appliedDateValue, template: dateTemplate, source: appliedDateSource || null })
            }
          }
        }
      }

      const appliedDateRecord = {
        value: appliedDateValue || null,
        source: appliedDateSource,
        rationale: appliedDateRationale,
        formatted: formattedDateSegment || null
      }

      if (appliedDateRecord.value) {
        const formattedHint = appliedDateRecord.formatted && appliedDateRecord.formatted !== appliedDateRecord.value
          ? ` → ${appliedDateRecord.formatted}`
          : ''
        const sourceLabel = appliedDateRecord.source ? ` (source: ${appliedDateRecord.source})` : ''
        logger.info(colorize(`Selected date for ${path.basename(filePath)}: ${appliedDateRecord.value}${formattedHint}${sourceLabel}`, 'magenta'))
      } else if (options.appendDate) {
        logger.warn(`No date appended for ${path.basename(filePath)} despite append-date being enabled.`)
      }

      const originalName = path.basename(filePath)
      const moved = destinationDirectory !== path.dirname(filePath)
      const segmentSummary = formatSegmentSummary(segmentDetails, separator)
      const subjectLine = resolvedSubject ? `${resolvedSubject} (${formatConfidence(effectiveConfidence)})` : 'n/a'
      const dateLine = appliedDateRecord.value
        ? `${appliedDateRecord.formatted || appliedDateRecord.value}${appliedDateRecord.source ? ` [${appliedDateRecord.source}]` : ''}`
        : 'none'
      const nameLabel = options.dryRun ? 'Preview' : 'New Name'
      const panelLines = [
        `Original : ${originalName}`,
        `${nameLabel.padEnd(8)} : ${finalName}`,
        `Segments : ${segmentSummary}`,
        `Subject  : ${subjectLine}`,
        subjectBrief ? `Brief    : ${subjectBrief}` : null,
        documentDescription ? `Doc Desc : ${documentDescription}` : null,
        `Date     : ${dateLine}`,
        appliedDateRecord.rationale ? `Rationale: ${appliedDateRecord.rationale}` : null,
        fileSummary ? `Notes    : ${fileSummary}` : null,
        `Move     : ${moved ? `→ ${destinationDirectory}` : 'no move'}`
      ].filter(Boolean)

      if (options.dryRun) {
        emitPanel(logger, 'info', '✱ DRY RUN PLAN', panelLines, PANEL_THEMES.dryRun)
        summary.addRename({
          original: filePath,
          newName: destinationPath,
          subject: resolvedSubject,
          confidence: effectiveConfidence,
          notes: fileSummary,
          subjectBrief,
          documentDescription,
          segments: segmentDetails,
          date: appliedDateRecord
        })
        operationLog.write({
          timestamp: new Date().toISOString(),
          operation: 'dry-run',
          originalPath: filePath,
          proposedPath: destinationPath,
          subject: resolvedSubject,
          subjectConfidence: effectiveConfidence,
          summary: fileSummary,
          subjectBrief,
          documentDescription,
          date: appliedDateRecord,
          dateCandidates,
          segments: segmentDetails,
          segmentSeparator: separator,
          moved
        })
        continue
      }

      await runStep('fs.rename', `Renaming ${path.basename(filePath)} to ${finalName}`, () => fs.rename(filePath, destinationPath))
      emitPanel(logger, 'info', '✓ RENAMED', panelLines)
      summary.addRename({
        original: filePath,
        newName: destinationPath,
        subject: resolvedSubject,
        confidence: effectiveConfidence,
        notes: fileSummary,
        subjectBrief,
        documentDescription,
        segments: segmentDetails,
        date: appliedDateRecord
      })
      if (moved) {
        summary.addMove({ file: destinationPath, destination: destinationDirectory, subject: resolvedSubject })
      }

      operationLog.write({
        timestamp: new Date().toISOString(),
        operation: 'rename',
        originalPath: filePath,
        newPath: destinationPath,
        subject: resolvedSubject,
        subjectConfidence: effectiveConfidence,
        summary: fileSummary,
        subjectBrief,
        documentDescription,
        date: appliedDateRecord,
        dateCandidates,
        segments: segmentDetails,
        segmentSeparator: separator,
        moved
      })
    } catch (error) {
      logger.error(colorize(`Error processing ${filePath}: ${error.message}`, 'red'))
      summary.addError({ file: filePath, error: error.message })
      operationLog.write({
        timestamp: new Date().toISOString(),
        operation: 'error',
        file: filePath,
        error: error.message
      })
    }
  }

  if (options.summary) {
    summary.print(logger)
  }

  await operationLog.close()

  return summary.export()
}

module.exports = {
  runRenamer
}
