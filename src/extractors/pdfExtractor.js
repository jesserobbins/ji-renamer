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

async function extractPdf (filePath, { logger, ocrLanguages } = {}) {
  const buffer = await fs.readFile(filePath)
  const data = await pdfParse(buffer)
  let text = (data.text || '').trim()
  const metadata = buildDocumentMetadata(data)
  let ocr = null

  if (!text) {
    const ocrResult = await runTesseractOcr(filePath, ocrLanguages, logger)
    if (ocrResult) {
      text = ocrResult.text
      ocr = ocrResult.metadata
    }
  }

  return {
    text: text.slice(0, 20000),
    metadata,
    ocr
  }
}

module.exports = {
  extractPdf
}
