import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, it } from 'node:test'

/**
 * Checks on the repository itself rather than on its behaviour.
 *
 * Two kinds of rot that no unit test would ever catch: a stray Spanish string
 * surviving in an English repository, and `.env.example` drifting out of step
 * with the variables the service actually reads.
 */

const ROOT = new URL('..', import.meta.url).pathname

// .github is scanned too: a workflow comment is as public as a source comment.
const IGNORED_DIRS = new Set(['node_modules', '.git', '.idea', '.vscode', 'coverage'])

const SCANNED_EXTENSIONS = new Set(['.ts', '.md', '.yaml', '.yml', '.json', '.example', ''])

/**
 * This file is excluded from the language scan because the list of Spanish
 * words below is, necessarily, a list of Spanish words.
 */
const LANGUAGE_SCAN_EXCLUDED = new Set(['tests/repository.test.ts', 'package-lock.json', 'LICENSE'])

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      walk(join(directory, entry.name), found)
      continue
    }
    found.push(join(directory, entry.name))
  }
  return found
}

const FILES = walk(ROOT)
  .map((path) => relative(ROOT, path))
  .filter((path) => SCANNED_EXTENSIONS.has(extname(path)))
  .sort()

describe('repository: the codebase stays in English', () => {
  /**
   * Accented characters that do not occur in English. The ellipsis used when
   * truncating a reply is U+2026 and is deliberately not in this set.
   */
  const ACCENTED = /[áéíóúÁÉÍÓÚñÑ¿¡üÜ]/

  /**
   * Words that are unambiguously Spanish and are not English words in their own
   * right. Matched on word boundaries, so `config` does not trip `con` and
   * `parameter` does not trip `para`. `error`, `no` and `sin` are absent
   * because they are English too.
   */
  const SPANISH_WORDS = [
    'que',
    'para',
    'con',
    'los',
    'las',
    'del',
    'una',
    'por',
    'como',
    'este',
    'esta',
    'pero',
    'sobre',
    'cuando',
    'porque',
    'hacer',
    'tiene',
    'puede',
    'debe',
    'entre',
    'desde',
    'hasta',
    'cada',
    'otro',
    'mismo',
    'donde',
    'aunque',
    'mientras',
    'siempre',
    'nunca',
    'ahora',
    'luego',
    'antes',
    'todos',
    'todas',
    'asistente',
    'mensaje',
    'usuario',
    'archivo',
    'servidor',
    'moda',
    'vestir',
  ]

  const scanned = FILES.filter((path) => !LANGUAGE_SCAN_EXCLUDED.has(path))

  it('scans a meaningful number of files', () => {
    // Guards the guard: a broken walk would silently pass everything.
    assert.ok(scanned.length > 15, `only ${scanned.length} files scanned`)
    assert.ok(scanned.includes('README.md'))
    assert.ok(scanned.includes('src/main.ts'))
  })

  it('contains no accented characters anywhere', () => {
    const offenders: string[] = []

    for (const path of scanned) {
      const lines = readFileSync(join(ROOT, path), 'utf8').split('\n')
      lines.forEach((line, index) => {
        const match = ACCENTED.exec(line)
        if (match !== null) offenders.push(`${path}:${index + 1} ${match[0]} in "${line.trim().slice(0, 70)}"`)
      })
    }

    assert.deepEqual(offenders, [])
  })

  it('contains no Spanish words', () => {
    const pattern = new RegExp(`\\b(${SPANISH_WORDS.join('|')})\\b`, 'i')
    const offenders: string[] = []

    for (const path of scanned) {
      const lines = readFileSync(join(ROOT, path), 'utf8').split('\n')
      lines.forEach((line, index) => {
        const match = pattern.exec(line)
        if (match !== null) offenders.push(`${path}:${index + 1} "${match[0]}" in "${line.trim().slice(0, 70)}"`)
      })
    }

    assert.deepEqual(offenders, [])
  })
})

describe('repository: .env.example matches what the service reads', () => {
  const configSource = readFileSync(join(ROOT, 'src/infrastructure/config.ts'), 'utf8')
  const exampleSource = readFileSync(join(ROOT, '.env.example'), 'utf8')

  const readByConfig = new Set(
    [...configSource.matchAll(/(?:required|optional|integer|decimal)\('([A-Z0-9_]+)'/g)].map(
      (match) => match[1] as string,
    ),
  )

  const listedInExample = new Set(
    [...exampleSource.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1] as string),
  )

  it('found the variables in both places', () => {
    assert.ok(readByConfig.size > 15, `${readByConfig.size} variables read by config`)
    assert.ok(listedInExample.size > 15, `${listedInExample.size} variables listed in the example`)
  })

  it('documents every variable the service reads', () => {
    const undocumented = [...readByConfig].filter((name) => !listedInExample.has(name)).sort()

    assert.deepEqual(undocumented, [], 'add these to .env.example')
  })

  it('lists no variable the service ignores', () => {
    // This is how NGROK_AUTHTOKEN outlived the feature that used it.
    const unused = [...listedInExample].filter((name) => !readByConfig.has(name)).sort()

    assert.deepEqual(unused, [], 'remove these from .env.example, nothing reads them')
  })
})
