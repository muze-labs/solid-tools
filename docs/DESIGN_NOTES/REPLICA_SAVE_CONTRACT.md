# Replica save contract — 2026-10-30

This implements the editable-resource portion of `MINIMAL_SINGLE_USER_SYNC.md`.
The application pressure and limits are recorded in margin-notes proposal 0003.

```js
resource('notes', {
  local: local.indexedDB('reader', { key: 'notes' }),
  remote: solid.resource('https://pod.example/private/notes.ttl'),
  scalarPredicates: ['https://schema.org/text']
})
```

SimplySolid accepts the same `scalarPredicates` on its local-first data descriptor.
Only the application names editable scalar predicates. Subjects carrying valid
`dcterms:modified` timestamps use the newest scalar values, including removal of
a scalar absent from the newest subject. Equal timestamps use a deterministic
lexical comparison of the declared scalar values. Subjects without timestamps
retain additive behavior. Other facts remain additive.

Logical-resource deletion adds `lm:deleted` directly to the original subject,
using `https://purl.org/pdsinterop/link-metadata#deleted`, a reason string, and
an updated `dcterms:modified`. The subject and its facts remain in persistence;
normal collection views hide subjects carrying the predicate, regardless of its
value. No separate tombstone subject or identifier is created.

This uses the existing [PDS Interop deletion semantics](https://pdsinterop.org/solid-link-metadata/#deleted).
The ontology does not prescribe a value datatype or our replica ordering policy;
the reason string follows its [storage example](https://pdsinterop.org/solid-link-metadata/solid-storage-specification/#lm-deleted).
These are entity markers inside the data graph, not `.meta` instructions to delete
the containing HTTP resource.

Replica merge treats `lm:deleted` as built-in scalar state. The newest timestamped
version supplies its presence or absence; deletion wins equal timestamps before
the deterministic scalar tie-break. Timestamped versions take precedence over
undated versions; entirely undated subjects retain additive behavior. Writers
must timestamp deletions and restorations for ordered replication. To restore,
remove the predicate and advance `dcterms:modified`, then save and sync. A missing
subject alone is never a deletion or restoration. Retained domain facts are
available for undo but ignored in normal collection views while deleted.

Deletion does not infer ownership of linked subjects or garbage-collect them.
The source-to-source import API remains additive. Timestamp and conflict rules
are workspace conventions, not requirements of the ontology or Solid protocol.

`open(resource)`, saves, and `sync(resource)` sequence I/O within one workspace
resource. A save snapshots its data when admitted and increments a revision.
Opening or syncing cannot publish an older working snapshot after a newer save
was admitted. `sync-pending` means the caller must sync again; it is not proof
that the remote has the latest edit. Queues recover after rejection.

Sync merges, commits locally, then writes remotely. A failed local commit stops
before the remote write. A failed remote write retains the committed local data
and pending state. IndexedDB success means transaction completion, not request
success. Adapters returning `ok: false` fail just as rejected adapters do.
SimplySolid create/update/delete reject failed persistence; listing cannot clear
that error. Local-open failures reject; remote failures retain pending state.

Graph copying and Turtle conversion preserve named references, shared/cyclic
blank nodes, ordered RDF collections, literal metadata, RDF classes, and source
prefix declarations. The default remote save serializes Turtle before calling
Metro. The composition test exercises actual Metro/Metro-OLDM/OLDM middleware.

Evidence lives in `solid-workspace/test/{indexeddb,persistence,replicas}.test.mjs`
and `simplysolid/test/failures.test.mjs`. Margin-notes' mounted browser test
exercises connected edit/delete/reconnect and a failed write followed by a local
remount. It uses a fake Pod storing real Turtle.

Limits: ordering is within one workspace instance, not across browser tabs;
remote writes are not yet guarded by ETags; no CRDT or blank-node identity
reconciliation across independently authored graphs is claimed. Real-Pod login,
permissions, conditional writes, and cross-device concurrency remain unvalidated.
The larger move from graph-document compatibility to one OLDM context remains
separate work in the refactor guide.
