# Solid Workspace reference

Solid Workspace is the source-aware data layer over Lading and OLDMed objects. It loads resources and containers through a supplied Lading client, tracks where objects came from, and writes changes back with per-resource status.

It does not provide authentication, RDF parsing, filesystem operations, SimplyFlow bindings, setup conventions, or UI state.

## Exports

```js
import {
  workspace,
  collection,
  mergeGraphDocuments,
  solid,
  SolidWorkspace,
  WorkspaceCollection
} from '@muze-labs/solid-workspace'
```

Default export:

```js
{
  packageName,
  workspace,
  collection,
  mergeGraphDocuments,
  solid
}
```

## Source descriptors

```js
solid.resource(url, options)
solid.container(url, options)
```

Options:

- `id`: stable source id. Defaults to the URL.
- `readOnly`: prevents writes to this source.
- `shape`: optional oldm-shape used before saving.
- `options`: read options passed to Lading.
- `writeOptions`: write options passed to Lading.

Container URLs are normalized to a trailing slash.

## `workspace(options)`

```js
const ws = workspace({
  solid,
  sources: [
    solid.container('https://pod.example/contacts/', { id: 'contacts' })
  ],
  collections: {
    contacts: collection({
      shape: ContactShape,
      sources: ['contacts'],
      createIn: 'contacts'
    })
  }
})
```

Options:

- `solid`, `lading`, or `client`: a Lading client.
- `sources`: source descriptors.
- `collections`: named collection descriptors.

## Workspace methods

```js
await ws.load()
await ws.load({ sources: ['contacts'] })
await ws.loadSource('contacts')

ws.dataset()
await ws.sync({ from: ['local'], into: 'remote' })

ws.track(object, options)
ws.sourceOf(object)
ws.sourcesOf(object, predicate, value)

await ws.createIn('contacts', object)
await ws.save(object)
await ws.delete(object)
await ws.saveAll()
```

`load()` reads configured sources. Resource sources call `solid.resource(url).get()`. Container sources call `solid.container(url).contains()` and then load each contained resource.

Loaded objects are read from Metro-OLDM-shaped response data:

- `response.data.subjects`
- `response.data.data`
- `response.data.primary`
- `response.data`

`sourceOf()` returns the tracked source for an object. When a parsed OLDM context exposes `context.sources()`, `sourcesOf(object, predicate, value)` delegates fact-level source lookup to it.

## Open-World Dataset

`dataset()` returns a single graph document view over selected workspace sources:

```js
const graph = ws.dataset({ sources: ['local', 'remote'] })
```

The dataset uses open-world additive merging. Subjects with different ids are preserved. Subjects with the same id are combined by preserving known facts; conflicting predicate values become multi-values instead of being treated as deletion or replacement.

`mergeGraphDocuments()` exposes the same pure merge primitive for callers that already have graph documents:

```js
const graph = mergeGraphDocuments([
  localDocument,
  remoteDocument
])
```

`sync()` projects a dataset into a writable resource source:

```js
await ws.sync({
  from: ['local'],
  into: 'remote'
})
```

This is intentionally additive. It does not interpret absence as deletion and does not resolve semantic conflicts beyond preserving all values.

## Collections

```js
const contacts = ws.collections.contacts

contacts.list()
contacts.get(id)
await contacts.create(object)
contacts.update(object, changes)
await contacts.delete(object)
await contacts.save(object)
await contacts.saveAll()
```

A collection can filter by:

- `sources`: source ids.
- `shape.class`: matching `rdf$type` values.

`create(object)` applies shape defaults and validates the object. By default it tracks the object without saving immediately. Use `contacts.save(object)` or `contacts.saveAll()` to write.

## Save status

`save()` returns a status object:

```js
{
  ok,
  status,
  object,
  source,
  sourceUrl,
  response,
  error,
  issues
}
```

Common statuses:

- `created`
- `saved`
- `deleted`
- `validation_failed`
- `read_only`
- `error`

`saveAll()` returns all statuses when every save succeeds. If any save fails, it throws an error with `error.statuses` and `error.failures`.
