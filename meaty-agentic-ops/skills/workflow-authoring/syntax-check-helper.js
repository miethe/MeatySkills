#!/usr/bin/env node
/**
 * syntax-check-helper.js
 *
 * Wraps a SkillMeat workflow script for `node --check` compatibility.
 *
 * Problem: workflow scripts use top-level `return` and top-level `await`, which are
 * valid in the Claude Code Workflow runtime but cause `node --check` to fail with
 * "SyntaxError: Illegal return statement" or "SyntaxError: await is only valid in
 * async functions". This helper wraps the post-meta body in an async IIFE so
 * `node --check` can parse the full script without false failures.
 *
 * Usage:
 *   node .claude/skills/workflow-authoring/syntax-check-helper.js .claude/workflows/<name>.js
 *
 * Exit code: 0 = syntax OK, 1 = syntax error (node --check output printed to stderr)
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

const [, , scriptPath] = process.argv
if (!scriptPath) {
  console.error('Usage: node syntax-check-helper.js <workflow-script.js>')
  process.exit(1)
}

let source
try {
  source = readFileSync(scriptPath, 'utf8')
} catch (e) {
  console.error(`Could not read ${scriptPath}: ${e.message}`)
  process.exit(1)
}

// Step 1: Replace "export const meta = {" with "const meta = {" so the file
//         doesn't require module context for the export keyword.
// Step 2: Find the end of the meta block (the closing "}") and wrap everything
//         after it in an async IIFE: (async () => { <body> })();
//
// This is a heuristic — it works for the standard workflow skeleton where
// "export const meta = { ... }" is a top-level block followed by the script body.

// Detect where meta block ends by tracking brace depth after "export const meta"
let transformed = source.replace(/^export\s+const\s+meta\s*=/m, 'const meta =')

const metaStart = transformed.search(/^const\s+meta\s*=/m)
if (metaStart === -1) {
  console.error('Could not locate "const meta" block. Is this a valid workflow script?')
  process.exit(1)
}

// Walk forward from metaStart to find the closing brace of the meta object.
let depth = 0
let metaEnd = -1
for (let i = metaStart; i < transformed.length; i++) {
  if (transformed[i] === '{') depth++
  else if (transformed[i] === '}') {
    depth--
    if (depth === 0) {
      metaEnd = i
      break
    }
  }
}

if (metaEnd === -1) {
  console.error('Could not find closing brace of meta block.')
  process.exit(1)
}

const metaPart = transformed.slice(0, metaEnd + 1)
const bodyPart = transformed.slice(metaEnd + 1).trimStart()

const wrapped = `${metaPart}\n\n;(async () => {\n${bodyPart}\n})();\n`

// Write to a temp file and run node --check
const tmpFile = join(tmpdir(), `wf-check-${Date.now()}.js`)
writeFileSync(tmpFile, wrapped, 'utf8')

let exitCode = 0
try {
  execSync(`node --check "${tmpFile}"`, { stdio: 'inherit' })
  console.log(`Syntax OK: ${scriptPath}`)
} catch {
  // node --check already printed the error to stderr
  exitCode = 1
} finally {
  try { unlinkSync(tmpFile) } catch { /* ignore */ }
}

process.exit(exitCode)
