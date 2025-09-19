const path = require('path')
const { v4: uuidv4 } = require('uuid')

const isImage = require('./isImage')
const isVideo = require('./isVideo')
const saveFile = require('./saveFile')
const getNewName = require('./getNewName')
const extractFrames = require('./extractFrames')
const readFileContent = require('./readFileContent')
const deleteDirectory = require('./deleteDirectory')
const isProcessableFile = require('./isProcessableFile')

const logVerbose = (verbose, message) => {
  if (!verbose) return
  console.log(message)
}

module.exports = async options => {
  try {
    const { frames, filePath, inputPath, convertBinary, verbose } = options

    const fileName = path.basename(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const relativeFilePath = path.relative(inputPath, filePath)

    logVerbose(verbose, `🔍 Processing file: ${relativeFilePath}`)

    if (fileName === '.DS_Store') return

    if (!isProcessableFile({ filePath })) {
      console.log(`🟡 Unsupported file: ${relativeFilePath}`)
      return
    }

    let content
    let videoPrompt
    let images = []
    let framesOutputDir
    if (isImage({ ext })) {
      logVerbose(verbose, `🖼️ Detected image: ${relativeFilePath}`)
      images.push(filePath)
    } else if (isVideo({ ext })) {
      logVerbose(verbose, `🎞️ Detected video: ${relativeFilePath} — extracting frames`)
      framesOutputDir = `/tmp/ai-renamer/${uuidv4()}`
      const _extractedFrames = await extractFrames({
        frames,
        framesOutputDir,
        inputFile: filePath
      })
      images = _extractedFrames.images
      videoPrompt = _extractedFrames.videoPrompt
      logVerbose(verbose, `🎯 Extracted ${images.length} frame(s) from ${relativeFilePath}`)
    } else {
      logVerbose(verbose, `📄 Extracting text content from: ${relativeFilePath}`)
      content = await readFileContent({ filePath, convertBinary, verbose })
      if (!content) {
        console.log(`🔴 No text content: ${relativeFilePath}`)
        return
      }
      logVerbose(verbose, `✅ Extracted ${content.length} characters from ${relativeFilePath}`)
    }

    const newName = await getNewName({ ...options, images, content, videoPrompt, relativeFilePath })
    if (!newName) return

    const newFileName = await saveFile({ ext, newName, filePath })
    const relativeNewFilePath = path.join(path.dirname(relativeFilePath), newFileName)
    console.log(`🟢 Renamed: ${relativeFilePath} to ${relativeNewFilePath}`)

    if (isVideo({ ext }) && framesOutputDir) {
      logVerbose(verbose, `🧹 Cleaning up extracted frames for ${relativeFilePath}`)
      await deleteDirectory({ folderPath: framesOutputDir })
    }
  } catch (err) {
    console.log(err.message)
  }
}
