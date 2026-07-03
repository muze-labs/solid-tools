const BASIC_CONTAINER = 'http://www.w3.org/ns/ldp#BasicContainer'

export function headersObject(headers = {}) {
  if (!headers) {
    return {}
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }
  if (typeof headers.entries === 'function' && typeof headers.get === 'function') {
    return Object.fromEntries(headers.entries())
  }
  return { ...headers }
}

export function getHeader(headers, name) {
  if (!headers) {
    return null
  }
  if (typeof headers.get === 'function') {
    return headers.get(name)
  }
  const wanted = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted)
  return entry ? entry[1] : null
}

export function mergeHeaders(...parts) {
  return parts.reduce((merged, part) => ({ ...merged, ...headersObject(part) }), {})
}

export function solidRequestHeaders(options = {}) {
  const headers = headersObject(options.headers)

  if (options.accept) {
    headers.Accept = options.accept
  }
  if (options.contentType || options.type) {
    headers['Content-Type'] = options.contentType ?? options.type
  }
  if (options.slug) {
    headers.Slug = options.slug
  }
  if (options.ifMatch) {
    headers['If-Match'] = options.ifMatch
  }
  if (options.ifNoneMatch) {
    headers['If-None-Match'] = options.ifNoneMatch
  }
  if (options.etag && !headers['If-Match']) {
    headers['If-Match'] = options.etag
  }

  return headers
}

export function containerLinkHeader(type = BASIC_CONTAINER) {
  return `<${type}>; rel="type"`
}

export function containerHeaders(options = {}) {
  return solidRequestHeaders({
    ...options,
    headers: mergeHeaders({ Link: containerLinkHeader(options.containerType) }, options.headers)
  })
}

export function getLocation(response) {
  return getHeader(response?.headers, 'Location')
}

export function getETag(response) {
  return getHeader(response?.headers, 'ETag')
}

export function parseLinkHeader(value = '') {
  if (!value) {
    return []
  }

  return value
    .split(/,(?=\s*<)/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = part.match(/^<([^>]+)>\s*(.*)$/)
      if (!match) {
        return null
      }
      const [, href, rawParams] = match
      const params = {}
      for (const param of rawParams.split(';').map(item => item.trim()).filter(Boolean)) {
        const [key, rawValue = ''] = param.split('=')
        params[key] = rawValue.replace(/^"|"$/g, '')
      }
      return { href, ...params }
    })
    .filter(Boolean)
}

export function linksByRel(responseOrHeaders, rel) {
  const headers = responseOrHeaders?.headers ?? responseOrHeaders
  return parseLinkHeader(getHeader(headers, 'Link')).filter(link => link.rel === rel)
}
