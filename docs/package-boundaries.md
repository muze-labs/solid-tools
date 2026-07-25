# Package boundaries

## Metro-Solid

Metro-Solid is the Solid-shaped Metro API helper. It knows about Solid resources, containers, headers, discovery, and safe writes.

Metro-Solid does **not** implement authentication, RDF parsing, OLDM objects, JSFS, or app conventions.

It accepts a base URL or configured Metro client. If that Metro client uses `metro-oidc`, requests may authenticate. Metro-Solid adds `metro-oldm` automatically so its helpers can consume parsed linked data.

Metro-Solid follows the current Metro API shape:

- build the root helper with `metro.api(client, methods)`;
- use direct verb methods such as `client.get()`, `client.post()`, `client.put()`, and `client.delete()`;
- reuse Metro's `thrower()` middleware instead of a Metro-Solid-specific error class;
- keep HTTP response handling close to Metro's own response/error model.

## JSFS-Solid

JSFS-Solid presents Solid storage as a JSFS filesystem adapter. It is implemented on top of Metro-Solid.

JSFS-Solid owns file-system-shaped operations such as:

- `read`
- `write`
- `list`
- `mkdir`
- `rmdir`
- `remove`

It may compose Metro-OIDC and Metro-OLDM when constructing a default adapter client, but those concerns remain separate libraries. It does not export an application-level `solidClient`; application setup belongs in SimplySolid.

## Not included here

The following remain outside this repository unless there is a later reason to move them:

- generic `metro`
- generic `jsfs`
- `oldm`
- `oldm-shape`
- SimplyFlow
- SimplySolid

SimplySolid should use these packages, but should live at the application-convention layer.
