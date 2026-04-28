#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PACK_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

function exists(p) { return fs.existsSync(p); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeFileSafe(target, content, apply) {
  if (exists(target)) return { path: target, action: 'exists', changed: false };
  if (apply) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { path: target, action: apply ? 'created' : 'would-create', changed: true };
}
function copyTemplate(rel, target, apply) {
  const src = path.join(PACK_ROOT, 'templates', rel);
  return writeFileSafe(target, fs.readFileSync(src, 'utf8'), apply);
}
function detectPackageManager(project) {
  if (exists(path.join(project, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(project, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(project, 'bun.lockb'))) return 'bun';
  if (exists(path.join(project, 'package-lock.json'))) return 'npm';
  if (exists(path.join(project, 'package.json'))) return 'npm';
  return 'unknown';
}
function detectFramework(project) {
  const pkgPath = path.join(project, 'package.json');
  if (!exists(pkgPath)) return 'unknown';
  const pkg = readJson(pkgPath);
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.next) return 'nextjs';
  if (deps.vite) return 'vite';
  if (deps.react) return 'react';
  if (deps.vue) return 'vue';
  if (deps.svelte) return 'svelte';
  return 'node-web-or-unknown';
}
function maybeUpdatePackageScripts(project, apply) {
  const pkgPath = path.join(project, 'package.json');
  const changes = [];
  if (!exists(pkgPath)) return [{ path: pkgPath, action: 'missing-package-json', changed: false }];
  const pkg = readJson(pkgPath);
  pkg.scripts = pkg.scripts || {};
  const proposed = {
    'demo:doctor': 'node demo/tools/demo-foundry.mjs doctor',
    'demo:capture': 'playwright test demo/demos/**/*.spec.ts',
    'demo:review': 'node demo/tools/demo-foundry.mjs review'
  };
  for (const [k,v] of Object.entries(proposed)) {
    if (!pkg.scripts[k]) {
      changes.push({ script: k, action: apply ? 'added' : 'would-add', value: v });
      if (apply) pkg.scripts[k] = v;
    } else {
      changes.push({ script: k, action: 'exists', value: pkg.scripts[k] });
    }
  }
  if (apply && changes.some(c => c.action === 'added')) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
  return [{ path: pkgPath, action: apply ? 'checked/updated scripts' : 'would-check/update scripts', changed: changes.some(c => c.action === 'would-add' || c.action === 'added'), details: changes }];
}
function init(project, apply) {
  const actions = [];
  const demoRoot = path.join(project, 'demo');
  const toolsDir = path.join(demoRoot, 'tools');
  actions.push(copyTemplate('demo-readme.md', path.join(demoRoot, 'README.md'), apply));
  actions.push(copyTemplate('demo-foundry.config.yaml', path.join(demoRoot, 'demo-foundry.config.yaml'), apply));
  actions.push(copyTemplate('.demoignore', path.join(demoRoot, '.demoignore'), apply));
  actions.push(copyTemplate('project-context-update.md', path.join(demoRoot, 'context-updates', 'proposed-project-context-update.md'), apply));
  actions.push(copyTemplate('workflow-update-plan.md', path.join(demoRoot, 'workflow-updates', 'proposed-workflow-update.md'), apply));
  actions.push(copyTemplate('playwright.config.ts', path.join(demoRoot, 'playwright.config.ts'), apply));
  actions.push(writeFileSafe(path.join(toolsDir, 'demo-foundry.mjs'), fs.readFileSync(path.join(PACK_ROOT, 'bin', 'demo-foundry.mjs'), 'utf8'), apply));
  for (const f of ['no-secrets.md','freshness.md','readiness.md','executive-demo.md','technical-demo.md','accessibility.md']) {
    actions.push(writeFileSafe(path.join(demoRoot, 'policy', f), fs.readFileSync(path.join(PACK_ROOT, 'checklists', f), 'utf8'), apply));
  }
  actions.push(...maybeUpdatePackageScripts(project, apply));
  return actions;
}
function createDemo(project, id, title, apply) {
  if (!id) throw new Error('Missing --id');
  title = title || id;
  const demoDir = path.join(project, 'demo', 'demos', id);
  const actions = [];
  const demoYaml = fs.readFileSync(path.join(PACK_ROOT, 'templates', 'demo.yaml'), 'utf8')
    .replace('id: example-demo', `id: ${id}`)
    .replace('title: "Example Application Demo"', `title: "${title.replaceAll('"','\\"')}"`);
  actions.push(writeFileSafe(path.join(demoDir, 'demo.yaml'), demoYaml, apply));
  actions.push(copyTemplate('storyboard.md', path.join(demoDir, 'storyboard.md'), apply));
  actions.push(copyTemplate('talking-points.md', path.join(demoDir, 'talking-points.md'), apply));
  actions.push(copyTemplate('voiceover-script.md', path.join(demoDir, 'voiceover-script.md'), apply));
  actions.push(copyTemplate('playwright-flow.spec.ts', path.join(demoDir, 'capture.spec.ts'), apply));
  const dirs = ['output/screenshots','output/video_raw','output/video_final','output/captions','output/thumbnails'];
  for (const d of dirs) {
    const p = path.join(demoDir, d, '.gitkeep');
    actions.push(writeFileSafe(p, '', apply));
  }
  return actions;
}
function doctor(project) {
  const pkgManager = detectPackageManager(project);
  const framework = detectFramework(project);
  const hasDemo = exists(path.join(project, 'demo'));
  const hasPackage = exists(path.join(project, 'package.json'));
  const hasPlaywright = exists(path.join(project, 'playwright.config.ts')) || exists(path.join(project, 'playwright.config.js')) || exists(path.join(project, 'demo', 'playwright.config.ts'));
  return { project, framework, packageManager: pkgManager, hasPackageJson: hasPackage, hasDemoWorkspace: hasDemo, hasPlaywrightConfig: hasPlaywright };
}
function review(project) {
  const demoDir = path.join(project, 'demo', 'demos');
  const issues = [];
  if (!exists(path.join(project, 'demo'))) issues.push('Missing demo workspace. Run init first.');
  if (!exists(demoDir)) issues.push('Missing demo/demos directory.');
  const demos = exists(demoDir) ? fs.readdirSync(demoDir).filter(x => fs.statSync(path.join(demoDir,x)).isDirectory()) : [];
  for (const d of demos) {
    const base = path.join(demoDir, d);
    for (const f of ['demo.yaml','storyboard.md','talking-points.md','capture.spec.ts']) {
      if (!exists(path.join(base, f))) issues.push(`${d}: missing ${f}`);
    }
  }
  return { verdict: issues.length ? 'warnings' : 'pass', demos, issues };
}
function printResult(title, data) {
  console.log(`\n# ${title}\n`);
  console.log(JSON.stringify(data, null, 2));
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || 'help';
const project = path.resolve(args.project || process.cwd());
const apply = Boolean(args.apply);

try {
  if (cmd === 'init') {
    printResult(apply ? 'Demo Foundry Init Applied' : 'Demo Foundry Init Dry Run', { detected: doctor(project), actions: init(project, apply), note: apply ? 'Files were written where marked created/updated.' : 'No files were modified. Re-run with --apply to write changes.' });
  } else if (cmd === 'create') {
    printResult(apply ? 'Demo Created' : 'Demo Create Dry Run', { actions: createDemo(project, args.id, args.title, apply), note: apply ? 'Demo files were created where missing.' : 'No files were modified. Re-run with --apply to write changes.' });
  } else if (cmd === 'doctor') {
    printResult('Demo Foundry Doctor', doctor(project));
  } else if (cmd === 'review') {
    printResult('Demo Foundry Review', review(project));
  } else {
    console.log(`Demo Foundry CLI

Commands:
  init --project <path> [--apply]
  create --project <path> --id <demo-id> --title <title> [--apply]
  doctor --project <path>
  review --project <path>

Default behavior is dry-run. Use --apply to write files.`);
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
