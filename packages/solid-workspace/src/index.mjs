import oldm from '@muze-nl/oldm'

export const packageName = '@muze-labs/solid-workspace'

export function workspace(options = {}) {
  return new SolidWorkspace(options)
}

export function collection(options = {}) {
  return {
    kind: 'collection',
    ...options
  }
}

export function mergeGraphDocuments(documents = [], options = {}) {
  if (!Array.isArray(documents)) {
    throw new TypeError('solid-workspace: graph documents must be an array')
  }

  const base = graphDocumentFrom(documents[0])
  const merged = {
    format: options.format ?? base.format,
    version: options.version ?? base.version,
    prefixes: {},
    subjects: []
  }
  const subjectsById = new Map()

  for (const document of documents.map(graphDocumentFrom)) {
    Object.assign(merged.prefixes, document.prefixes)

    for (const subject of document.subjects) {
      if (!subject?.id) continue

      const current = subjectsById.get(subject.id)
      if (!current) {
        const clone = cloneValue(subject)
        subjectsById.set(subject.id, clone)
        merged.subjects.push(clone)
        continue
      }

      mergeSubject(current, subject)
    }
  }

  const target = {
    ...merged,
    changed: !graphDocumentsEqual(base, merged)
  }

  if (Object.keys(target.prefixes).length === 0) {
    delete target.prefixes
  }

  if (target.format == null) delete target.format
  if (target.version == null) delete target.version

  return target
}

export const solid = {
  resource(url, options = {}) {
    return source('resource', url, options)
  },
  turtleResource(url, options = {}) {
    return source('resource', url, options)
  },
  container(url, options = {}) {
    return source('container', ensureSlash(url), options)
  }
}

export const graph = {
  resource(options = {}) {
    return graphResource(options)
  }
}

export const local = {
  memory(idOrOptions, options = {}) {
    const config = typeof idOrOptions === 'string'
      ? { ...options, id: idOrOptions }
      : { ...idOrOptions }
    const id = config.id ?? config.key ?? 'local-memory'
    const url = config.url ?? `memory://${encodeURIComponent(id)}`
    let document = graphDocumentFrom(config.document ?? {
      format: config.format ?? 'oldmed-graph',
      version: config.version ?? 1,
      prefixes: config.prefixes ?? {},
      subjects: []
    })

    return graphResource({
      ...config,
      id,
      url,
      local: true,
      async load() {
        return cloneGraphDocument(document)
      },
      async save(value) {
        document = graphDocumentFrom(value)
        return {
          ok: true,
          status: 'saved',
          sourceUrl: url,
          document: cloneGraphDocument(document)
        }
      },
      async turtle() {
        return graphDocumentToTurtle(document, {
          url,
          prefixes: config.prefixes
        })
      }
    })
  }
}

export class SolidWorkspace {
  constructor(options = {}) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('solid-workspace: workspace options must be an object')
    }

    const client = options.solid ?? options.lading ?? options.client

    this.solid = client
    this.sources = normalizeSources(options.sources ?? [])
    this.sourceById = new Map(this.sources.map(source => [source.id, source]))
    this.records = []
    this.objects = new WeakMap()
    this.collections = Object.fromEntries(
      Object.entries(options.collections ?? {}).map(([name, descriptor]) => [
        name,
        new WorkspaceCollection(this, name, descriptor)
      ])
    )
  }

  addSource(sourceOrSources) {
    const sources = normalizeSources(Array.isArray(sourceOrSources) ? sourceOrSources : [sourceOrSources])

    for (const descriptor of sources) {
      const existing = this.sources.findIndex(source => source.id === descriptor.id)
      if (existing >= 0) {
        this.sources[existing] = descriptor
      } else {
        this.sources.push(descriptor)
      }
      this.sourceById.set(descriptor.id, descriptor)
    }

    return sources.length === 1 ? sources[0] : sources
  }

  setClient(client) {
    this.solid = client
    return this
  }

  async load(options = {}) {
    const sources = normalizeLoadSources(this, options.sources ?? this.sources)
    const preserved = this.records.filter(record => (
      record.status === 'new'
      || !recordBelongsToSources(record, sources)
    ))
    this.records = preserved
    this.objects = new WeakMap()

    for (const record of preserved) {
      this.objects.set(record.object, record)
    }

    for (const source of sources) {
      await this.loadSource(source)
    }

    return this
  }

  async loadSource(sourceOrId) {
    const descriptor = resolveSource(this, sourceOrId)

    if (descriptor.kind === 'container') {
      assertSolidClient(this)
      const entries = await this.solid.container(descriptor.url).contains(descriptor.options)

      for (const entry of entries) {
        await this.loadSource({
          ...descriptor,
          kind: 'resource',
          url: entry.url,
          parent: descriptor
        })
      }

      return entries
    }

    if (typeof descriptor.load === 'function') {
      const document = graphDocumentFrom(await descriptor.load({
        source: descriptor,
        workspace: this
      }))
      const objects = document.subjects

      for (const object of objects) {
        this.track(object, {
          source: descriptor,
          sourceUrl: descriptor.url,
          status: 'loaded'
        })
      }

      return objects
    }

    assertSolidClient(this)
    const response = await this.solid.resource(descriptor.url).get(descriptor.options)
    const objects = subjectsFromResponse(response)

    this.trackObjects(objects, {
      response,
      source: descriptor,
      sourceUrl: descriptor.url,
      status: 'loaded'
    })

    return objects
  }

  trackObjects(objects, options = {}) {
    for (const object of objects) {
      this.track(object, options)
    }

    return objects
  }

  dataset(options = {}) {
    const records = recordsForSources(this, options.sources ?? this.sources)
    return mergeGraphDocuments([
      {
        format: options.format,
        version: options.version,
        prefixes: options.prefixes,
        subjects: records.map(record => record.object)
      }
    ], options)
  }

  async sync(options = {}) {
    const target = resolveSource(this, options.into)

    if (target.kind !== 'resource') {
      throw new Error('solid-workspace: sync target must be a resource source')
    }

    if (target.readOnly) {
      throw new Error(`solid-workspace: source ${target.id} is read-only`)
    }

    const sourceDocument = options.document ?? this.dataset({
      sources: options.from ?? this.sources,
      format: options.format,
      version: options.version,
      prefixes: options.prefixes
    })
    const targetDocument = options.loadTarget === false
      ? graphDocumentFrom(options.targetDocument)
      : await this.loadGraphDocument(target, options)
    const document = mergeGraphDocuments([
      targetDocument,
      sourceDocument
    ], options)

    if (!document.changed && options.force !== true) {
      return {
        ok: true,
        status: 'unchanged',
        source: target,
        sourceUrl: target.url,
        document
      }
    }

    const response = await saveGraphDocument(this, target, document, options.writeOptions)

    return {
      ok: true,
      status: 'synced',
      source: target,
      sourceUrl: target.url,
      document,
      response
    }
  }

  async loadGraphDocument(sourceOrId, options = {}) {
    const descriptor = resolveSource(this, sourceOrId)

    if (descriptor.kind !== 'resource') {
      throw new Error('solid-workspace: graph documents can only be loaded from resource sources')
    }

    if (typeof descriptor.load === 'function') {
      return graphDocumentFrom(await descriptor.load({
        source: descriptor,
        workspace: this,
        ...options.readOptions
      }))
    }

    assertSolidClient(this)
    try {
      const response = await this.solid.resource(descriptor.url).get({
        ...descriptor.options,
        ...options.readOptions
      })

      if (response?.status === 404 || response?.status === 410) {
        return graphDocumentFrom(null)
      }

      return graphDocumentFrom(response?.data)
    } catch (error) {
      const status = error.cause?.status ?? error.response?.status
      if (status === 404 || status === 410) {
        return graphDocumentFrom(null)
      }
      throw error
    }
  }

  track(object, options = {}) {
    if (!isObject(object)) {
      throw new TypeError('solid-workspace: can only track object values')
    }

    const record = {
      object,
      source: options.source ?? null,
      sourceUrl: options.sourceUrl ?? options.source?.url ?? object.id ?? null,
      response: options.response ?? null,
      status: options.status ?? 'loaded',
      readOnly: Boolean(options.readOnly ?? options.source?.readOnly),
      created: Boolean(options.created),
      deleted: Boolean(options.deleted),
      error: null
    }

    this.records.push(record)
    this.objects.set(object, record)
    return record
  }

  sourceOf(object, predicate, value) {
    return this.sourcesOf(object, predicate, value)[0] ?? null
  }

  sourcesOf(object, predicate, value) {
    const record = this.objects.get(object)
    if (!record) {
      return []
    }

    const oldmSources = oldmSourcesOf(record, object, predicate, value)
    if (oldmSources.length > 0) {
      return oldmSources.map(sourceUrl => ({
        sourceUrl,
        source: this.sourceById.get(sourceUrl) ?? record.source,
        record
      }))
    }

    return [{
      sourceUrl: record.sourceUrl,
      source: record.source,
      record
    }]
  }

  async createIn(sourceOrId, object, options = {}) {
    const descriptor = resolveSource(this, sourceOrId)

    if (descriptor.readOnly) {
      throw new Error(`solid-workspace: source ${descriptor.id} is read-only`)
    }

    this.track(object, {
      source: descriptor,
      sourceUrl: null,
      status: 'new',
      created: true
    })

    if (options.save === false) {
      return object
    }

    await this.save(object, options)
    return object
  }

  async save(object, options = {}) {
    const record = this.objects.get(object)

    if (!record) {
      throw new Error('solid-workspace: cannot save an object that is not tracked by this workspace')
    }

    const validation = validateRecord(record)
    if (!validation.ok) {
      return updateRecordStatus(record, {
        ok: false,
        status: 'validation_failed',
        issues: validation.issues
      })
    }

    if (record.readOnly) {
      return updateRecordStatus(record, {
        ok: false,
        status: 'read_only',
        error: new Error(`solid-workspace: source ${record.source?.id ?? record.sourceUrl} is read-only`)
      })
    }

    try {
      if (typeof record.source?.save === 'function') {
        const document = this.dataset({
          sources: [record.source.id]
        })
        const response = await saveGraphDocument(this, record.source, document, options)
        record.sourceUrl = record.source.url
        record.created = false
        return updateRecordStatus(record, {
          ok: true,
          status: record.deleted ? 'deleted' : 'saved',
          response
        })
      }

      assertSolidClient(this)
      if (record.deleted) {
        const response = await this.solid.resource(record.sourceUrl).delete(options)
        return updateRecordStatus(record, { ok: true, status: 'deleted', response })
      }

      if (record.created || !record.sourceUrl) {
        const source = record.source
        const response = source.kind === 'container'
          ? await this.solid.container(source.url).post(record.object, writeOptions(source, options))
          : await this.solid.resource(source.url).create(record.object, writeOptions(source, options))

        record.sourceUrl = response.location ?? source.url
        record.created = false
        return updateRecordStatus(record, { ok: true, status: 'created', response })
      }

      const response = await this.solid.resource(record.sourceUrl).put(record.object, writeOptions(record.source, options))
      return updateRecordStatus(record, { ok: true, status: 'saved', response })
    } catch (error) {
      return updateRecordStatus(record, { ok: false, status: 'error', error })
    }
  }

  async delete(object, options = {}) {
    const record = this.objects.get(object)

    if (!record) {
      throw new Error('solid-workspace: cannot delete an object that is not tracked by this workspace')
    }

    record.deleted = true
    if (options.save === false) {
      record.status = 'deleted_pending'
      return statusFor(record, { ok: true, status: record.status })
    }

    return this.save(object, options)
  }

  async saveAll(records = this.records) {
    const statuses = []

    for (const recordOrObject of records) {
      const object = recordOrObject?.object ?? recordOrObject
      statuses.push(await this.save(object))
    }

    const failures = statuses.filter(status => !status.ok)

    if (failures.length > 0) {
      const error = new Error('solid-workspace: saveAll failed')
      error.statuses = statuses
      error.failures = failures
      throw error
    }

    return statuses
  }
}

export class WorkspaceCollection {
  constructor(workspace, name, descriptor = {}) {
    this.workspace = workspace
    this.name = name
    this.descriptor = normalizeCollection(descriptor)
  }

  list() {
    return this.workspace.records
      .filter(record => !record.deleted)
      .filter(record => collectionIncludesRecord(this.descriptor, record))
      .map(record => record.object)
  }

  get(id) {
    return this.list().find(object => object.id === id || object['@id'] === id) ?? null
  }

  async create(object = {}, options = {}) {
    const data = this.descriptor.shape?.applyDefaults
      ? this.descriptor.shape.applyDefaults(object)
      : { ...object }

    const validation = this.descriptor.shape?.validate?.(data)
    if (validation && !validation.ok) {
      const error = new Error(`solid-workspace: ${this.name} object does not match its shape`)
      error.validation = validation
      throw error
    }

    return this.workspace.createIn(options.createIn ?? this.descriptor.createIn, data, {
      ...options,
      save: options.save ?? false
    })
  }

  update(object, changes = {}) {
    Object.assign(object, changes)
    return object
  }

  delete(object, options = {}) {
    return this.workspace.delete(object, options)
  }

  save(object, options = {}) {
    return this.workspace.save(object, options)
  }

  saveAll() {
    return this.workspace.saveAll(this.workspace.records.filter(record => (
      collectionIncludesRecord(this.descriptor, record)
    )))
  }
}

function source(kind, url, options) {
  if (!url) {
    throw new TypeError('solid-workspace: source url is required')
  }

  return Object.freeze({
    kind,
    id: options.id ?? String(url),
    url: String(url),
    readOnly: Boolean(options.readOnly),
    shape: options.shape ?? null,
    options: options.options ?? {},
    ...options
  })
}

function graphResource(options = {}) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('solid-workspace: graph resource options must be an object')
  }
  if (!options.id) {
    throw new TypeError('solid-workspace: graph resource id is required')
  }
  if (!options.url) {
    throw new TypeError('solid-workspace: graph resource url is required')
  }
  if (typeof options.load !== 'function') {
    throw new TypeError('solid-workspace: graph resource load() is required')
  }

  return Object.freeze({
    kind: 'resource',
    readOnly: Boolean(options.readOnly),
    shape: options.shape ?? null,
    options: options.options ?? {},
    writeOptions: options.writeOptions,
    ...options,
    id: options.id,
    url: String(options.url)
  })
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) {
    throw new TypeError('solid-workspace: sources must be an array')
  }

  return sources.map(descriptor => {
    if (!descriptor || (descriptor.kind !== 'resource' && descriptor.kind !== 'container')) {
      throw new TypeError('solid-workspace: sources must be solid.resource() or solid.container() descriptors')
    }

    return descriptor
  })
}

function normalizeCollection(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('solid-workspace: collection descriptor must be an object')
  }

  const sources = descriptor.sources ?? []
  if (!Array.isArray(sources)) {
    throw new TypeError('solid-workspace: collection sources must be an array')
  }

  return {
    ...descriptor,
    sources,
    createIn: descriptor.createIn ?? sources[0]
  }
}

function normalizeLoadSources(currentWorkspace, sources) {
  if (!Array.isArray(sources)) {
    sources = [sources]
  }

  return sources.map(sourceOrId => resolveSource(currentWorkspace, sourceOrId))
}

function resolveSource(currentWorkspace, sourceOrId) {
  if (!sourceOrId) {
    throw new TypeError('solid-workspace: source is required')
  }

  if (typeof sourceOrId === 'string') {
    const descriptor = currentWorkspace.sourceById.get(sourceOrId)
    if (!descriptor) {
      throw new Error(`solid-workspace: unknown source ${sourceOrId}`)
    }
    return descriptor
  }

  return sourceOrId
}

function recordsForSources(currentWorkspace, sources) {
  const descriptors = new Set(normalizeLoadSources(currentWorkspace, sources))
  const ids = new Set([...descriptors].map(source => source.id))

  return currentWorkspace.records.filter(record => !record.deleted).filter(record => {
    const source = record.source?.parent ?? record.source
    return source && (descriptors.has(source) || ids.has(source.id))
  })
}

function recordBelongsToSources(record, sources) {
  const source = record.source?.parent ?? record.source
  return Boolean(source && sources.some(candidate => candidate === source || candidate.id === source.id))
}

function collectionIncludesRecord(descriptor, record) {
  if (descriptor.sources.length > 0) {
    const sourceIds = new Set(descriptor.sources)
    const sourceId = record.source?.parent?.id ?? record.source?.id

    if (!sourceIds.has(sourceId)) {
      return false
    }
  }

  if (descriptor.shape?.class) {
    const classes = values(record.object.rdf$type)
    if (!classes.includes(descriptor.shape.class)) {
      return false
    }
  }

  return true
}

function subjectsFromResponse(response) {
  const data = response?.data

  if (!data) {
    return []
  }

  if (Array.isArray(data)) {
    return data.filter(isObject)
  }

  if (Array.isArray(data.data)) {
    return data.data.filter(isObject)
  }

  if (data.subjects && typeof data.subjects === 'object') {
    return Object.values(data.subjects).filter(isObject)
  }

  if (isObject(data.primary)) {
    return [data.primary]
  }

  return isObject(data) ? [data] : []
}

function graphDocumentFrom(value) {
  if (!value) {
    return {
      format: null,
      version: null,
      prefixes: {},
      subjects: []
    }
  }

  if (Array.isArray(value)) {
    return {
      format: null,
      version: null,
      prefixes: {},
      subjects: value.filter(isObject)
    }
  }

  if (Array.isArray(value.subjects)) {
    return {
      format: value.format ?? null,
      version: value.version ?? null,
      prefixes: value.prefixes ?? {},
      subjects: value.subjects.filter(isObject)
    }
  }

  if (value.subjects && typeof value.subjects === 'object') {
    return {
      format: value.format ?? null,
      version: value.version ?? null,
      prefixes: value.prefixes ?? {},
      subjects: Object.values(value.subjects).filter(isObject)
    }
  }

  if (Array.isArray(value.data)) {
    return {
      format: value.format ?? null,
      version: value.version ?? null,
      prefixes: value.prefixes ?? {},
      subjects: value.data.filter(isObject)
    }
  }

  if (isObject(value.primary)) {
    return {
      format: value.format ?? null,
      version: value.version ?? null,
      prefixes: value.prefixes ?? {},
      subjects: [value.primary]
    }
  }

  return {
    format: null,
    version: null,
    prefixes: {},
    subjects: isObject(value) ? [value] : []
  }
}

function mergeSubject(target, incoming) {
  for (const [predicate, value] of Object.entries(incoming)) {
    if (predicate === 'id') continue

    if (!Object.hasOwn(target, predicate)) {
      target[predicate] = cloneValue(value)
      continue
    }

    target[predicate] = mergeValues(target[predicate], value)
  }

  return target
}

function mergeValues(left, right) {
  if (valueEquals(left, right)) {
    return left
  }

  if (isObject(left) && isObject(right) && left.id && left.id === right.id) {
    return mergeSubject(left, right)
  }

  const values = []
  for (const item of [...arrayValues(left), ...arrayValues(right)]) {
    if (!values.some(existing => valueEquals(existing, item))) {
      values.push(cloneValue(item))
    }
  }

  return values.length === 1 ? values[0] : values
}

function arrayValues(value) {
  return Array.isArray(value) ? value : [value]
}

function valueEquals(left, right) {
  return valueKey(left) === valueKey(right)
}

function valueKey(value) {
  if (isObject(value)) {
    return value.id ? `id:${value.id}` : `json:${JSON.stringify(sortObject(value))}`
  }

  return `${typeof value}:${String(value)}`
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject)
  }

  if (!isObject(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObject(item)])
  )
}

function graphDocumentsEqual(left, right) {
  return JSON.stringify(sortObject(graphDocumentComparable(left))) === JSON.stringify(sortObject(graphDocumentComparable(right)))
}

function graphDocumentComparable(document) {
  return {
    format: document.format ?? null,
    version: document.version ?? null,
    prefixes: document.prefixes ?? {},
    subjects: document.subjects ?? []
  }
}

function cloneGraphDocument(document) {
  const graphDocument = graphDocumentFrom(document)
  return {
    ...graphDocument,
    prefixes: cloneValue(graphDocument.prefixes),
    subjects: cloneValue(graphDocument.subjects)
  }
}

function graphDocumentToTurtle(document, options = {}) {
  const graphDocument = graphDocumentFrom(document)
  const context = oldm.context({
    defaultGraph: options.url,
    prefixes: {
      ...graphDocument.prefixes,
      ...options.prefixes
    }
  })
  const graph = context.parse('', options.url, 'text/turtle')

  for (const subject of graphDocument.subjects) {
    writeSubjectToGraph({ graph, subject })
  }

  return graph.write()
}

function writeSubjectToGraph({ graph, subject }) {
  if (!subject?.id) return null

  for (const [predicate, value] of Object.entries(subject)) {
    if (predicate === 'id') continue

    graph.set(subject.id, predicate, graphValueFromObjectValue({ graph, value }))
  }

  return subject.id
}

function graphValueFromObjectValue({ graph, value }) {
  if (Array.isArray(value)) {
    return value.map(item => graphValueFromObjectValue({ graph, value: item }))
  }

  if (isObject(value)) {
    if (value.id) {
      writeSubjectToGraph({ graph, subject: value })
      return value.id
    }

    return JSON.stringify(value)
  }

  return value
}

async function saveGraphDocument(workspace, source, document, options = {}) {
  if (typeof source.save === 'function') {
    return source.save(document, {
      source,
      workspace,
      ...options
    })
  }

  assertSolidClient(workspace)
  return workspace.solid.resource(source.url).put(document, writeOptions(source, options))
}

function assertSolidClient(workspace) {
  if (!workspace.solid) {
    throw new TypeError('solid-workspace: a Lading client is required for Solid sources')
  }
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue)
  }

  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)])
    )
  }

  return value
}

function oldmSourcesOf(record, object, predicate, value) {
  const context = record.response?.data?.context ?? record.response?.data?.primary?.context

  if (!context || typeof context.sources !== 'function') {
    return []
  }

  return context.sources(object, predicate, value)
    .map(source => typeof source === 'string' ? source : source?.url ?? source?.id)
    .filter(Boolean)
}

function validateRecord(record) {
  const validation = record.source?.shape?.validate?.(record.object)
  return validation ?? { ok: true, issues: [] }
}

function writeOptions(source, options) {
  return {
    contentType: 'text/turtle',
    ...source?.writeOptions,
    ...options
  }
}

function updateRecordStatus(record, status) {
  record.status = status.status
  record.error = status.error ?? null
  record.response = status.response?.response ?? status.response ?? record.response
  return statusFor(record, status)
}

function statusFor(record, status = {}) {
  return {
    object: record.object,
    sourceUrl: record.sourceUrl,
    source: record.source,
    ...status
  }
}

function ensureSlash(url) {
  return String(url).endsWith('/') ? String(url) : `${url}/`
}

function values(value) {
  if (value == null) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export default {
  packageName,
  workspace,
  collection,
  mergeGraphDocuments,
  graph,
  local,
  solid
}
