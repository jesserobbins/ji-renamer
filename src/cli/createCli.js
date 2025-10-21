const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const process = require('process')

const defaultOptions = {
  provider: 'ollama',
  model: '',
  apiKey: '',
  baseUrl: '',
  frames: 3,
  case: 'kebabCase',
  chars: 80,
  language: 'English',
  includeSubdirectories: false,
  customPrompt: '',
  instructionsFile: '',
  subjectStopwords: '',
  dryRun: false,
  summary: false,
  jsonMode: true,
  maxFileSize: 0,
  onlyExtensions: '',
  ignoreExtensions: '',
  organizeBySubject: false,
  subjectDestination: '',
  moveUnknownSubjects: false,
  appendDate: false,
  dateFormat: 'YYYY-MM-DD',
  logFile: '',
  promptCharBudget: 12000,
  subjectFormat: '',
  subjectBriefFormat: '',
  documentDescriptionFormat: '',
  segmentSeparator: '-'
}

const CLI_OPTIONS = {
  provider: {
    alias: 'p',
    describe: 'Set the model provider (ollama, lm-studio, openai)',
    type: 'string'
  },
  apiKey: {
    alias: 'a',
    describe: 'API key for OpenAI-compatible providers',
    type: 'string'
  },
  baseUrl: {
    alias: 'u',
    describe: 'Base URL for the provider endpoint (include /v1 for OpenAI-compatible APIs)',
    type: 'string'
  },
  model: {
    alias: 'm',
    describe: 'Model identifier to use',
    type: 'string'
  },
  frames: {
    alias: 'f',
    describe: 'Maximum number of frames to extract from videos',
    type: 'number'
  },
  case: {
    alias: 'c',
    describe: 'Case style for generated filenames',
    type: 'string'
  },
  chars: {
    alias: 'x',
    describe: 'Maximum characters allowed in the filename',
    type: 'number'
  },
  language: {
    alias: 'l',
    describe: 'Language to prefer for output filenames',
    type: 'string'
  },
  includeSubdirectories: {
    alias: 's',
    describe: 'Include subdirectories when scanning',
    type: 'boolean'
  },
  customPrompt: {
    alias: 'r',
    describe: 'Custom instructions appended to the model prompt',
    type: 'string'
  },
  instructionsFile: {
    describe: 'Path to a file containing additional system instructions',
    type: 'string'
  },
  subjectStopwords: {
    describe: 'Comma-separated tokens to strip from detected subject names',
    type: 'string'
  },
  dryRun: {
    describe: 'Preview renames without writing to disk',
    type: 'boolean'
  },
  summary: {
    describe: 'Print a summary report after processing',
    type: 'boolean'
  },
  maxFileSize: {
    describe: 'Skip files larger than the provided size in MB',
    type: 'number'
  },
  onlyExtensions: {
    describe: 'Process only files with these comma-separated extensions',
    type: 'string'
  },
  ignoreExtensions: {
    describe: 'Skip files with these comma-separated extensions',
    type: 'string'
  },
  organizeBySubject: {
    describe: 'Move files into subject folders inferred by the model',
    type: 'boolean'
  },
  subjectDestination: {
    describe: 'Destination directory for organized subjects',
    type: 'string'
  },
  moveUnknownSubjects: {
    describe: 'Move low-confidence subjects into an Unknown folder',
    type: 'boolean'
  },
  appendDate: {
    cliName: 'append-date',
    defaultKey: 'appendDate',
    describe: 'Append the most relevant date (metadata or creation) using the configured date format (default YYYY-MM-DD)',
    type: 'boolean'
  },
  dateFormat: {
    cliName: 'date-format',
    defaultKey: 'dateFormat',
    describe: 'Date format to request when appending dates (e.g. YYYY-MM-DD, YYYYMMDD, YYYY-MM-DD_HHmm)',
    type: 'string'
  },
  logFile: {
    cliName: 'log-file',
    defaultKey: 'logFile',
    describe: 'Optional path for the operation log file (defaults to the top-level directory)',
    type: 'string'
  },
  promptCharBudget: {
    cliName: 'prompt-char-budget',
    defaultKey: 'promptCharBudget',
    describe: 'Maximum number of characters to include in the prompt payload (set to 0 to disable trimming)',
    type: 'number'
  },
  subjectFormat: {
    cliName: 'subject-format',
    defaultKey: 'subjectFormat',
    describe: 'Template for embedding the subject in the filename (use $' + '{value} as the placeholder)',
    type: 'string'
  },
  subjectBriefFormat: {
    cliName: 'subject-brief-format',
    defaultKey: 'subjectBriefFormat',
    describe: 'Template for a concise subject descriptor segment (use $' + '{value}; leave empty to disable)',
    type: 'string'
  },
  documentDescriptionFormat: {
    cliName: 'document-description-format',
    defaultKey: 'documentDescriptionFormat',
    describe: 'Template for inserting a document description segment (use $' + '{value}; leave empty to disable)',
    type: 'string'
  },
  segmentSeparator: {
    cliName: 'segment-separator',
    defaultKey: 'segmentSeparator',
    describe: 'Separator used between formatted filename segments (subject, descriptors, title, date)',
    type: 'string'
  },
  jsonMode: {
    cliName: 'json-mode',
    defaultKey: 'jsonMode',
    describe: 'Force providers to use JSON-mode responses (disable with --no-json-mode)',
    type: 'boolean'
  }
}

function createCli (config = {}) {
  const parser = yargs(hideBin(process.argv))
    .usage('Usage: $0 <path> [options]')
    .positional('path', {
      describe: 'File or directory to process',
      type: 'string'
    })
    .example('$0 ~/Downloads/Pitches --dry-run --summary', 'Preview renames and print a summary report')

  const detectedWidth = typeof parser.terminalWidth === 'function' ? parser.terminalWidth() : undefined
  const stdoutWidth = process.stdout && Number.isFinite(process.stdout.columns) ? process.stdout.columns : undefined
  const stderrWidth = process.stderr && Number.isFinite(process.stderr.columns) ? process.stderr.columns : undefined
  const envWidth = Number.isFinite(Number(process.env.COLUMNS)) ? Number(process.env.COLUMNS) : undefined

  const candidateWidths = [detectedWidth, stdoutWidth, stderrWidth, envWidth]
    .filter((value) => Number.isFinite(value) && value > 0)

  if (candidateWidths.length === 0) {
    // When yargs cannot determine the terminal width we disable wrapping completely.
    // This ensures long descriptions (and their default values) never get truncated.
    parser.wrap(null)
  } else {
    const wrapWidth = Math.max(...candidateWidths)
    parser.wrap(Math.min(120, Math.max(60, wrapWidth)))
  }

  const defaults = { ...defaultOptions, ...config }

  Object.entries(CLI_OPTIONS).forEach(([name, option]) => {
    const { cliName = name, defaultKey = name, ...optionConfig } = option
    parser.option(cliName, {
      ...optionConfig,
      default: defaults[defaultKey]
    })
  })

  return parser
}

module.exports = {
  createCli,
  defaultOptions
}
