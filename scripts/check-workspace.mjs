import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

const entries = [
  'packages/lading',
  'packages/jsfs-solid',
  'packages/oldm-shape',
  'packages/solid-workspace',
  'packages/simplysolid',
  'packages/simplysolid-templates',
  'examples/contacts',
  'examples/tasks'
]

const requiredFiles = [
  'package.json',
  'README.md',
  'src/index.mjs'
]

for (const entry of entries) {
  for (const file of requiredFiles) {
    await access(join(entry, file), constants.R_OK)
  }

  const packageJson = JSON.parse(await readFile(join(entry, 'package.json'), 'utf8'))

  if (packageJson.type !== 'module') {
    throw new Error(`${entry}: package.json must set type to module`)
  }

  if (!packageJson.exports?.['.']) {
    throw new Error(`${entry}: package.json must export its main entry point`)
  }
}

console.log(`Checked ${entries.length} workspace entries.`)
