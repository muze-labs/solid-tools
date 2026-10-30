import { copyGraph, parseGraph } from '../src/graphs.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import oldm from '@muze-nl/oldm'
import { collection, local, resource, solid, workspace } from '../src/index.mjs'

const id = 'https://example.test/note'
const leftUrl = 'https://pod.example/left.ttl'
const rightUrl = 'https://pod.example/right.ttl'
const text = 'https://schema.org/text'

function sources() {
  return [
    local.memory('left', {
      url: leftUrl,
      turtle: `<${id}> <${text}> "local" .`
    }),
    local.memory('right', {
      url: rightUrl,
      turtle: `<${id}> <https://schema.org/comment> "other source" .`
    })
  ]
}

test('one supplied context owns loaded graphs, collection values and fact provenance', async () => {
  const context = oldm.context()
  const ws = workspace({
    context,
    sources: sources(),
    collections: { notes: collection({ sources: ['left'] }) }
  })
  await ws.open()
  const note = ws.collections.notes.get(id)
  assert.equal(ws.context, context)
  assert.equal(note, context.graph(leftUrl).get(id))
  assert.equal(note.graph.context, context)
  assert.equal(ws.graph('left'), note.graph)
  assert.equal(context.graphs.length, 2)
  assert.equal(String(context.get(id).schema$comment), 'other source')
  assert.equal(note.schema$comment, undefined)
  assert.deepEqual(ws.sourcesOf(context.get(id), 'schema$comment')
    .map(source => [source.source.id, source.sourceUrl]), [['right', rightUrl]])
  assert.deepEqual(ws.sourcesOf(note, text, 'missing'), [])
  context.set(id, text, 'edited', { graph: leftUrl })
  assert.equal(String(note.schema$text), 'edited')
  assert.equal(String(ws.graph('left').subjects[id].schema$text), 'edited')
})

test('an admitted native graph snapshot is detached from the working graph', async () => {
  const source = sources()[0]
  const ws = workspace({ sources: [source] })
  await ws.open()
  const live = ws.graph('left').get(id)
  live.schema$comment = oldm.literal('bonjour', { language: 'fr' })
  const snapshot = copyGraph(ws.graph('left'))
  live.schema$comment.language = 'nl'
  assert.equal(snapshot.get(id).schema$comment.language, 'fr')
  assert.notEqual(snapshot.get(id).schema$comment, live.schema$comment)
  snapshot.subjects[id].schema$text = 'snapshot only'
  assert.equal(String(ws.graph('left').get(id).schema$text), 'local')
  ws.graph('left').set(id, text, 'live only')
  assert.equal(String(snapshot.subjects[id].schema$text), 'snapshot only')
})

test('loading does not take ownership of a transport context or its nodes', async () => {
  const transport = oldm.context()
  const incoming = transport.parse(`<${id}> <${text}> "input" .`, leftUrl, 'text/turtle')
  const ws = workspace({
    solid: { get: async () => incoming },
    sources: [solid.resource(leftUrl)]
  })
  await ws.load()
  const node = ws.graph(leftUrl).get(id)
  assert.notEqual(node, incoming.get(id))
  assert.equal(node.graph.context, ws.context)
  node.schema$text = 'working edit'
  assert.equal(String(incoming.get(id).schema$text), 'input')
})

test('source prefix conflicts retain IRI identity in context and snapshots', async () => {
  const ws = workspace({ sources: [
    local.memory('left', { turtle: `@prefix ex: <https://left.example/> . <${id}> ex:name "left" .` }),
    local.memory('right', { turtle: `@prefix ex: <https://right.example/> . <${id}> ex:name "right" .` })
  ] })
  await ws.open()
  for (const node of [ws.context.get(id), ws.context.get(id)]) {
    assert.equal(String(node[node.graph.propertyName('https://left.example/name')]), 'left')
    assert.equal(String(node[node.graph.propertyName('https://right.example/name')]), 'right')
  }
})

test('saving a direct Solid subject writes its whole source graph', async () => {
  let saved
  const ws = workspace({
    sources: [solid.resource(leftUrl)],
    solid: {
      get: async () => `<${id}> <${text}> "before" .
        <urn:unrelated> <https://schema.org/comment> [ <${text}> "retain" ] .`,
      put: async (url, { body }) => {
        assert.equal(url, leftUrl)
        saved = body
        return { ok: true }
      }
    }
  })
  await ws.load()
  const note = ws.graph(leftUrl).get(id)
  note.schema$text = 'after'
  assert.equal((await ws.save(note)).ok, true)
  const parsed = oldm.context().parse(saved, leftUrl, 'text/turtle')
  assert.equal(String(parsed.get(id).schema$text), 'after')
  assert.equal(String(parsed.get('urn:unrelated').schema$comment.schema$text), 'retain')
})

test('failed reload leaves the existing working graph installed', async () => {
  let fail = false
  const ws = workspace({
    sources: [solid.resource(leftUrl)],
    solid: { get: async () => {
      if (fail) {
        throw new Error('offline')
      }
      return `<${id}> <${text}> "before" .`
    } }
  })
  await ws.load()
  const graph = ws.graph(leftUrl)
  fail = true
  await assert.rejects(ws.load(), /offline/)
  assert.equal(ws.graph(leftUrl), graph)
  assert.equal(String(graph.get(id).schema$text), 'before')
})

test('replica snapshots are published only after success and share one context', async () => {
  const [left, right] = sources()
  const ws = workspace({ resources: [resource('notes', { local: left, remote: right })] })
  await ws.open({ throwOnError: true })
  assert.equal(ws.graph('notes'), ws.context.graph(leftUrl))
  assert.equal((await ws.sync('notes')).ok, true)
  assert.equal(ws.graph('notes').context, ws.context)
  assert.equal(ws.context.graph(rightUrl).context, ws.context)
  assert.equal(ws.context.graphs.length, 2)
  assert.equal(String(ws.graph('notes').get(id).schema$comment), 'other source')
})

test('collection views and saves observe native graph additions', async () => {
  const source = sources()[0]
  const ws = workspace({
    sources: [source],
    collections: { notes: collection({ sources: ['left'] }) }
  })
  await ws.open()
  const graph = ws.graph('left')
  graph.set('urn:new:subject', text, 'new fact')
  const added = ws.collections.notes.get('urn:new:subject')
  assert.equal(added, graph.get('urn:new:subject'))
  assert.equal((await ws.save(added)).ok, true)
  assert.equal(String(parseGraph(await source.load(), source).subjects[added.id].schema$text), 'new fact')
})

test('refresh invalidates old source nodes rather than accepting detached edits', async () => {
  const ws = workspace({ sources: [sources()[0]] })
  await ws.open()
  const before = ws.graph('left').get(id)
  await ws.open()
  assert.notEqual(ws.graph('left').get(id), before)
  await assert.rejects(ws.save(before), /not tracked/)
})

test('saving queued direct resource edits writes the admitted snapshots in order', async () => {
  const writes = []
  let release
  let started
  const held = new Promise(resolve => { release = resolve })
  const writing = new Promise(resolve => { started = resolve })
  const ws = workspace({
    sources: [solid.resource(leftUrl)],
    solid: {
      get: async () => `<${id}> <${text}> "before" .`,
      put: async (url, { body }) => {
        writes.push(body)
        if (writes.length === 1) {
          started()
          await held
        }
        return { ok: true }
      }
    }
  })
  await ws.open()
  const note = ws.graph(leftUrl).get(id)
  note.schema$text = 'first'
  const first = ws.save(note)
  await writing
  note.schema$text = 'second'
  const second = ws.save(note)
  release()
  assert.equal((await first).ok, true)
  assert.equal((await second).ok, true)
  const values = writes.map(turtle => {
    const graph = oldm.context().parse(turtle, leftUrl, 'text/turtle')
    return String(graph.get(id).schema$text)
  })
  assert.deepEqual(values, ['first', 'second'])
})

test('updating a linked subject changes the source graph without detaching it', async () => {
  const bodyId = 'urn:body:one'
  const source = local.memory('notes', { turtle: `
    <${id}> <https://schema.org/comment> <${bodyId}> .
    <${bodyId}> <${text}> "original";
      <https://schema.org/description> "unknown fact" .
  ` })
  const ws = workspace({
    sources: [source],
    collections: { notes: collection({ sources: ['notes'] }) }
  })
  await ws.open()
  const note = ws.collections.notes.get(id)
  ws.collections.notes.update(note, {
    schema$comment: { id: bodyId, schema$text: 'edited' }
  })
  assert.equal(note.schema$comment, ws.graph('notes').get(bodyId))
  assert.equal(String(note.schema$comment.schema$text), 'edited')
  assert.equal(String(note.schema$comment.schema$description), 'unknown fact')
  assert.equal((await ws.save(note)).ok, true)
  const loaded = parseGraph(await source.load(), source)
  assert.equal(String(loaded.subjects[bodyId].schema$text), 'edited')
})


test('container creation keeps returned nodes usable at the assigned resource URL', async () => {
  const container = 'https://pod.example/notes/'
  const writes = []
  const ws = workspace({
    sources: [solid.container(container, { id: 'notes' })],
    collections: { notes: collection({ sources: ['notes'] }) },
    solid: {
      postToContainer: async (url, body) => {
        assert.equal(url, container)
        writes.push(body)
        return { ok: true, location: leftUrl }
      },
      put: async (url, { body }) => {
        assert.equal(url, leftUrl)
        writes.push(body)
        return { ok: true }
      }
    }
  })
  const note = await ws.createIn('notes', {
    id, schema$comment: { id: 'urn:body:one', schema$text: 'first' }
  })
  assert.equal(note, ws.collections.notes.get(id))
  assert.equal(note.graph, ws.context.graph(leftUrl))
  assert.equal(ws.sourceOf(note).sourceUrl, leftUrl)
  ws.collections.notes.update(note, {
    schema$comment: { id: 'urn:body:one', schema$text: 'second' }
  })
  assert.equal((await ws.save(note)).ok, true)
  assert.equal((await ws.save(note.schema$comment)).ok, true)
  const saved = oldm.context().parse(writes[1], leftUrl, 'text/turtle')
  assert.equal(String(saved.get(id).schema$comment.schema$text), 'second')
})

test('replacing an empty source descriptor updates ownership of later graph additions', async () => {
  const ws = workspace({ sources: [local.memory('notes')] })
  await ws.open()
  const replacement = local.memory('notes', { readOnly: true })
  ws.addSource(replacement)
  ws.graph('notes').set(id, text, 'added')
  const note = ws.graph('notes').get(id)
  assert.equal(ws.sourceOf(note).source, replacement)
  assert.equal((await ws.save(note)).status, 'read_only')
})

test('creation imports foreign prefix meanings without taking ownership of its nodes', async () => {
  const incoming = oldm.context().parse(
    `@prefix ex: <https://custom.example/> . <${id}> ex:name "created" .`,
    rightUrl, 'text/turtle'
  )
  const ws = workspace({ sources: [local.memory('notes')] })
  await ws.open()
  const created = await ws.createIn('notes', incoming.get(id))
  assert.notEqual(created, incoming.get(id))
  const property = created.graph.propertyName('https://custom.example/name')
  assert.equal(String(created[property]), 'created')
})


test('replica publication preserves configured source prefixes for linked subjects', async () => {
  const ns = 'https://custom.example/vocab#'
  const ws = workspace({ resources: [resource('notes', {
    local: local.memory('local', { prefixes: { custom: ns } }),
    remote: local.memory('remote', {
      turtle: `<urn:note> <${ns}body> <urn:body> .
        <urn:body> <${ns}text> "retained" .`
    })
  })] })
  await ws.open({ throwOnError: true })
  assert.equal(String(ws.graph('notes').get('urn:note').custom$body.custom$text), 'retained')
  await ws.sync('notes')
  const note = ws.graph('notes').get('urn:note')
  assert.equal(note.custom$body, ws.graph('notes').get('urn:body'))
  assert.equal(String(note.custom$body.custom$text), 'retained')
})

test('application objects are not silently encoded as JSON literals', async () => {
  const ws = workspace({ sources: [local.memory('notes')] })
  await ws.open()
  await assert.rejects(ws.createIn('notes', {
    id, schema$text: { text: 'not an RDF value' }
  }), /encode application literals explicitly/)
  await assert.rejects(ws.sources[0].save({ subjects: {} }), /Turtle text/)
})
