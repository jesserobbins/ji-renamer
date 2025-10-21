const path = require('path')
const fs = require('fs/promises')
const { getFileCategory, getExtension } = require('../utils/fileType')
const { extractText } = require('./textExtractor')
const { extractPdf } = require('./pdfExtractor')
const { extractImage } = require('./imageExtractor')
const { extractFrames } = require('./videoExtractor')
const { collectSystemMetadata } = require('../utils/systemMetadata')

async function extractContent (filePath, options, logger) {
  const category = getFileCategory(filePath)
  const baseName = path.basename(filePath)
  const stats = await fs.stat(filePath)

  const createdAt = stats.birthtime instanceof Date && !Number.isNaN(stats.birthtime.getTime())
    ? stats.birthtime.toISOString()
    : null

  const baseContext = {
    fileName: baseName,
    extension: getExtension(filePath),
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    createdAt
  }

  const systemMetadata = await collectSystemMetadata(filePath, logger)
  const metadata = {}
  if (systemMetadata) {
    metadata.mac = systemMetadata
  }

  if (category === 'text') {
    const text = await extractText(filePath)
    const payload = { ...baseContext, text }
    if (Object.keys(metadata).length) {
      payload.metadata = metadata
    }
    return payload
  }

  if (category === 'pdf') {
    const pdfOptions = {
      logger,
      ocrLanguages: options.ocrLanguages,
      pageLimit: options.pdfPageLimit,
      largeFileThresholdBytes: Math.max(0, Number(options.pdfLargeFileThreshold || 0)) * 1024 * 1024,
      largeFilePageLimit: options.pdfLargeFilePageLimit,
      textCharBudget: options.promptCharBudget,
      stats,
      visionMode: Boolean(options.visionMode),
      visionPageLimit: options.pdfVisionPageLimit,
      visionDpi: options.pdfVisionDpi
    }
    const { text, metadata: pdfMetadata, ocr, extraction, images } = await extractPdf(filePath, pdfOptions)
    if (pdfMetadata && Object.keys(pdfMetadata).length) {
      metadata.document = pdfMetadata
    }
    const payload = { ...baseContext, text }
    if (Object.keys(metadata).length) {
      payload.metadata = metadata
    }
    if (ocr) {
      payload.ocr = ocr
    }
    if (extraction) {
      payload.pdfExtraction = extraction
    }
    if (Array.isArray(images) && images.length) {
      payload.images = images
    }
    return payload
  }

  if (category === 'image') {
    const image = await extractImage(filePath)
    const payload = { ...baseContext, image, images: [image] }
    if (Object.keys(metadata).length) {
      payload.metadata = metadata
    }
    return payload
  }

  if (category === 'video') {
    const { frames, duration, frameCount, error } = await extractFrames({ filePath, frameCount: options.frames || 3 })
    const payload = { ...baseContext, frames, duration, frameCount, frameError: error }
    if (Object.keys(metadata).length) {
      payload.metadata = metadata
    }
    return payload
  }

  const buffer = await fs.readFile(filePath)
  const payload = { ...baseContext, binarySnippet: buffer.slice(0, 4096).toString('base64') }
  if (Object.keys(metadata).length) {
    payload.metadata = metadata
  }
  return payload
}

module.exports = {
  extractContent
}
