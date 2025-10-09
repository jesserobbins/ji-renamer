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
    appliedDate
  }
}

async function runRenamer (targetPath, options, logger) {
  const stats = await fs.stat(targetPath)
  const rootDirectory = stats.isDirectory() ? targetPath : path.dirname(targetPath)
  const files = await discoverFiles(targetPath, options.includeSubdirectories)
  if (!files.length) {
    logger.warn('No files found to process.')
    return
  }

  const provider = createProviderClient(options, logger)
  const instructionSet = await createInstructionSet(options, logger)

  const operationLog = await createOperationLog({
    rootDirectory,
    explicitPath: options.logFile,
    logger
  })
  const datePattern = buildDateFormatRegex(options.dateFormat || 'YYYY-MM-DD')

  let subjectManager = null
  if (options.organizeBySubject) {
    const subjectBase = path.resolve(options.subjectDestination || rootDirectory)
    subjectManager = await createSubjectManager({
      baseDirectory: subjectBase,
      moveUnknownSubjects: Boolean(options.moveUnknownSubjects)
    }, logger)
  }

  const summary = createSummary()

  for (const filePath of files) {
    try {
      const filterResult = await applyFilters(filePath, options)
      if (filterResult.skipped) {
        logger.info(`Skipping ${filePath}: ${filterResult.reason}`)
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
      const content = await extractContent(filePath, options, logger)
      const dateCandidates = options.appendDate ? getDateCandidates(content, { dateFormat: options.dateFormat }) : []
      const subjectHints = subjectManager ? subjectManager.getHints() : []
      const prompt = buildPrompt({ content, options, subjectHints, instructionSet, dateCandidates })
      const modelResponse = await provider.generateFilename(prompt)
      const { filename, subject, summary: fileSummary, subjectConfidence, appliedDate } = normaliseModelResult(modelResponse)

      const cleanedSubject = instructionSet?.sanitizeSubject ? instructionSet.sanitizeSubject(subject) : subject
      const effectiveSubject = cleanedSubject || null
      const effectiveConfidence = effectiveSubject ? subjectConfidence : 0

      const extension = getExtension(filePath).replace('.', '')
      const baseWithoutExt = filename.replace(/\.[^./]+$/, '')
      const formattedBase = applyCase(baseWithoutExt, options.case || 'kebabCase')
      const truncatedBase = options.chars ? truncateFilename(formattedBase, options.chars) : formattedBase
      const sanitizedName = sanitizeFilename(truncatedBase, extension)

      let destinationDirectory = path.dirname(filePath)
      let resolvedSubject = effectiveSubject

      if (subjectManager) {
        const subjectResolution = await subjectManager.resolveDestination({
          subject: effectiveSubject,
          confidence: effectiveConfidence
        })
        if (subjectResolution) {
          destinationDirectory = subjectResolution.directory
          resolvedSubject = subjectResolution.subject
        }
      }

      await fs.mkdir(destinationDirectory, { recursive: true })

      const finalName = ensureUniqueName(destinationDirectory, sanitizedName, fssync.existsSync)
      const destinationPath = path.join(destinationDirectory, finalName)

      const baseWithoutExtension = finalName.replace(/\.[^./]+$/, '')
      let appliedDateValue = appliedDate?.value ? appliedDate.value.trim() : ''
      let appliedDateSource = appliedDate?.source || null
      const appliedDateRationale = appliedDate?.rationale || null

      if (options.appendDate && !appliedDateValue) {
        const match = baseWithoutExtension.match(datePattern)
        if (match) {
          appliedDateValue = match[0]
          if (!appliedDateSource) {
            appliedDateSource = 'filename'
          }
        }
      }

      const appliedDateRecord = {
        value: appliedDateValue || null,
        source: appliedDateSource,
        rationale: appliedDateRationale
      }

      if (appliedDateRecord.value) {
        logger.info(`Selected date for ${path.basename(filePath)}: ${appliedDateRecord.value}${appliedDateRecord.source ? ` (source: ${appliedDateRecord.source})` : ''}`)
      } else if (options.appendDate) {
        logger.warn(`No date appended for ${path.basename(filePath)} despite append-date being enabled.`)
      }

      if (options.dryRun) {
        logger.info(`[dry-run] ${path.basename(filePath)} -> ${finalName}`)
        if (destinationDirectory !== path.dirname(filePath)) {
          logger.info(`[dry-run] would move to ${destinationDirectory}`)
        }
        summary.addRename({
          original: filePath,
          newName: destinationPath,
          subject: resolvedSubject,
          confidence: effectiveConfidence,
          notes: fileSummary
        })
        operationLog.write({
          timestamp: new Date().toISOString(),
          operation: 'dry-run',
          originalPath: filePath,
          proposedPath: destinationPath,
          subject: resolvedSubject,
          subjectConfidence: effectiveConfidence,
          summary: fileSummary,
          date: appliedDateRecord,
          dateCandidates,
          moved: destinationDirectory !== path.dirname(filePath)
        })
        continue
      }

      await fs.rename(filePath, destinationPath)
      logger.info(`Renamed to ${destinationPath}`)
      summary.addRename({
        original: filePath,
        newName: destinationPath,
        subject: resolvedSubject,
        confidence: effectiveConfidence,
        notes: fileSummary
      })
      if (destinationDirectory !== path.dirname(filePath)) {
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
        date: appliedDateRecord,
        dateCandidates,
        moved: destinationDirectory !== path.dirname(filePath)
      })
    } catch (error) {
      logger.error(`Error processing ${filePath}: ${error.message}`)
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
