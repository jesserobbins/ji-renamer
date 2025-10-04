const fs = require('fs/promises')
const pdfParse = require('pdf-parse')
const { parsePdfDate } = require('../utils/fileDates')

async function extractPdf (filePath) {
  const buffer = await fs.readFile(filePath)
  const data = await pdfParse(buffer)
  const meta = {
    author: data.info?.Author || '',
    title: data.info?.Title || '',
    pages: data.numpages,
    creationDate: parsePdfDate(data.info?.CreationDate)?.toISOString() || '',
    modificationDate: parsePdfDate(data.info?.ModDate)?.toISOString() || ''
  }
  return {
    text: (data.text || '').slice(0, 8000),
    metadata: meta
  }
}

module.exports = {
  extractPdf
}
