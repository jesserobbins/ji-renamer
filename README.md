# ji-renamer

A Node.js CLI that uses local or hosted multimodal LLMs to inspect a file's contents and generate a descriptive, case-formatted filename. The tool was built for power users who download large research batches—investors, analysts, creative teams—and need a trustworthy assistant to triage, rename, and optionally reorganize assets.

## Table of Contents
- [Overview](#overview)
- [Key Features](#key-features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Model Providers](#model-providers)
- [Command Options](#command-options)
- [Subject Organization Workflow](#subject-organization-workflow)
- [Contribution](#contribution)
- [Credits](#credits)
- [License](#license)
- [Product Requirements Document](#product-requirements-document)

## Overview
`ji-renamer` is a cross-platform CLI for renaming files according to the information inside them. Point the command at a folder or a single file and the tool will extract context (text, OCR frames, metadata) before asking an LLM to craft a concise filename. Multiple providers are supported, including Ollama, LM Studio, and OpenAI.

> **Attribution**: This codebase began as a fork of [ozgrozer/ai-renamer](https://github.com/ozgrozer/ai-renamer) by Özgür Özer, but it has since been rewritten from the ground up and is actively maintained here. Please direct questions, issues, and contributions to this repository rather than the original project.

The CLI stores your preferred switches (provider, model, case style, subject-organization behavior, etc.) in a local config file so recurring workflows stay one command away.

## Key Features
- **LLM-powered renaming** – Summarize documents, presentations, PDFs, videos, and images to craft human-readable filenames.
- **Provider flexibility** – Works with local Ollama models, LM Studio, or OpenAI models by toggling flags.
- **Case formatting** – Choose the case convention that best fits your filesystem (`camelCase`, `kebabCase`, `snakeCase`, etc.).
- **Batch processing** – Walk directory trees, optionally including subdirectories, and rename as you go.
- **macOS metadata aware** – On macOS the CLI harvests Spotlight metadata (authors, where from, tags, comments, etc.) to give the model richer hints.
- **Safety controls** – Use `--dry-run` to preview results, enforce size or extension allowlists/denylists, and print a summary report of every decision.
- **Traceable logging** – Every run emits a JSONL audit log (to the target directory by default) so you can review or roll back renames later.
- **Subject organization** – Group files into startup- or project-specific folders, feed existing folder names back into prompts to keep naming consistent, and optionally quarantine uncertain matches in an `Unknown` folder.

## Installation
### Prerequisites
- [Node.js](https://nodejs.org/) 18 or newer.
- [`ffmpeg`](https://ffmpeg.org/) and `ffprobe` available on your `PATH` for video frame extraction.
- [`tesseract`](https://tesseract-ocr.github.io/tessdoc/Installation.html) CLI available on your `PATH` to OCR image-only PDFs (Homebrew `brew install tesseract` on macOS).
- [`pdftoppm`](https://poppler.freedesktop.org/) (part of the Poppler utilities) on your `PATH` so PDFs that only contain images can be rasterised before OCR (`brew install poppler` on macOS).

```bash
# Install globally
npm install -g ji-renamer

# Or run without installing the local workspace build
npx --no-install ji-renamer-local /path/to-files

# Or run the published package directly
npx ji-renamer /path/to/files
```

> **Why two commands?** The npm registry already hosts the published `ji-renamer` package. When you run `npx ji-renamer`, npm
> will always prefer that published build—even inside this workspace. To exercise the local source without publishing a new
> version, this repository ships a `ji-renamer-local` binary alias. Use `npx --no-install ji-renamer-local` (or `node src/index.js`)
> to execute the code in your working tree.

## Quick Start
```bash
# Rename the files inside a directory using your saved defaults
ji-renamer ~/Downloads/Pitches

# Preview the run, print a summary, and direct new subject folders to a workspace
ji-renamer ~/Downloads/Pitches \
  --dry-run \
  --summary \
  --organize-by-subject \
  --subject-destination=~/DealRoom \
  --move-unknown-subjects
```

## Model Providers
### Ollama
Ollama is the default provider. The CLI will auto-select an available Llava model, but you can specify any local model.

```bash
npx ji-renamer /path --provider=ollama --model=llava:13b
```

### LM Studio
Point the CLI at LM Studio to reuse the model currently loaded in the desktop app.

```bash
npx ji-renamer /path --provider=lm-studio
```

### OpenAI
Set the provider to `openai` and supply an API key. The CLI defaults to `gpt-4o`, but you can request any other model.

```bash
npx ji-renamer /path --provider=openai --api-key=OPENAI_API_KEY
```

### Custom Ports
Explicitly set base URLs if your providers are exposed on non-default ports.

```bash
npx ji-renamer /path --provider=ollama --base-url=http://127.0.0.1:11434
npx ji-renamer /path --provider=lm-studio --base-url=http://127.0.0.1:1234/v1
```

> **Note**
> OpenAI-compatible servers (LM Studio, vLLM, etc.) expose their chat endpoints under `/v1/chat/completions`. The CLI will append `/v1` automatically if you omit it, but declaring it explicitly avoids extra warnings in the logs.

If your OpenAI-compatible server returns an error such as ``"'response_format.type' must be 'json_schema' or 'text'"``, the CLI will automatically retry the request with plain text responses while keeping the JSON parsing instructions in the prompt. You can also disable JSON mode proactively with `--no-json-mode` (or set `"jsonMode": false` in `~/ji-renamer.json`).

> **Prompt size control**
> Smaller-context models can struggle with the detailed metadata that `ji-renamer` supplies. Use `--prompt-char-budget=8000` (or your preferred limit) to cap the prompt length, or set the value to `0` to disable trimming entirely. The CLI will automatically annotate the prompt when segments are truncated so you know what was omitted.

## Command Options
All CLI flags are persisted to `~/ji-renamer.json`, so you only need to configure them once. Run `npx --no-install ji-renamer-local --help` for the full list:

```text
Options:
  -h, --help                    Show help                              [boolean]
      --version                 Show version number                    [boolean]
  -p, --provider                Set the provider (e.g. ollama, openai,
                                lm-studio)                              [string]
  -a, --api-key                 Set the API key if you're using openai as
                                provider                                [string]
  -u, --base-url                Set the API base URL (include /v1 for
                                OpenAI-compatible servers)               [string]
  -m, --model                   Set the model to use (e.g. gemma2, llama3,
                                gpt-4o)                                 [string]
  -f, --frames                  Set the maximum number of frames to extract from
                                videos (e.g. 3, 5, 10)                  [number]
  -c, --case                    Set the case style (e.g. camelCase, pascalCase,
                                snakeCase, kebabCase)                   [string]
  -x, --chars                   Set the maximum number of characters in the new
                                filename (e.g. 25)                      [number]
  -l, --language                Set the output language (e.g. English, Turkish)
                                                                        [string]
  -s, --include-subdirectories  Include files in subdirectories when processing
                                (e.g: true, false)                      [string]
  -r, --custom-prompt           Add a custom prompt to the LLM (e.g. "Only
                                describe the background")               [string]
      --instructions-file       Append additional system instructions from a
                                local file                               [string]
      --subject-stopwords       Comma-separated tokens to strip from detected
                                subject names                            [string]
      --dry-run                 Preview suggestions without renaming     [boolean]
      --summary                 Print a summary report after the run     [boolean]
      --append-date             Ask the model to select the most relevant
                                metadata/creation date and report it in the
                                log                                    [boolean]
      --date-format             Template for the appended date segment (use
                                ${value}/${cased}; defaults to ${value})   [string]
      --date-value-format       Raw date pattern to request from the model
                                (e.g. YYYY-MM-DD, YYYYMMDD)               [string]
      --max-file-size           Skip files larger than the given size in MB
                                                                      [number]
      --only-extensions         Only process files with these extensions
                                                                      [string]
      --ignore-extensions       Skip files with these extensions         [string]
      --organize-by-subject     Group renamed files into subject folders
                                                                       [boolean]
      --subject-destination     Destination directory for subject folders
                                                                      [string]
      --move-unknown-subjects   Send low-confidence matches to an Unknown
                                 folder                                 [boolean]
      --log-file                Custom path for the JSONL operation log   [string]
      --prompt-char-budget      Maximum characters to send to the model (0 disables trimming)
                                                                        [number]
      --subject-format          Template for embedding the subject segment (use
                                ${value} or ${cased}; empty disables)    [string]
      --subject-brief-format    Template for a concise subject descriptor
                                segment (use ${value}/${cased})          [string]
      --document-description-format
                                Template for a document description segment
                                (use ${value}/${cased})                  [string]
      --segment-separator       Separator between filename segments       [string]
      --json-mode               Force providers to request JSON responses
                                                                       [boolean]
```

`ji-renamer` uses the [`change-case`](https://github.com/blakeembrey/change-case) library for case styling:

```text
camelCase: twoWords
capitalCase: Two Words
constantCase: TWO_WORDS
dotCase: two.words
kebabCase: two-words
noCase: two words
pascalCase: TwoWords
pascalSnakeCase: Two_Words
pathCase: two/words
sentenceCase: Two words
snakeCase: two_words
trainCase: Two-Words
```

### Logging & Rollback
Each invocation produces a newline-delimited JSON (`.jsonl`) log so you can audit or undo a run. By default the log is written next to the root folder you process (for example `ji-renamer-log-2025-01-01T12-00-00Z.jsonl`), and every entry captures the original path, the proposed or final destination, chosen subject, the concise subject brief, any notes returned by the model, the document description, the date that was appended, and the list of candidate dates the model evaluated. During the run the CLI also renders ASCII status cards that summarise the chosen segments, subject confidence, date source, and whether the file is being moved, so you can follow the decision trail in real time.

Pass `--log-file=/custom/path.jsonl` to override the destination or to aggregate multiple runs into the same log. Because the format is machine-readable you can build rollback scripts that replay entries in reverse to restore original filenames.

## Subject Organization Workflow
Enable `--organize-by-subject` to route accepted renames into folders named after their inferred company, project, or person. Before processing begins the CLI scans the destination directory, adds existing folder names to the prompt as hints, and keeps the list in memory to avoid duplicates during the run. Use `--subject-destination` to route the folders (and the generated log) to a different workspace, and add `--move-unknown-subjects` to quarantine low-confidence matches in an `Unknown` folder.

Dry-run mode prints the proposed folder moves without touching the filesystem so you can vet the plan before committing. When renames are confirmed, the tool records the chosen subject, destination, and confidence in the run summary for later auditing.

If you need to avoid specific tokens in inferred subjects, pass them via `--subject-stopwords`, or append bespoke instructions with `--instructions-file` to fine-tune the guidance the LLM receives.

### Subject & description templates

Use the formatting flags to structure filenames consistently while still letting the model infer useful metadata. Each template supports two placeholders:

- `${value}` – the raw text returned by the model (for example the proper noun subject or the title-style description).
- `${cased}` – the same text passed through the active `--case` formatter.

For example:

```bash
ji-renamer \
  --subject-format='[${value}]' \
  --subject-brief-format='[${value}]' \
  --document-description-format='[${value}]' \
  --segment-separator='-' \
  --append-date \
  ~/Downloads
```

When the model identifies the subject as `Mistral`, a brief of `AI Lab`, and a document description of `Series-A Pitch Deck`, the resulting filename would resemble:

```
[Mistral]-[AI Lab]-[Series-A Pitch Deck]-2025-10-01.pdf
```

Dates follow the same templating rules. `--date-format` controls how the selected date segment is wrapped (defaulting to `${value}`), while `--date-value-format` defines the raw date string the model should return (default `YYYY-MM-DD`). Combine them to generate output such as `[2025-10-05]` by running:

```bash
ji-renamer \
  --append-date \
  --date-value-format='YYYY-MM-DD' \
  --date-format='[${cased}]'
```

Subject folders created by `--organize-by-subject` continue to follow the subject name itself (for example `./Mistral`) so your workspace layout remains predictable.

## Contribution
Feel free to contribute. Open a new [issue](../../issues/new/choose) or start a [pull request](../../compare) against this repository.

## Credits
- Original concept and initial implementation by [Özgür Özer](https://github.com/ozgrozer).
- Comprehensive rewrite, metadata pipeline, OCR handling, provider integrations, and ongoing maintenance by the current ji-renamer contributors.

Please direct support requests, bug reports, and feature ideas to this repository. The upstream author is not responsible for this rewritten codebase.

## License
GPLv3

## Product Requirements Document
### 1. Purpose and Background
- **Problem**: Startup investors, researchers, and operators download numerous artifacts (pitch decks, financials, product shots). Files arrive with generic names, making due diligence slow and error prone.
- **Opportunity**: Automate the renaming and triage step by leveraging multimodal LLMs to understand file content, enforce a consistent taxonomy, and keep archives searchable.

### 2. Product Objectives
1. Generate concise, human-readable filenames that accurately reflect file contents.
2. Maintain a fast, privacy-friendly workflow by allowing local inference through Ollama or LM Studio.
3. Support organization features that mirror investors' mental models (by company/project/person) and prevent duplicate folders.
4. Provide safety nets—dry runs, size and extension filters, Unknown routing—so users can trust batch operations.

### 3. Target Users and Personas
- **Venture Capital Associate (Primary)**: Processes 50–200 documents per week across multiple deals, needs a sortable archive to brief partners.
- **Startup Advisor**: Collects product collateral from clients, wants folders grouped by company with minimal manual effort.
- **Operations Analyst**: Renames logs, specs, or compliance documents pulled from various systems and must guarantee traceability.

### 4. User Stories
- *As an associate*, I can point the CLI at a download folder and have files renamed and filed under the correct startup so prep work is faster.
- *As an advisor*, I can run in dry-run mode to verify subjects before allowing files to move into shared deal folders.
- *As an analyst*, I can skip oversized exports or irrelevant extensions to keep the run focused on the artifacts I need to archive.
- *As any user*, I can review a summary report to confirm what was renamed, moved, skipped, or flagged as Unknown.

### 5. Scope and Requirements
#### Functional Requirements
- The CLI SHALL support Ollama, LM Studio, and OpenAI providers, each configurable via flags.
- The CLI SHALL inspect text, images, and videos to extract meaningful context before prompting the model.
- The CLI SHALL support subject-aware organization, reusing existing folder names and logging subject confidence.
- The CLI SHALL respect dry-run mode by avoiding filesystem writes while still previewing renames and moves.
- The CLI SHALL persist user configuration between runs.

#### Non-Functional Requirements
- Operations MUST complete within a reasonable time for batches of 100 files on modern hardware (target: under 5 minutes for mixed PDFs and images with a local 7B–13B model).
- Actions MUST be transparent, with verbose logs and summary output for auditing.
- Defaults MUST favor privacy (local models, no cloud calls unless requested) and be recoverable through config resets.

### 6. Success Metrics
- ≥90% of renamed files pass manual spot checks for descriptive accuracy.
- ≥75% reduction in manual renaming time for a 50-file batch compared to baseline manual workflows.
- Zero data-loss incidents reported across the first 100 production runs (dry-run and Unknown routing prevent destructive moves).

### 7. Release Plan
1. **MVP**: Provider support, core renaming, case formatting, configuration persistence.
2. **Batch Controls**: Add dry-run, summary reporting, and filtering to improve trust in large runs.
3. **Subject Organization**: Introduce folder scanning, Unknown routing, and destination overrides tailored to startup diligence.
4. **Future Enhancements**: Add collaborative log exports, tagging, and deeper OCR integrations.

### 8. Risks and Mitigations
- **Model hallucination** → Allow manual confirmation, dry-run previews, and Unknown routing.
- **Duplicate folder sprawl** → Scan destination directories and normalize subject labels before creating folders.
- **Provider instability** → Support multiple providers and allow offline local models.

### 9. Open Questions
- Should the CLI offer plug-ins for CRM integrations (Affinity, HubSpot) to push renamed files automatically?
- Do users need a TUI/GUI layer for bulk approvals, or is the CLI sufficient for the core audience?
- What telemetry (if any) is acceptable for improving heuristics without violating privacy expectations?
