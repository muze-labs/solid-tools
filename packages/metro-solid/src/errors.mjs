export function responseFromError(error) {
  return error?.cause ?? error?.response ?? null
}

export function statusFromError(error) {
  return responseFromError(error)?.status ?? null
}
