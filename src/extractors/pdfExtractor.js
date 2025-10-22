const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { promisify } = require('util')
const { execFile } = require('child_process')
const pdfParse = require('pdf-parse')
const { parsePdfDate, normaliseDateInput } = require('../utils/fileDates')

const execFileAsync = promisify(execFile)

const DEFAULT_OCR_LANGUAGES = ['eng']
let tesseractWarningIssued = false
let pdftoppmWarningIssued = false
let pdftotextWarningIssued = false
let pdfinfoWarningIssued = false
const DEFAULT_VISION_DPI = 144

async function cleanupTempDir (dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
  } catch (error) {
    // ignore cleanup failures
  }
}

async function runTesseractOnImage (imagePath, languageArg) {
  const { stdout } = await execFileAsync('tesseract', [imagePath, 'stdout', '-l', languageArg], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  return stdout.trim()
}

async function runPdftotext (filePath, { limit } = {}, logger) {
  try {
    const args = ['-q', '-nopgbrk']
    if (Number.isFinite(limit) && limit > 0) {
      const boundedLimit = Math.max(1, Math.floor(limit))
      args.push('-f', '1', '-l', String(boundedLimit))
    }
    args.push(filePath, '-')

    const { stdout } = await execFileAsync('pdftotext', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })

    return stdout.trim()
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (!pdftotextWarningIssued && logger) {
        logger.warn('pdftotext CLI not found. Install Poppler utilities to accelerate large-PDF extraction.')
        pdftotextWarningIssued = true
      }
    } else if (logger) {
      logger.warn(`pdftotext extraction failed for ${filePath}: ${error.message}`)
    }
  }

  return null
}

async function runPdfinfo (filePath, logger) {
  try {
    const { stdout } = await execFileAsync('pdfinfo', ['-isodates', filePath], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024
    })

    return stdout
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (!pdfinfoWarningIssued && logger) {
        logger.warn('pdfinfo CLI not found. Install Poppler utilities to include PDF metadata for large files.')
        pdfinfoWarningIssued = true
      }
    } else if (logger) {
      logger.warn(`pdfinfo metadata extraction failed for ${filePath}: ${error.message}`)
    }
  }

  return null
}

function parsePdfinfoOutput (output) {
  if (!output || typeof output !== 'string') {
    return null
  }

  const lines = output.split(/\r?\n/)
  const info = {}

  for (const line of lines) {
    if (!line.includes(':')) continue
    const [rawKey, ...rest] = line.split(':')
    if (!rawKey) continue
    const key = rawKey.trim()
    const value = rest.join(':').trim()
    if (!key) continue
    info[key] = value
  }

  return Object.keys(info).length ? info : null
}

function buildMetadataFromPdfinfo (info) {
  if (!info || typeof info !== 'object') {
    return { metadata: null, totalPages: null }
  }

  const metadata = {}

  if (info.Author) metadata.author = info.Author
  if (info.Title) metadata.title = info.Title
  if (info.Subject) metadata.subject = info.Subject
  if (info.Keywords) metadata.keywords = info.Keywords
  if (info.Creator) metadata.creator = info.Creator
  if (info.Producer) metadata.producer = info.Producer

  const creation = parsePdfDate(info.CreationDate) || normaliseDateInput(info.CreationDate)
  if (creation) metadata.creationDate = creation.toISOString()
  const modification = parsePdfDate(info.ModDate) || normaliseDateInput(info.ModDate)
  if (modification) metadata.modificationDate = modification.toISOString()

  const pagesValue = Number.parseInt(info.Pages, 10)
  const totalPages = Number.isFinite(pagesValue) ? pagesValue : null

  if (!Object.keys(metadata).length) {
    return { metadata: null, totalPages }
  }

  return { metadata, totalPages }
}

async function renderPdfPageImages (filePath, { limit, dpi }, logger) {
  let tempDir
  const resolvedDpi = Number.isFinite(dpi) && dpi > 0 ? Math.floor(dpi) : DEFAULT_VISION_DPI

  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ji-renamer-vision-'))
    const outputPrefix = path.join(tempDir, 'page')

    const args = ['-jpeg', '-r', String(resolvedDpi)]
    if (Number.isFinite(limit) && limit > 0) {
      const boundedLimit = Math.max(1, Math.floor(limit))
      args.push('-f', '1', '-l', String(boundedLimit))
    }
    args.push(filePath, outputPrefix)

    await execFileAsync('pdftoppm', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })

    const generatedFiles = await fs.readdir(tempDir)
    const pageImages = generatedFiles
      .filter((name) => name.startsWith('page') && (name.endsWith('.jpg') || name.endsWith('.jpeg')))
      .sort((a, b) => {
        const matchA = a.match(/page-?(\d+)/i)
        const matchB = b.match(/page-?(\d+)/i)
        const numA = matchA ? Number.parseInt(matchA[1], 10) : Number.POSITIVE_INFINITY
        const numB = matchB ? Number.parseInt(matchB[1], 10) : Number.POSITIVE_INFINITY
        if (Number.isFinite(numA) && Number.isFinite(numB)) {
          return numA - numB
        }
        return a.localeCompare(b)
      })

    const images = []
    for (const imageName of pageImages) {
      const imagePath = path.join(tempDir, imageName)
      const buffer = await fs.readFile(imagePath)
      const match = imageName.match(/page-?(\d+)/i)
      const pageNumber = match ? Number.parseInt(match[1], 10) : null
      images.push({
        base64: buffer.toString('base64'),
        mediaType: 'image/jpeg',
        pageNumber,
        source: 'pdf-page',
        via: 'pdftoppm',
        dpi: resolvedDpi
      })
    }

    return images
  } catch (error) {
    if (error.code === 'ENOENT' && error.path && error.path.includes('pdftoppm')) {
      if (!pdftoppmWarningIssued && logger) {
        logger.warn('pdftoppm CLI not found. Install Poppler utilities to enable PDF rasterisation for vision mode.')
        pdftoppmWarningIssued = true
      }
    } else if (logger) {
      logger.warn(`pdftoppm vision rendering failed for ${filePath}: ${error.message}`)
    }
  } finally {
    if (tempDir) {
      await cleanupTempDir(tempDir)
    }
  }

  return []
}

async function runTesseractOcr (filePath, languages, logger) {
  const languageArg = Array.isArray(languages) && languages.length ? languages.join('+') : DEFAULT_OCR_LANGUAGES.join('+')

  try {
    const extension = path.extname(filePath).toLowerCase()

    if (extension !== '.pdf') {
      const cleaned = await runTesseractOnImage(filePath, languageArg)
      if (cleaned) {
        return {
          text: cleaned,
          metadata: {
            engine: 'tesseract',
            languages: languageArg
          }
        }
      }
      return null
    }

    let tempDir
    try {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ji-renamer-ocr-'))
      const outputPrefix = path.join(tempDir, 'page')
      await execFileAsync('pdftoppm', ['-png', '-r', '300', filePath, outputPrefix], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
      })

      const generatedFiles = await fs.readdir(tempDir)
      const pageImages = generatedFiles
        .filter((name) => name.startsWith('page') && name.endsWith('.png'))
        .sort()

      if (!pageImages.length) {
        return null
      }

      const pageTexts = []
      for (const imageName of pageImages) {
        const imagePath = path.join(tempDir, imageName)
        try {
          const cleaned = await runTesseractOnImage(imagePath, languageArg)
          if (cleaned) {
            pageTexts.push(cleaned)
          }
        } catch (error) {
          if (logger) {
            logger.warn(`tesseract OCR failed for ${imagePath}: ${error.message}`)
          }
        }
      }

      if (pageTexts.length) {
        return {
          text: pageTexts.join('\n\n'),
          metadata: {
            engine: 'tesseract',
            languages: languageArg,
            pages: pageTexts.length,
            via: 'pdftoppm'
          }
        }
      }
    } finally {
      if (tempDir) {
        await cleanupTempDir(tempDir)
      }
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (error.path && error.path.includes('pdftoppm')) {
        if (!pdftoppmWarningIssued && logger) {
          logger.warn('pdftoppm CLI not found. Install Poppler utilities to enable PDF OCR conversion.')
          pdftoppmWarningIssued = true
        }
      } else if (!tesseractWarningIssued && logger) {
        logger.warn('tesseract CLI not found. Install Tesseract OCR to enable image-based PDF extraction.')
        tesseractWarningIssued = true
      }
    } else if (logger) {
      const isPdftoppmError = (error.path && error.path.includes('pdftoppm')) || (error.cmd && error.cmd.includes('pdftoppm'))
      const source = isPdftoppmError ? 'pdftoppm' : 'tesseract'
      logger.warn(`${source} OCR failed for ${filePath}: ${error.message}`)
    }
  }

  return null
}

function buildDocumentMetadata (data) {
  const info = data.info || {}
  const meta = {}

  if (info.Author) meta.author = info.Author
  if (info.Title) meta.title = info.Title
  if (info.Subject) meta.subject = info.Subject
  if (info.Keywords) meta.keywords = info.Keywords
  if (info.Creator) meta.creator = info.Creator
  if (info.Producer) meta.producer = info.Producer
  if (typeof data.numpages === 'number') meta.pages = data.numpages

  const creation = parsePdfDate(info.CreationDate)
  if (creation) meta.creationDate = creation.toISOString()
  const modification = parsePdfDate(info.ModDate)
  if (modification) meta.modificationDate = modification.toISOString()

  return meta
}

async function extractPdf (filePath, {
  logger,
  ocrLanguages,
  pageLimit,
  largeFileThresholdBytes,
  largeFilePageLimit,
  textCharBudget,
  stats,
  visionMode,
  visionPageLimit,
  visionDpi
} = {}) {
  let fileStats = stats
  if (!fileStats) {
    try {
      fileStats = await fs.stat(filePath)
    } catch (error) {
      fileStats = null
    }
  }

  const sizeBytes = fileStats?.size
  const explicitLimit = Number.isFinite(pageLimit) && pageLimit > 0 ? Math.floor(pageLimit) : 0
  const thresholdBytes = Number.isFinite(largeFileThresholdBytes) && largeFileThresholdBytes > 0
    ? Math.floor(largeFileThresholdBytes)
    : 0
  const autoLimit = Number.isFinite(largeFilePageLimit) && largeFilePageLimit > 0
    ? Math.floor(largeFilePageLimit)
    : 0

  let appliedPageLimit = explicitLimit
  let autoLimited = false
  if (!appliedPageLimit && thresholdBytes && autoLimit && Number.isFinite(sizeBytes) && sizeBytes >= thresholdBytes) {
    appliedPageLimit = autoLimit
    autoLimited = true
    if (logger) {
      const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1)
      logger.info(`Large PDF detected (${sizeMb} MB). Limiting text extraction to first ${appliedPageLimit} page(s). Override with --pdf-page-limit to change this behavior.`)
    }
  } else if (appliedPageLimit && logger) {
    logger.debug(`Limiting PDF extraction to first ${appliedPageLimit} page(s) per --pdf-page-limit option.`)
  }

  const parseOptions = {}
  if (appliedPageLimit) {
    parseOptions.max = appliedPageLimit
  }

  const DEFAULT_POPPLER_THRESHOLD_BYTES = 20 * 1024 * 1024
  const popplerThresholdBytes = thresholdBytes || DEFAULT_POPPLER_THRESHOLD_BYTES
  const shouldAttemptPoppler = appliedPageLimit > 0 || (Number.isFinite(sizeBytes) && sizeBytes >= popplerThresholdBytes)

  let rawText = ''
  let metadata = null
  let totalPages = null
  let processedPages = null
  let usedPoppler = false

  if (shouldAttemptPoppler) {
    const popplerText = await runPdftotext(filePath, { limit: appliedPageLimit }, logger)
    if (popplerText) {
      rawText = popplerText.trim()
      processedPages = appliedPageLimit > 0 ? appliedPageLimit : null

      const pdfinfoOutput = await runPdfinfo(filePath, logger)
      if (pdfinfoOutput) {
        const parsedInfo = parsePdfinfoOutput(pdfinfoOutput)
        const { metadata: infoMetadata, totalPages: infoTotalPages } = buildMetadataFromPdfinfo(parsedInfo)
        if (infoMetadata) {
          metadata = infoMetadata
        }
        if (Number.isFinite(infoTotalPages)) {
          totalPages = infoTotalPages
          if (!Number.isFinite(processedPages)) {
            processedPages = appliedPageLimit > 0
              ? Math.min(appliedPageLimit, infoTotalPages)
              : infoTotalPages
          }
        }
      }

      if (Number.isFinite(totalPages) && Number.isFinite(processedPages)) {
        processedPages = Math.min(processedPages, totalPages)
      }

      if (metadata && typeof metadata === 'object') {
        if (Number.isFinite(totalPages) && typeof metadata.pages !== 'number') {
          metadata.pages = totalPages
        }
        if (Number.isFinite(processedPages)) {
          metadata.pagesProcessed = processedPages
        }
      }

      usedPoppler = true
      if (logger) {
        if (appliedPageLimit > 0) {
          const limitDescription = Number.isFinite(processedPages) ? processedPages : appliedPageLimit
          logger.debug(`Extracted PDF text with pdftotext for first ${limitDescription} page(s).`)
        } else {
          logger.debug('Extracted PDF text with pdftotext.')
        }
      }
    } else if (logger) {
      logger.debug('pdftotext did not yield text; falling back to pdf.js extraction.')
    }
  }

  let data = null
  if (!rawText) {
    const buffer = await fs.readFile(filePath)
    data = await pdfParse(buffer, parseOptions)
    rawText = (data.text || '').trim()
    metadata = buildDocumentMetadata(data)
    if (metadata && typeof metadata === 'object' && Number.isFinite(data.numrender)) {
      metadata.pagesProcessed = data.numrender
    }
    if (metadata && typeof metadata === 'object' && Number.isFinite(data.numpages) && typeof metadata.pages !== 'number') {
      metadata.pages = data.numpages
    }
    if (Number.isFinite(data.numpages)) {
      totalPages = data.numpages
    }
    if (Number.isFinite(data.numrender)) {
      processedPages = data.numrender
    }
  } else if (!Number.isFinite(processedPages) && appliedPageLimit > 0) {
    processedPages = appliedPageLimit
  }

  if (!metadata || typeof metadata !== 'object') {
    metadata = {}
  }

  let ocr = null

  if (!rawText) {
    const ocrResult = await runTesseractOcr(filePath, ocrLanguages, logger)
    if (ocrResult) {
      rawText = ocrResult.text
      ocr = ocrResult.metadata
    }
  }

  let budget
  if (Number.isFinite(textCharBudget)) {
    budget = Math.max(0, Math.floor(textCharBudget))
  } else {
    budget = 20000
  }

  const truncatedByCharacters = budget > 0 && rawText.length > budget
  const text = budget > 0 ? rawText.slice(0, budget) : rawText
  if (truncatedByCharacters && logger) {
    logger.debug(`Truncated PDF text to ${budget} characters to respect the prompt budget.`)
  }

  const truncatedByPages = Boolean(appliedPageLimit) && Number.isFinite(totalPages) && Number.isFinite(processedPages) && totalPages > processedPages
  if (truncatedByPages && logger) {
    logger.debug(`Processed ${processedPages} of ${totalPages} page(s) from the PDF.`)
  }

  const extraction = {
    totalPages: Number.isFinite(totalPages) ? totalPages : null,
    processedPages: Number.isFinite(processedPages) ? processedPages : null,
    pageLimit: appliedPageLimit || null,
    autoLimited,
    truncatedByPageLimit: truncatedByPages,
    truncatedByCharacterLimit: truncatedByCharacters,
    characterLimit: budget > 0 ? budget : null,
    extractor: usedPoppler ? 'pdftotext' : 'pdfjs'
  }

  let renderedImages = []
  if (visionMode) {
    const visionLimits = []
    if (Number.isFinite(visionPageLimit) && visionPageLimit > 0) {
      visionLimits.push(Math.floor(visionPageLimit))
    }
    if (appliedPageLimit) {
      visionLimits.push(appliedPageLimit)
    }
    if (Number.isFinite(processedPages) && processedPages > 0) {
      visionLimits.push(processedPages)
    }
    const positiveLimits = visionLimits.filter((value) => Number.isFinite(value) && value > 0)
    const resolvedVisionLimit = positiveLimits.length ? Math.min(...positiveLimits) : 0
    renderedImages = await renderPdfPageImages(filePath, {
      limit: resolvedVisionLimit,
      dpi: visionDpi
    }, logger)

    const resolvedDpi = Number.isFinite(visionDpi) && visionDpi > 0 ? Math.floor(visionDpi) : DEFAULT_VISION_DPI

    if (renderedImages.length) {
      extraction.vision = {
        providedImages: renderedImages.length,
        limit: resolvedVisionLimit || null,
        dpi: resolvedDpi,
        truncated: Boolean(resolvedVisionLimit) && Number.isFinite(totalPages) && totalPages > resolvedVisionLimit
      }
    } else if (logger) {
      logger.warn(`Vision mode enabled but no page renders were generated for ${filePath}.`)
    }

    if (renderedImages.length) {
      metadata.vision = {
        ...(metadata.vision || {}),
        providedImages: renderedImages.length,
        dpi: resolvedDpi
      }
    }
  }

  if (truncatedByPages) {
    metadata.truncated = {
      ...(metadata.truncated || {}),
      reason: 'page-limit',
      processedPages: Number.isFinite(processedPages) ? processedPages : null,
      totalPages: Number.isFinite(totalPages) ? totalPages : null,
      autoLimited
    }
  }
  if (truncatedByCharacters) {
    metadata.characterLimit = budget
  }

  const metadataPayload = Object.keys(metadata).length ? metadata : null

  return {
    text,
    metadata: metadataPayload,
    ocr,
    extraction,
    images: renderedImages
  }
}

module.exports = {
  extractPdf
}
