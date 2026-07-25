# SimplyCode / SimplySolid design notes

This bundle contains the current design documents for the SimplyCode, SimplySolid, reusable semantic templates, and residential programming discussions.

Documents:

- `SIMPLYCODE_DESIGN.md` — recipe-driven IDE for vertical-slice development.
- `SIMPLYSOLID_DESIGN.md` — SimplyFlow extension for Solid-backed applications.
- `LOCAL_FIRST_WORKSPACE.md` — original PWA/offline-first workspace source design; partially superseded by the Turtle-backed local resource decision.
- `TURTLE_BACKED_LOCAL_FIRST_WORKSPACE.md` — refinement that makes Turtle the serialized format for local and remote resources, keeps OLDM objects as runtime views, and treats IndexedDB as a local Turtle-resource transport.
- `MINIMAL_SINGLE_USER_SYNC.md` — near-term local/remote merge policy using stable IDs, modified timestamps, tombstones, and narrow last-writer-wins semantics before adopting CRDT-like sync.
- `SOLID_TOOLS_REFACTOR_GUIDE.md` — working refactor guide that starts by moving Metro-Solid semantics into a Metro-style `solidApi` helper, then flattens Solid Workspace, SimplySolid, and local-first responsibilities.
- `SIMPLYSOLID_REUSABLE_TEMPLATES.md` — reusable templates/components with linked-data semantics.
- `RESIDENTIAL_PROGRAMMING_DESIGN.md` — optional in-app live editing of SimplyFlow applications through component overlays.
- `SIMPLYFLOW_COMPONENT_LOADING_AND_OVERLAYS.md` — component dependency loading, app/overlay merge order, and mod composition rules for the residential programming proof of concept.

Current status: design draft, updated after the residential programming discussion.
