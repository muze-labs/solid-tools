# Minimal single-user sync

## Status

Design decision draft.

This note defines the near-term merge policy for local-first Solid Workspace resources. It intentionally does not introduce a general CRDT engine or operation log.

The goal is to support the single-user case where one person can edit a local replica while offline, edit the remote Solid resource from another device, and later reconnect the first device.

## Decision summary

For now, use the smallest sync semantics that preserve local-first usefulness:

- stable subject IDs that are never rewritten during sync;
- Turtle resources as the serialized format for both local and remote replicas;
- additive merge for subjects and facts that exist on only one side;
- explicit tombstones for deleted subjects;
- per-subject `dcterms:modified` timestamps for ordinary updates;
- last-writer-wins for known app-edited scalar fields;
- open-world union for unknown facts and naturally multi-valued fields.

This is not a full CRDT. It is a pragmatic single-user merge policy that keeps the door open for m-ld or another CRDT-like engine later.

## Non-goal: full CRDT semantics

Robust multi-actor concurrent editing eventually needs CRDT-like semantics. m-ld is the obvious system to evaluate before inventing a general RDF CRDT layer.

That is deferred. The current problem is smaller:

1. one user;
2. two or more devices;
3. one local-first working copy;
4. one remote Solid Turtle resource;
5. possible offline divergence;
6. eventual sync.

The implementation should therefore avoid operation logs, vector clocks, replica clocks, custom conflict records, and m-ld integration in this slice.

## Identity rule

A note or linked-data subject gets its ID once. Sync must not rename it.

Good first choices:

```txt
urn:uuid:3b46ac04-cd34-4e2b-a44c-6f56d08c9df3
urn:uuid:3b46ac04-cd34-4e2b-a44c-6f56d08c9df3#body
urn:uuid:3b46ac04-cd34-4e2b-a44c-6f56d08c9df3#target
```

or another app-minted stable ID.

Adding a remote pod resource changes where the graph is persisted, not the names of the subjects in the graph. This avoids entity reconciliation during sync.

## Storage URL versus subject ID

The graph/resource URL and subject IDs are separate concerns.

For example, this is acceptable:

```txt
resource URL: https://pod.example/private/margin-notes/page-abc123.ttl
subject ID:   urn:uuid:3b46ac04-cd34-4e2b-a44c-6f56d08c9df3
```

The page URL should identify the annotation target, not the note itself:

```turtle
<urn:uuid:3b46ac04-cd34-4e2b-a44c-6f56d08c9df3>
    a oa:Annotation ;
    oa:hasTarget <urn:uuid:3b46ac04-cd34-4e2b-a44c-6f56d08c9df3#target> .

<urn:uuid:3b46ac04-cd34-4e2b-a44c-6f56d08c9df3#target>
    oa:hasSource <https://book.example/chapter/1> .
```

Do not use the target page URL as the default namespace for user-created note subjects. The user does not control that namespace, and page fragments may already name page content.

## Required metadata

Every editable top-level subject should carry a modification timestamp:

```turtle
<urn:uuid:note-1>
    a oa:Annotation ;
    dcterms:created "2026-07-25T10:00:00Z"^^xsd:dateTime ;
    dcterms:modified "2026-07-25T10:12:00Z"^^xsd:dateTime .
```

For margin-notes, the annotation subject is the top-level editable subject. Body, target, and selector subjects can either copy the same `dcterms:modified` timestamp or be treated as part of the annotation closure for merge purposes.

## Tombstones

Deletion must be explicit. Absence alone does not mean deletion.

Use a tombstone subject:

```turtle
@prefix sync: <https://vocab.muze.nl/sync#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<#tombstone-note-1>
    a sync:Tombstone ;
    sync:deletedSubject <urn:uuid:note-1> ;
    dcterms:modified "2026-07-25T12:30:00Z"^^xsd:dateTime .
```

A tombstone says: this subject was deliberately deleted at this time.

The app should hide a subject when the newest relevant tombstone is newer than the subject's `dcterms:modified`.

For margin-notes, deleting an annotation should tombstone the annotation subject and its owned body/target/selector closure, or tombstone the annotation and let the workspace treat the owned closure as deleted with it.

## Merge policy

Given a local graph and a remote graph for the same logical resource:

1. Load both Turtle resources into one OLDM context.
2. Group facts by subject ID.
3. Copy subjects that exist on only one side.
4. Apply tombstones before showing or saving subjects.
5. For subjects present on both sides, compare `dcterms:modified`.
6. For known app-edited scalar fields, keep the value from the newer subject.
7. For unknown predicates and naturally multi-valued fields, union values.
8. Write the merged graph back to the local replica.
9. If remote is reachable and writable, write the merged graph to the remote replica.

For margin-notes, known scalar fields may include:

- `rdf:value` on textual bodies;
- `schema:text` on textual bodies;
- `cobalt:fragment` on Cobalt bodies;
- selector values that the app replaces as one unit.

Naturally multi-valued or open-world fields include:

- `rdf:type`;
- unfamiliar predicates;
- additional linked-data facts loaded from another app.

## Conflict behavior

Last-writer-wins can lose one concurrent edit. This is accepted for the first single-user implementation.

The important mitigation is that the policy is narrow:

- only known app-edited scalar fields use last-writer-wins;
- unknown facts are preserved by union;
- deleted subjects require tombstones;
- stable IDs make future migration to operation logs or CRDTs possible.

If two devices edit the same scalar field offline with close timestamps, the newer timestamp wins. The first implementation does not need a conflict UI.

## Where this belongs

`solid-workspace` should own this policy because it is replica sync behavior.

`oldm` should provide graph/context operations that make the implementation smaller, such as context inclusion, graph materialization, source lookup, and possibly semantic graph equality. OLDM should not decide local/remote merge policy.

Margin-notes should only ensure that note subjects have stable IDs and updated timestamps when edited.

## Migration path

1. Keep existing stable `urn:uuid:` note IDs.
2. Ensure every annotation edit updates `dcterms:modified`.
3. Add tombstone creation for deletes.
4. Teach workspace sync to preserve tombstones.
5. Implement subject-level merge with last-writer-wins for known scalar fields and union for unknown facts.
6. Keep the current additive merge as the fallback for sources without timestamps.
7. Revisit m-ld or another CRDT-like engine when multi-user/live collaboration becomes a real requirement.
