const fs = require('fs/promises')
const { promisify } = require('util')
const { execFile } = require('child_process')
const pdfParse = require('pdf-parse')
const { parsePdfDate } = require('../utils/fileDates')

const execFileAsync = promisify(execFile)

const DEFAULT_OCR_LANGUAGES = ['eng']
let tesseractWarningIssued = false

async function runTesseractOcr (filePath, languages, logger) {
  const languageArg = Array.isArray(languages) && languages.length ? languages.join('+') : DEFAULT_OCR_LANGUAGES.join('+')

  try {
    const { stdout } = await execFileAsync('tesseract', [filePath, 'stdout', '-l', languageArg], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
    const cleaned = stdout.trim()
    if (cleaned) {
      return {
        text: cleaned,
        metadata: {
          engine: 'tesseract',
          languages: languageArg
        }
      }
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (!tesseractWarningIssued && logger) {
        logger.warn('tesseract CLI not found. Install Tesseract OCR to enable image-based PDF extraction.')
        tesseractWarningIssued = true
      }
    } else if (logger) {
      logger.warn(`tesseract OCR failed for ${filePath}: ${error.message}`)
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
