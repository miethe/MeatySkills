#!/usr/bin/env node
/**
 * analyze-project.js - Project analyzer that pre-populates features.json
 *
 * Inspects a project using static file reads (no subprocess execution) to
 * discover features from package.json scripts, CLI entry points, OpenAPI specs,
 * Next.js/React routes, Python CLI definitions, README headings, and CLAUDE.md.
 * All discovered features receive status "draft" to indicate they need human review.
 *
 * Usage: node analyze-project.js [options]
 *
 * Options:
 *   --root <path>       Project root to analyze (default: cwd)
 *   --output <path>     Output path relative to root (default: .github/readme/data/features.json)
 *   --dry-run           Print JSON to stdout instead of writing
 *   --help              Print usage
 *
 * Exit codes:
 *   0 - Analysis complete
 *   1 - Fatal error (unreadable root, write failure)
 *
 * @example
 *   node analyze-project.js                              # Analyze cwd
 *   node analyze-project.js --root /my/project           # Explicit root
 *   node analyze-project.js --dry-run                    # Preview without writing
 *   node analyze-project.js --output custom/features.json
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, dirname, relative, sep, posix } from 'node:path';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Parse command line arguments.
 * @returns {{ root: string|null, output: string, dryRun: boolean, help: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    root: null,
    output: '.github/readme/data/features.json',
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root':
        options.root = args[++i];
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (args[i].startsWith('-')) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  return options;
}

/**
 * Display help message.
 */
function showHelp() {
  console.log(`
analyze-project.js - Pre-populate features.json from project analysis

Usage: node analyze-project.js [options]

Options:
  --root <path>     Project root to analyze (default: cwd)
  --output <path>   Output path relative to root
                    (default: .github/readme/data/features.json)
  --dry-run         Print JSON to stdout instead of writing
  --help, -h        Show this help message

Analysis sources (static reads only, no subprocess execution):
  - package.json scripts    → "Scripts & Commands" category
  - package.json bin field  → "CLI Commands" category
  - openapi.json/yaml       → API endpoint groups by tag
  - Next.js/React routes    → "Web Pages" category
  - pyproject.toml scripts  → "CLI Commands" category
  - README.md headings      → fallback category seeds
  - CLAUDE.md headings      → supplemental category hints

All discovered features receive status "draft" for human review.

Examples:
  node analyze-project.js                             # Analyze cwd
  node analyze-project.js --root /my/project          # Explicit root
  node analyze-project.js --dry-run                   # Preview only
  node analyze-project.js --output path/features.json # Custom output
`);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Convert a string to a kebab-case slug safe for use as a JSON id field.
 * @param {string} str - Input string
 * @returns {string} Kebab-case slug
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // strip non-alphanum (keep spaces and hyphens)
    .trim()
    .replace(/[\s_]+/g, '-')        // spaces/underscores → hyphens
    .replace(/-+/g, '-')            // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '');       // strip leading/trailing hyphens
}

/**
 * Safely read and return the text of a file. Returns null on any error.
 * @param {string} filepath - Absolute path
 * @returns {string|null}
 */
function readText(filepath) {
  try {
    return readFileSync(filepath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Safely parse JSON text. Returns null on syntax errors.
 * @param {string} text - JSON text
 * @param {string} label - Human-readable label for error messages
 * @returns {unknown|null}
 */
function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`[analyze] Invalid JSON in ${label}: ${err.message}`);
    return null;
  }
}

/**
 * Enumerate all files under a directory, skipping common build/vendor directories.
 * Returns paths relative to the given root, using forward slashes.
 *
 * @param {string} dir - Absolute directory path
 * @param {string} root - Project root for relative-path construction
 * @param {number} [maxDepth=8] - Maximum recursion depth
 * @returns {string[]} Relative file paths (forward-slash separated)
 */
function walkDir(dir, root, maxDepth = 8) {
  const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
    '.venv', 'venv', 'env', '.tox', 'coverage', '.nyc_output', 'out',
  ]);

  const results = [];

  function recurse(current, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;

      const full = join(current, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        recurse(full, depth + 1);
      } else {
        // Normalize to forward-slash relative paths regardless of OS
        const rel = relative(root, full).split(sep).join(posix.sep);
        results.push(rel);
      }
    }
  }

  recurse(dir, 0);
  return results;
}

// ---------------------------------------------------------------------------
// Feature builder
// ---------------------------------------------------------------------------

/**
 * Create a feature object with all required fields.
 * Optional fields (cliCommand, webPage) are only included when provided.
 *
 * @param {string} id - Slugified feature ID
 * @param {string} name - Display name
 * @param {string} description - Auto-detected description
 * @param {{ cliCommand?: string, webPage?: string }} [extras]
 * @returns {Object} Feature object
 */
function makeFeature(id, name, description, extras = {}) {
  const feature = {
    id: slugify(id) || slugify(name),
    name,
    description,
    status: 'draft',
    highlight: false,
  };

  if (extras.cliCommand) feature.cliCommand = extras.cliCommand;
  if (extras.webPage) feature.webPage = extras.webPage;

  return feature;
}

/**
 * Create a category object.
 * @param {string} id - Slugified category ID
 * @param {string} name - Display name
 * @param {Object[]} features - Feature objects
 * @returns {Object} Category object
 */
function makeCategory(id, name, features) {
  return { id: slugify(id) || slugify(name), name, features };
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

/**
 * Heuristic 1 & 2: Analyze package.json for npm scripts and CLI bin entries.
 *
 * Scripts → "Scripts & Commands" category.
 * Bin entries → "CLI Commands" category.
 *
 * @param {string} root - Project root
 * @returns {{ categories: Object[], source: string|null }}
 */
function analyzePackageJson(root) {
  const pkgPath = join(root, 'package.json');
  const text = readText(pkgPath);
  if (!text) return { categories: [], source: null };

  const pkg = parseJson(text, 'package.json');
  if (!pkg) return { categories: [], source: null };

  const categories = [];

  // --- Scripts → "Scripts & Commands" ---
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    const features = Object.entries(pkg.scripts)
      // Omit internal/meta scripts that aren't useful README features
      .filter(([name]) => !name.startsWith('_'))
      .map(([name, command]) => {
        // Try to infer a human-readable description from the script body.
        const description = inferScriptDescription(name, command);
        return makeFeature(name, name, description, { cliCommand: `npm run ${name}` });
      });

    if (features.length > 0) {
      categories.push(makeCategory('scripts-commands', 'Scripts & Commands', features));
    }
  }

  // --- bin → "CLI Commands" ---
  if (pkg.bin && typeof pkg.bin === 'object') {
    const binEntries = Object.entries(pkg.bin);
    const features = binEntries.map(([binName]) =>
      makeFeature(binName, binName, `CLI binary: ${binName}`, { cliCommand: binName })
    );

    if (features.length > 0) {
      // Merge into existing CLI Commands category if present, else create one
      const existing = categories.find((c) => c.id === 'cli-commands');
      if (existing) {
        existing.features.push(...features);
      } else {
        categories.push(makeCategory('cli-commands', 'CLI Commands', features));
      }
    }
  } else if (typeof pkg.bin === 'string' && pkg.name) {
    // bin can be a shorthand string mapping package.name → single binary
    const features = [
      makeFeature(pkg.name, pkg.name, `CLI binary: ${pkg.name}`, { cliCommand: pkg.name }),
    ];
    categories.push(makeCategory('cli-commands', 'CLI Commands', features));
  }

  return { categories, source: categories.length > 0 ? 'package.json' : null };
}

/**
 * Infer a short human-readable description from a script name and its command.
 * Falls back to "npm script" if nothing useful can be derived.
 *
 * @param {string} name - Script name
 * @param {string} command - Shell command string
 * @returns {string}
 */
function inferScriptDescription(name, command) {
  const knownDescriptions = {
    dev: 'Start development server',
    start: 'Start production server',
    build: 'Build project for production',
    test: 'Run test suite',
    lint: 'Run code linter',
    format: 'Format source code',
    typecheck: 'Run TypeScript type checks',
    'type-check': 'Run TypeScript type checks',
    clean: 'Remove build artifacts',
    deploy: 'Deploy to production',
    preview: 'Preview production build locally',
    check: 'Run all quality checks',
    prepare: 'Prepare package (runs on install)',
    postinstall: 'Post-install setup hook',
    release: 'Create a new release',
    generate: 'Run code generation',
    migrate: 'Run database migrations',
    seed: 'Seed database with sample data',
    docs: 'Generate or serve documentation',
    storybook: 'Start Storybook component explorer',
  };

  if (knownDescriptions[name]) return knownDescriptions[name];

  // Infer from common tool names appearing in the command
  if (/\bvitest\b/.test(command)) return 'Run Vitest test suite';
  if (/\bjest\b/.test(command)) return 'Run Jest test suite';
  if (/\bprisma\b/.test(command)) return 'Run Prisma database operation';
  if (/\bdrizzle\b/.test(command)) return 'Run Drizzle database operation';
  if (/\bnext\b/.test(command)) return 'Run Next.js operation';
  if (/\bvite\b/.test(command)) return 'Run Vite build tool';
  if (/\btsc\b/.test(command)) return 'TypeScript compilation';
  if (/\beslint\b/.test(command)) return 'Run ESLint code analysis';
  if (/\bprettier\b/.test(command)) return 'Format code with Prettier';
  if (/\bplaywright\b/.test(command)) return 'Run Playwright end-to-end tests';
  if (/\bcypress\b/.test(command)) return 'Run Cypress end-to-end tests';

  return 'npm script';
}

/**
 * Heuristic 3: Analyze OpenAPI spec (JSON only; YAML requires external dep).
 *
 * Looks for spec files in common locations. Extracts tags as categories and
 * path groups as features within each tag.
 *
 * @param {string} root - Project root
 * @returns {{ categories: Object[], source: string|null }}
 */
function analyzeOpenApi(root) {
  const candidatePaths = [
    'openapi.json',
    'swagger.json',
    'docs/openapi.json',
    'docs/swagger.json',
    'api/openapi.json',
    'api/swagger.json',
    'src/openapi.json',
    'static/openapi.json',
    // Skill/README system conventional location
    'skillmeat/api/openapi.json',
  ];

  // Also look for YAML variants — we can detect presence but not parse them
  const yamlCandidates = candidatePaths.map((p) => p.replace('.json', '.yaml'))
    .concat(candidatePaths.map((p) => p.replace('.json', '.yml')));

  let spec = null;
  let usedPath = null;

  for (const candidate of candidatePaths) {
    const full = join(root, candidate);
    const text = readText(full);
    if (text) {
      spec = parseJson(text, candidate);
      if (spec) {
        usedPath = candidate;
        break;
      }
    }
  }

  // Inform user about YAML specs we found but can't parse
  for (const candidate of yamlCandidates) {
    const full = join(root, candidate);
    if (existsSync(full)) {
      console.error(
        `[analyze] Found YAML OpenAPI spec at ${candidate} but cannot parse it without a YAML parser. ` +
        'Run "npm install yaml" and update this script to enable YAML support.'
      );
    }
  }

  if (!spec) return { categories: [], source: null };

  const categories = [];

  // Collect all tags defined at the top level
  const tagDescriptions = {};
  if (Array.isArray(spec.tags)) {
    for (const tag of spec.tags) {
      if (tag.name) tagDescriptions[tag.name] = tag.description || `${tag.name} API endpoints`;
    }
  }

  // Walk all paths, group operations by tag
  const tagFeatures = {}; // tag → Set of operation summaries

  if (spec.paths && typeof spec.paths === 'object') {
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;

      const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation) continue;

        const tags = Array.isArray(operation.tags) && operation.tags.length > 0
          ? operation.tags
          : ['General'];

        const operationName = operation.operationId
          || operation.summary
          || `${method.toUpperCase()} ${path}`;

        for (const tag of tags) {
          if (!tagFeatures[tag]) tagFeatures[tag] = [];
          tagFeatures[tag].push({
            id: slugify(operation.operationId || `${method}-${path}`),
            name: operation.summary || operationName,
            description: operation.description
              || `${method.toUpperCase()} ${path}`,
            method,
            path,
          });
        }
      }
    }
  }

  for (const [tag, operations] of Object.entries(tagFeatures)) {
    // Deduplicate by id
    const seen = new Set();
    const features = operations
      .filter((op) => {
        if (seen.has(op.id)) return false;
        seen.add(op.id);
        return true;
      })
      .map((op) =>
        makeFeature(op.id, op.name, op.description)
      );

    if (features.length > 0) {
      const catId = slugify(tag);
      const catName = tag;
      categories.push(makeCategory(catId, catName, features));
    }
  }

  return { categories, source: categories.length > 0 ? usedPath : null };
}

/**
 * Heuristic 4: Detect Next.js App Router or Pages Router routes.
 *
 * App Router: looks for page.tsx/page.jsx/page.ts/page.js under app/.
 * Pages Router: looks for .tsx/.jsx/.ts/.js files directly under pages/.
 * Infrastructure files (layout, loading, error, not-found, _app, _document) are skipped.
 *
 * @param {string} root - Project root
 * @param {string[]} allFiles - All project file paths (relative, forward-slash)
 * @returns {{ categories: Object[], source: string|null }}
 */
function analyzeNextJsRoutes(_root, allFiles) {
  const INFRA_NAMES = new Set([
    'layout', 'loading', 'error', 'not-found', 'template',
    'default', 'middleware', '_app', '_document', '_error',
  ]);

  const PAGE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js']);

  const features = [];
  let routerType = null;

  // --- App Router: files named page.{ext} under app/ ---
  const appPageFiles = allFiles.filter((f) => {
    const parts = f.split('/');
    if (parts[0] !== 'app' && !parts.some((p) => p === 'app')) return false;
    const base = parts[parts.length - 1];
    const dot = base.lastIndexOf('.');
    if (dot === -1) return false;
    const name = base.slice(0, dot);
    const ext = base.slice(dot);
    return name === 'page' && PAGE_EXTENSIONS.has(ext);
  });

  if (appPageFiles.length > 0) {
    routerType = 'App Router';
    for (const f of appPageFiles) {
      // Convert file path to route: remove leading "app/", strip trailing /page.ext
      // e.g. app/dashboard/settings/page.tsx → /dashboard/settings
      const parts = f.split('/');
      const appIdx = parts.lastIndexOf('app');
      const routeParts = parts.slice(appIdx + 1, -1); // drop "app" and "page.ext"

      // Filter out route group segments (surrounded by parens) — they don't appear in URL
      const urlParts = routeParts.filter((p) => !/^\(.*\)$/.test(p));
      const route = '/' + urlParts.join('/');
      const pageName = urlParts[urlParts.length - 1] || 'home';

      if (INFRA_NAMES.has(pageName)) continue;

      const displayName = pageName
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Home';

      features.push(
        makeFeature(
          `page-${urlParts.join('-') || 'home'}`,
          `${displayName} Page`,
          `Web page at ${route || '/'}`,
          { webPage: route || '/' }
        )
      );
    }
  }

  // --- Pages Router: .{ext} files directly under pages/ ---
  if (features.length === 0) {
    const pagesFiles = allFiles.filter((f) => {
      const parts = f.split('/');
      if (parts[0] !== 'pages') return false;
      const base = parts[parts.length - 1];
      const dot = base.lastIndexOf('.');
      if (dot === -1) return false;
      const name = base.slice(0, dot);
      const ext = base.slice(dot);
      return PAGE_EXTENSIONS.has(ext) && !INFRA_NAMES.has(name) && !name.startsWith('_');
    });

    if (pagesFiles.length > 0) {
      routerType = 'Pages Router';
      for (const f of pagesFiles) {
        const parts = f.split('/');
        // pages/dashboard/index.tsx → /dashboard
        // pages/about.tsx → /about
        const routeParts = parts.slice(1); // drop "pages/"
        const lastPart = routeParts[routeParts.length - 1];
        const dot = lastPart.lastIndexOf('.');
        const baseName = dot !== -1 ? lastPart.slice(0, dot) : lastPart;

        const finalParts = baseName === 'index'
          ? routeParts.slice(0, -1)
          : [...routeParts.slice(0, -1), baseName];

        const route = '/' + finalParts.join('/');
        const pageName = finalParts[finalParts.length - 1] || 'home';

        const displayName = pageName
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Home';

        features.push(
          makeFeature(
            `page-${finalParts.join('-') || 'home'}`,
            `${displayName} Page`,
            `Web page at ${route || '/'}`,
            { webPage: route || '/' }
          )
        );
      }
    }
  }

  if (features.length === 0) return { categories: [], source: null };

  return {
    categories: [makeCategory('web-pages', 'Web Pages', features)],
    source: `Next.js ${routerType}`,
  };
}

/**
 * Heuristic 5: Detect Python CLI entry points from pyproject.toml.
 *
 * Reads [project.scripts] table and creates a feature per entry point.
 * Falls back to checking for cli.py / __main__.py as indicators.
 *
 * Note: This is a lightweight TOML parser covering only the [project.scripts]
 * section. It handles simple key = "value" lines but not inline tables or
 * multi-line values — which is sufficient for entry point declarations.
 *
 * @param {string} root - Project root
 * @param {string[]} allFiles - All project file paths (relative, forward-slash)
 * @returns {{ categories: Object[], source: string|null }}
 */
function analyzePythonCli(root, allFiles) {
  const features = [];
  const sources = [];

  // --- pyproject.toml [project.scripts] ---
  const pyprojectText = readText(join(root, 'pyproject.toml'));
  if (pyprojectText) {
    const scripts = extractPyprojectScripts(pyprojectText);
    for (const [name, target] of Object.entries(scripts)) {
      features.push(
        makeFeature(name, name, `Python CLI entry point (${target})`, { cliCommand: name })
      );
    }
    if (Object.keys(scripts).length > 0) sources.push('pyproject.toml');
  }

  // --- cli.py or __main__.py as fallback indicators ---
  const hasCliPy = allFiles.some(
    (f) => f === 'cli.py' || f.endsWith('/cli.py') || f === '__main__.py' || f.endsWith('/__main__.py')
  );

  if (hasCliPy && features.length === 0) {
    // We know there's a CLI but can't enumerate commands without executing code.
    // Add a placeholder so the human at least knows to fill this in.
    features.push(
      makeFeature('cli', 'CLI', 'Command-line interface (see cli.py / __main__.py)', {
        cliCommand: 'python -m <package>',
      })
    );
    sources.push('cli.py');
  }

  if (features.length === 0) return { categories: [], source: null };

  return {
    categories: [makeCategory('cli-commands', 'CLI Commands', features)],
    source: sources.join(', '),
  };
}

/**
 * Extract [project.scripts] entries from pyproject.toml text using a
 * lightweight line-by-line parser. Does not handle multi-line values.
 *
 * @param {string} text - pyproject.toml content
 * @returns {Record<string, string>} Map of script name → entry point
 */
function extractPyprojectScripts(text) {
  const scripts = {};
  let inScripts = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    if (line === '[project.scripts]') {
      inScripts = true;
      continue;
    }

    // Any new section header ends the [project.scripts] block
    if (inScripts && line.startsWith('[')) {
      inScripts = false;
      continue;
    }

    if (inScripts && line.includes('=') && !line.startsWith('#')) {
      const eqIdx = line.indexOf('=');
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      value = value.replace(/^["']|["']$/g, '');
      if (key) scripts[key] = value;
    }
  }

  return scripts;
}

/**
 * Heuristic 6 & 7: Extract category seeds from README.md and CLAUDE.md headings.
 *
 * Used only as a fallback when other heuristics found nothing, or as supplemental
 * hints. Returns category stubs with no features (the caller decides whether to
 * include them).
 *
 * @param {string} root - Project root
 * @returns {{ categories: Object[], source: string|null }}
 */
function analyzeMarkdownHeadings(root) {
  const categories = [];
  const sources = [];

  for (const filename of ['README.md', 'CLAUDE.md']) {
    const text = readText(join(root, filename));
    if (!text) continue;

    // Extract ## level headings only (not # title or ### subsections)
    const headings = text
      .split('\n')
      .filter((line) => /^## /.test(line))
      .map((line) => line.replace(/^## /, '').trim());

    if (headings.length > 0) {
      sources.push(filename);
      for (const heading of headings) {
        // Skip headings that are clearly meta-content, not feature categories
        const SKIP_HEADINGS = new Set([
          'table of contents', 'contents', 'toc', 'installation', 'setup',
          'contributing', 'license', 'changelog', 'authors', 'credits',
          'acknowledgements', 'requirements', 'prerequisites', 'contact',
          'support', 'faq', 'troubleshooting',
        ]);
        if (SKIP_HEADINGS.has(heading.toLowerCase())) continue;

        const id = slugify(heading);
        if (id && !categories.some((c) => c.id === id)) {
          // Stub category — no features yet, just the heading hint
          categories.push(makeCategory(id, heading, []));
        }
      }
    }
  }

  return {
    categories,
    source: sources.length > 0 ? sources.join(', ') : null,
  };
}

// ---------------------------------------------------------------------------
// Merge & deduplication
// ---------------------------------------------------------------------------

/**
 * Merge multiple category arrays into a single deduplicated list.
 *
 * Categories with the same id are merged (features are combined, duplicates
 * removed by feature id). Categories are then sorted alphabetically by name,
 * except that specific high-value categories are promoted to the front.
 *
 * @param {Object[][]} categoryArrays - Arrays of category objects to merge
 * @returns {Object[]} Merged and sorted categories
 */
function mergeCategories(categoryArrays) {
  const merged = {};

  for (const cats of categoryArrays) {
    for (const cat of cats) {
      if (!cat.id) continue;

      if (!merged[cat.id]) {
        merged[cat.id] = { id: cat.id, name: cat.name, features: [] };
      }

      for (const feature of cat.features || []) {
        if (!feature.id) continue;
        const exists = merged[cat.id].features.some((f) => f.id === feature.id);
        if (!exists) {
          merged[cat.id].features.push(feature);
        }
      }
    }
  }

  // Sort categories alphabetically; promote a few standard ones to front
  const PRIORITY_ORDER = ['cli-commands', 'scripts-commands', 'web-pages'];

  return Object.values(merged).sort((a, b) => {
    const ai = PRIORITY_ORDER.indexOf(a.id);
    const bi = PRIORITY_ORDER.indexOf(b.id);

    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

/**
 * Run all heuristics against the given project root and return merged categories.
 *
 * @param {string} root - Absolute project root path
 * @returns {{ categories: Object[], sourcesUsed: string[] }}
 */
function analyzeProject(root) {
  // Walk the tree once and share with heuristics that need it
  const allFiles = walkDir(root, root);

  const sourcesUsed = [];
  const allCategoryArrays = [];

  // --- package.json (heuristics 1 & 2) ---
  const pkgResult = analyzePackageJson(root);
  if (pkgResult.source) {
    sourcesUsed.push(pkgResult.source);
    allCategoryArrays.push(pkgResult.categories);
  }

  // --- OpenAPI spec (heuristic 3) ---
  const openApiResult = analyzeOpenApi(root);
  if (openApiResult.source) {
    sourcesUsed.push(`OpenAPI (${openApiResult.source})`);
    allCategoryArrays.push(openApiResult.categories);
  }

  // --- Next.js / React routes (heuristic 4) ---
  const routesResult = analyzeNextJsRoutes(root, allFiles);
  if (routesResult.source) {
    sourcesUsed.push(routesResult.source);
    allCategoryArrays.push(routesResult.categories);
  }

  // --- Python CLI (heuristic 5) ---
  const pythonResult = analyzePythonCli(root, allFiles);
  if (pythonResult.source) {
    sourcesUsed.push(pythonResult.source);
    allCategoryArrays.push(pythonResult.categories);
  }

  // --- Markdown headings (heuristics 6 & 7): use as fallback only ---
  const mdResult = analyzeMarkdownHeadings(root);
  if (mdResult.source) {
    // Always record the source for summary, but only inject category stubs
    // when they fill gaps (stub categories have empty features arrays).
    sourcesUsed.push(mdResult.source);

    // Filter to headings not already covered by a richer heuristic
    const existingIds = new Set(allCategoryArrays.flat().map((c) => c.id));
    const novelStubs = mdResult.categories.filter((c) => !existingIds.has(c.id));
    if (novelStubs.length > 0) {
      allCategoryArrays.push(novelStubs);
    }
  }

  const categories = mergeCategories(allCategoryArrays);

  return { categories, sourcesUsed };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const root = options.root ? options.root : process.cwd();

  if (!existsSync(root)) {
    console.error(`[analyze] Project root does not exist: ${root}`);
    process.exit(1);
  }

  console.error(`[analyze] Scanning project: ${root}`);

  const { categories, sourcesUsed } = analyzeProject(root);

  const totalFeatures = categories.reduce((sum, c) => sum + (c.features?.length || 0), 0);

  const output = {
    $schema: '../../.claude/skills/managing-readmes/data-schemas/features.schema.json',
    categories,
  };

  const json = JSON.stringify(output, null, 2) + '\n';

  if (options.dryRun) {
    // Use writeFileSync on /dev/stdout to bypass Node.js stream backpressure,
    // which silently truncates at ~64 KB when process.stdout.write() is piped
    // and the caller does not await the drain event.
    try {
      writeFileSync('/dev/stdout', json, 'utf8');
    } catch {
      // /dev/stdout is unavailable (e.g. Windows) — fall back to chunked writes
      const CHUNK = 16 * 1024;
      for (let i = 0; i < json.length; i += CHUNK) {
        process.stdout.write(json.slice(i, i + CHUNK));
      }
    }
  } else {
    const outputPath = join(root, options.output);
    const outputDir = dirname(outputPath);

    try {
      mkdirSync(outputDir, { recursive: true });
    } catch (err) {
      console.error(`[analyze] Failed to create output directory ${outputDir}: ${err.message}`);
      process.exit(1);
    }

    try {
      writeFileSync(outputPath, json, 'utf8');
    } catch (err) {
      console.error(`[analyze] Failed to write ${outputPath}: ${err.message}`);
      process.exit(1);
    }

    console.error(`[analyze] Written: ${outputPath}`);
  }

  // Always print summary to stderr so it doesn't pollute --dry-run stdout
  const sourceList = sourcesUsed.length > 0 ? sourcesUsed.join(', ') : 'none';
  console.error(
    `[analyze] Found ${totalFeatures} feature(s) across ${categories.length} ` +
    `categor${categories.length === 1 ? 'y' : 'ies'} from: ${sourceList}`
  );

  if (totalFeatures === 0) {
    console.error('[analyze] No analyzable sources found. Output contains empty categories array.');
  }

  process.exit(0);
}

main();

// ---------------------------------------------------------------------------
// Exports (for testing and composition)
// ---------------------------------------------------------------------------

export {
  parseArgs,
  slugify,
  makeFeature,
  makeCategory,
  analyzePackageJson,
  analyzeOpenApi,
  analyzeNextJsRoutes,
  analyzePythonCli,
  extractPyprojectScripts,
  analyzeMarkdownHeadings,
  mergeCategories,
  analyzeProject,
};
