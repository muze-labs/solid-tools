# Package boundaries

## Lading

Lading is the Solid-shaped Metro layer. It knows about Solid resources, containers, headers, discovery, and safe writes.

Lading does **not** implement authentication, RDF parsing, OLDM objects, JSFS, or app conventions.

It assumes the caller passes a configured Metro client. If that Metro client uses `metro-oidc`, requests may authenticate. If it uses `metro-oldm`, responses may expose parsed OLDM data. Lading can consume that parsed data, but does not parse linked data itself.

Lading follows the current Metro API shape:

- use direct verb methods such as `client.get()`, `client.post()`, `client.put()`, and `client.delete()`;
- reuse Metro's `thrower()` middleware instead of a Lading-specific error class;
- keep HTTP response handling close to Metro's own response/error model.

## JSFS-Solid

JSFS-Solid presents Solid storage as a JSFS filesystem adapter. It is implemented on top of Lading.

JSFS-Solid owns file-system-shaped operations such as:

- `read`
- `write`
- `list`
- `mkdir`
- `rmdir`
- `remove`

It may compose Metro-OIDC and Metro-OLDM, but those concerns remain separate libraries.

## Not included here

The following remain outside this repository unless there is a later reason to move them:

- generic `metro`
- generic `jsfs`
- `oldm`
- `oldm-shape`
- SimplyFlow
- SimplySolid

SimplySolid should use these packages, but should live at the application-convention layer.
