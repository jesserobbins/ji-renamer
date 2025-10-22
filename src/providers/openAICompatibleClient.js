const { parseModelResponse } = require('../utils/parseModelResponse')

function normalizeBaseUrl (rawBaseUrl, logger) {
  const trimmed = (rawBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')

  if (/\/v\d+(?:$|\/)/.test(trimmed)) {
    return trimmed
  }

  if (logger && typeof logger.warn === 'function') {
    logger.warn(`Base URL "${trimmed}" is missing an API version segment; defaulting to ${trimmed}/v1`)
  }

  return `${trimmed}/v1`
}

function createOpenAICompatibleClient (options, logger) {
  const baseUrl = normalizeBaseUrl(options.baseUrl, logger)
  const endpoint = `${baseUrl}/chat/completions`
  const model = options.model || (options.provider === 'lm-studio' ? 'lmstudio-community/llava' : 'gpt-4o')
  const useJsonMode = options.jsonMode !== false

  function buildBody (prompt, responseFormatType) {
    const userContent = [{ type: 'text', text: prompt.userMessage }]

    const normalizeImage = (image, fallbackMediaType) => {
      if (!image) {
        return null
      }

      if (image.type === 'image_url' && image.image_url?.url) {
        const payload = { url: image.image_url.url }
        const detail = image.image_url.detail || image.detail
        if (detail) {
          payload.detail = detail
        }
        return {
          type: 'image_url',
          image_url: payload
        }
      }

      if (typeof image.url === 'string' && image.url) {
        const payload = { url: image.url }
        if (image.detail) {
          payload.detail = image.detail
        }
        return { type: 'image_url', image_url: payload }
      }

      const mediaType = image.mediaType || fallbackMediaType || 'image/png'
      if (typeof image.base64 === 'string' && image.base64) {
        const payload = {
          url: `data:${mediaType};base64,${image.base64}`
        }
        if (image.detail) {
          payload.detail = image.detail
        }
        return { type: 'image_url', image_url: payload }
      }

      return null
    }

    const images = Array.isArray(prompt.images) ? prompt.images : []
    images.forEach(image => {
      const normalized = normalizeImage(image)
      if (normalized) {
        userContent.push(normalized)
      }
    })

    const frames = Array.isArray(prompt.frames) ? prompt.frames : []
    frames.forEach(frame => {
      const normalized = normalizeImage(
        typeof frame === 'string'
          ? { base64: frame, mediaType: 'image/jpeg' }
          : frame,
        'image/jpeg'
      )
      if (normalized) {
        userContent.push(normalized)
      }
    })

    const body = {
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [{ type: 'text', text: prompt.systemMessage }]
        },
        {
          role: 'user',
          content: userContent
        }
      ]
    }

    if (responseFormatType) {
      body.response_format = { type: responseFormatType }
    }

    return body
  }

  async function sendRequest (prompt, responseFormatType) {
    const headers = {
      'Content-Type': 'application/json'
    }
    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`
    }

    const body = buildBody(prompt, responseFormatType)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      const message = errorText || `status ${response.status}`

      throw new Error(`Provider request failed (${response.status}): ${message}`)
    }

    const data = await response.json()
    const message = data.choices?.[0]?.message?.content
    const parsed = parseModelResponse(message)
    return parsed
  }

  async function generateFilename (prompt) {
    const prefersJson = Boolean(useJsonMode)
    const initialFormat = prefersJson ? 'json_object' : 'text'

    try {
      return await sendRequest(prompt, initialFormat)
    } catch (error) {
      const canRetryAsText = prefersJson && initialFormat === 'json_object' && /'response_format.type' must be 'json_schema' or 'text'/.test(error.message)
      if (!canRetryAsText) {
        throw error
      }

      if (logger && typeof logger.warn === 'function') {
        logger.warn('Provider rejected json_object response_format; retrying with plain text responses.')
      }

      return sendRequest(prompt, 'text')
    }
  }

  return {
    generateFilename
  }
}

module.exports = {
  createOpenAICompatibleClient
}
