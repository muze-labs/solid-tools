function ensureSlash(value) {
  return String(value).endsWith('/') ? String(value) : `${value}/`
}

export function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value))
}

export function normalizePath(path = '/') {
  const text = String(path || '/')
  if (isAbsoluteUrl(text)) {
    return text
  }

  const parts = []
  for (const part of text.split('/')) {
    if (!part || part === '.') {
      continue
    }
    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }

  return `/${parts.join('/')}`
}

export function joinPath(base = '/', path = '/') {
  if (isAbsoluteUrl(path)) {
    return path
  }
  const basePath = normalizePath(base)
  const next = normalizePath(path)
  if (basePath === '/') {
    return next
  }
  if (next === '/') {
    return basePath
  }
  return normalizePath(`${basePath}/${next}`)
}

export function resolveSolidUrl(rootUrl, basePath, path = '/') {
  if (isAbsoluteUrl(path)) {
    return path
  }
  const fullPath = joinPath(basePath, path).replace(/^\//, '')
  return new URL(fullPath, ensureSlash(rootUrl)).href
}

export function pathFromUrl(rootUrl, resourceUrl) {
  const root = new URL(ensureSlash(rootUrl))
  const url = new URL(resourceUrl, root)
  if (url.origin === root.origin && url.pathname.startsWith(root.pathname)) {
    return `/${url.pathname.slice(root.pathname.length)}`.replace(/\/\//g, '/')
  }
  return url.pathname
}

export function filename(pathOrUrl) {
  const text = isAbsoluteUrl(pathOrUrl) ? new URL(pathOrUrl).pathname : String(pathOrUrl)
  const clean = text.endsWith('/') ? text.slice(0, -1) : text
  return clean.split('/').filter(Boolean).pop() ?? ''
}
