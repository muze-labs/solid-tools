import { emptyGraph, writeSubjectToGraph } from '../src/graphs.mjs'

export function graphFixture(subjects, options = {}) {
  const graph = emptyGraph(options)
  const copied = new WeakMap()
  for (const subject of subjects) {
    writeSubjectToGraph({ graph, subject, copied })
  }
  return graph
}
