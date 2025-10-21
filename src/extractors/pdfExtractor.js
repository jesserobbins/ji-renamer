const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { promisify } = require('util')
const { execFile } = require('child_process')
const pdfParse = require('pdf-parse')
const { parsePdfDate } = require('../utils/fileDates')

const execFileAsync = promisify(execFile)

const DEFAULT_OCR_LANGUAGES = ['eng']
let tesseractWarningIssued = false
let pdftoppmWarningIssued = false
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

  const buffer = await fs.readFile(filePath)
  const data = await pdfParse(buffer, parseOptions)

  let rawText = (data.text || '').trim()
  const metadata = buildDocumentMetadata(data)
  if (metadata && typeof metadata === 'object' && Number.isFinite(data.numrender)) {
    metadata.pagesProcessed = data.numrender
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

  const truncatedByPages = Boolean(appliedPageLimit) && data.numpages > data.numrender
  if (truncatedByPages && logger) {
    logger.debug(`Processed ${data.numrender} of ${data.numpages} page(s) from the PDF.`)
  }

  const extraction = {
    totalPages: data.numpages,
    processedPages: data.numrender,
    pageLimit: appliedPageLimit || null,
    autoLimited,
    truncatedByPageLimit: truncatedByPages,
    truncatedByCharacterLimit: truncatedByCharacters,
    characterLimit: budget > 0 ? budget : null
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
    if (data.numrender && data.numrender > 0) {
      visionLimits.push(data.numrender)
    }
    const positiveLimits = visionLimits.filter((value) => Number.isFinite(value) && value > 0)
    const resolvedVisionLimit = positiveLimits.length ? Math.min(...positiveLimits) : 0
    renderedImages = await renderPdfPageImages(filePath, {
      limit: resolvedVisionLimit,
      dpi: visionDpi
    }, logger)

    if (renderedImages.length) {
      extraction.vision = {
        providedImages: renderedImages.length,
        limit: resolvedVisionLimit || null,
        dpi: Number.isFinite(visionDpi) && visionDpi > 0 ? Math.floor(visionDpi) : DEFAULT_VISION_DPI,
        truncated: Boolean(resolvedVisionLimit) && data.numpages > resolvedVisionLimit
      }
    } else if (logger) {
      logger.warn(`Vision mode enabled but no page renders were generated for ${filePath}.`)
    }
  }

  if (metadata && typeof metadata === 'object') {
    if (truncatedByPages) {
      metadata.truncated = {
        ...(metadata.truncated || {}),
        reason: 'page-limit',
        processedPages: data.numrender,
        totalPages: data.numpages,
        autoLimited
      }
    }
    if (truncatedByCharacters) {
      metadata.characterLimit = budget
    }
    if (renderedImages.length) {
      metadata.vision = {
        ...(metadata.vision || {}),
        providedImages: renderedImages.length,
        dpi: Number.isFinite(visionDpi) && visionDpi > 0 ? Math.floor(visionDpi) : DEFAULT_VISION_DPI
      }
    }
  }

  return {
    text,
    metadata,
    ocr,
    extraction,
    images: renderedImages
  }
}

module.exports = {
  extractPdf
}
