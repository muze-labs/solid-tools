export function responseFromError(error) {
  return error?.cause ?? null
}

export function statusFromError(error) {
  return responseFromError(error)?.status ?? null
}
