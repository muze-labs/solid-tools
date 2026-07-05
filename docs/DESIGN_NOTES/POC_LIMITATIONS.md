Applications must opt in.

Components use templates/styles, commands/actions/api/etc.

Component modules export one default component-shaped object.

components is the component dependency/source graph.

imports is for normal non-component JavaScript imports.

Actual code uses lexical references, not app.components.

app.components is a residential/tooling source handle.

Stored overlays are hydrated before merging.

Core merge code only receives real component objects.

Normal components load first.

App-level options override normal components.

Hydrated overlays/mods load last and may override app-level options.

Remote mods and local edits are composed into one overlay per component.

No visible overlay stacks in the POC.

Duplicate component names are allowed with warnings, unless a specific operation becomes ambiguous.

The app must explicitly enable residential/mod loading before anything is read from local storage.