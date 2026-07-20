# JSFS-Solid reference

JSFS-Solid presents Solid storage through a JSFS filesystem-shaped adapter. It is built on top of Lading, so Solid HTTP resource/container behavior stays in `@muze-labs/lading`.

It does not provide app setup, login UI, WebID storage discovery, RDF parsing, or OLDM object mapping.

## Exports

```js
import {
  SolidAdapter,
  createSolidAdapter,
  solidFs,
  createSolidMetroClient,
  authorizePopup,
  popupHandleRedirect,
  oidcIdToken,
  resolveSolidUrl,
  pathFromUrl
} from '@muze-labs/jsfs-solid'
```

Default export:

```js
{
  SolidAdapter,
  createSolidAdapter,
  solidFs
}
```

## `solidFs(rootUrl, options)`

Creates a `SolidAdapter` and wraps it in JSFS's `FileSystem` wrapper.

```js
const fs = solidFs('https://pod.example/storage/', options)
```

Use this when application code wants normal JSFS operations:

```js
await fs.write('/notes/a.txt', 'Hello', { type: 'text/plain' })
const file = await fs.read('/notes/a.txt')
const entries = await fs.list('/notes/')
```

## `new SolidAdapter(rootUrl, path, options)`

`SolidAdapter` can also be used directly.

```js
const adapter = new SolidAdapter('https://pod.example/storage/', '/')
```

Constructor forms:

```js
new SolidAdapter(rootUrl)
new SolidAdapter(rootUrl, path)
new SolidAdapter(rootUrl, options)
new SolidAdapter(rootUrl, path, options)
```

Options:

- `path`: base filesystem path, default `/`.
- `metroClient`, `metro`, or `client`: an existing Metro client.
- `solid`: an existing Lading client.
- `configureMetro: true`: add JSFS-Solid's default Metro middleware stack even when a Metro client is supplied.
- `oidc: false`: skip default Metro-OIDC middleware.
- `oldm: false`: skip default Metro-OLDM middleware.

## Adapter operations

```js
adapter.url(path)
adapter.cd(path)
await adapter.read(path)
await adapter.write(path, contents, metadata)
await adapter.list(path)
await adapter.mkdir(path)
await adapter.rmdir(path)
await adapter.remove(path)
await adapter.delete(path)
await adapter.exists(path)
```

`read(path)` returns:

```js
{
  type,
  name,
  contents,
  data,
  http: { headers, status, url }
}
```

`write(path, contents, metadata)` delegates to Lading resource writes. Metadata may include:

- `type` or `contentType`
- `ifMatch`
- `ifNoneMatch`
- `headers`

`list(path)` delegates to Lading container containment and maps entries to:

```js
{ filename, path, url, type, resource }
```

`type` is `folder` for LDP containers or URLs ending in `/`, otherwise `file`.

## Metro composition

`createSolidMetroClient(input, options)` creates or reuses a Metro client.

When no client is supplied, JSFS-Solid may compose:

- `@muze-nl/metro`
- `@muze-nl/metro-oidc`
- `@muze-nl/metro-oldm`

When a client is supplied, it is treated as already configured unless `configureMetro: true` is set.

`authorizePopup` and `popupHandleRedirect` are re-exported from Metro-OAuth2 for Solid applications that use JSFS-Solid's default Metro-OIDC stack and want popup-based authorization rather than a full-page redirect. Metro-OIDC currently does not expose these helpers directly; JSFS-Solid exports them as the application-facing Solid setup package.

## Path helpers

```js
normalizePath(path)
joinPath(base, path)
resolveSolidUrl(rootUrl, basePath, path)
pathFromUrl(rootUrl, resourceUrl)
filename(pathOrUrl)
isAbsoluteUrl(value)
```

These helpers are filesystem/path conveniences for the adapter. They do not perform Solid HTTP requests.
