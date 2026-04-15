#!/usr/bin/env node
/**
 * generate-screenshot-spec.js - Screenshot spec generator
 *
 * Analyzes a project and produces a screenshots.json-compatible spec that
 * captures the screenshot surface for a given project type. The generated
 * spec is a reasonable starting point — humans and agents refine it.
 *
 * Usage: node generate-screenshot-spec.js [options]
 *
 * Options:
 *   --root <path>     Project root to analyze (default: cwd)
 *   --type <type>     Project type: cli | web | library | saas (required)
 *   --output <path>   Output path relative to root
 *                     (default: .github/readme/data/screenshots.json)
 *   --dry-run         Print JSON to stdout instead of writing file
 *   --help, -h        Show this help message
 *
 * Project types:
 *   cli       Binary tools with subcommands (package.json bin, pyproject.toml scripts)
 *   web       Next.js / React / SvelteKit apps with route-based pages
 *   saas      Alias for web — same analysis strategy
 *   library   npm/PyPI packages focused on code examples and API docs
 *
 * Exit codes:
 *   0 - Spec generated (or dry-run printed) successfully
 *   1 - Fatal error (missing --type, unreadable project root, etc.)
 *
 * @example
 *   node generate-screenshot-spec.js --type web
 *   node generate-screenshot-spec.js --root /my/app --type cli --dry-run
 *   node generate-screenshot-spec.js --type library --output docs/screenshots.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, basename, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Infrastructure files in Next.js App Router — not real pages, skip them. */
const NEXTJS_INFRA_FILES = new Set([
  'layout',
  'loading',
  'error',
  'not-found',
  'template',
  'default',
  'global-error',
  'opengraph-image',
  'twitter-image',
  'icon',
  'apple-icon',
  'robots',
  'sitemap',
  'manifest',
]);

/** File extensions that represent page entry points. */
const PAGE_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js', '.svelte', '.vue']);

/** Default viewport dimensions by asset category. */
const VIEWPORTS = {
  web: { width: 1280, height: 720 },
  saas: { width: 1280, height: 720 },
  cli: { width: 800, height: 600 },
  library: { width: 1280, height: 720 },
};

/** GIF tool used for all browser-based recordings. */
const GIF_TOOL = 'mcp__claude-in-chrome__gif_creator';

/** Standard GIF config applied to all generated entries. */
const GIF_CONFIG = {
  showClickIndicators: true,
  showActionLabels: true,
  showProgressBar: true,
  quality: 10,
};

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

/**
 * Parse command line arguments into an options object.
 * @returns {{ root: string|null, type: string|null, output: string|null, dryRun: boolean, help: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    root: null,
    type: null,
    output: null,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root':
        options.root = args[++i];
        break;
      case '--type':
        options.type = args[++i];
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

/** Print usage to stdout and exit 0. */
function showHelp() {
  console.log(`
generate-screenshot-spec.js - Generate a screenshots.json spec for a project

Usage: node generate-screenshot-spec.js [options]

Options:
  --root <path>     Project root to analyze (default: cwd)
  --type <type>     Project type: cli | web | library | saas  (required)
  --output <path>   Output path relative to root
                    (default: .github/readme/data/screenshots.json)
  --dry-run         Print JSON to stdout instead of writing file
  --help, -h        Show this help message

Project Types:
  cli       Binary tools with subcommands (package.json bin, pyproject.toml scripts)
  web       Next.js / React / SvelteKit apps with route-based pages
  saas      Alias for web — same analysis strategy
  library   npm/PyPI packages focused on code examples and API docs

Examples:
  node generate-screenshot-spec.js --type web
  node generate-screenshot-spec.js --root /my/app --type cli --dry-run
  node generate-screenshot-spec.js --type saas --output docs/screenshots.json
`);
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to parse a JSON file from disk, returning null on any failure.
 * @param {string} filepath - Absolute path to the JSON file
 * @returns {Object|null}
 */
function tryReadJson(filepath) {
  try {
    return JSON.parse(readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * List direct children of a directory, returning an empty array if the
 * directory does not exist or cannot be read.
 * @param {string} dir - Absolute directory path
 * @returns {string[]} Child entry names (not full paths)
 */
function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Return true if the path exists and is a directory.
 * @param {string} p - Absolute path
 * @returns {boolean}
 */
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk a directory tree, yielding all file paths with one of the given
 * extensions. Non-recursive subdirectory calls are bounded to avoid
 * infinite symlink loops via a depth limit.
 *
 * @param {string} dir - Absolute directory to walk
 * @param {Set<string>} exts - Allowed extensions (e.g. new Set(['.tsx']))
 * @param {number} [maxDepth=6] - Maximum recursion depth
 * @returns {string[]} Absolute paths of matching files
 */
function walkFiles(dir, exts, maxDepth = 6) {
  if (maxDepth <= 0 || !isDir(dir)) return [];
  const results = [];
  for (const entry of safeReaddir(dir)) {
    const full = join(dir, entry);
    if (isDir(full)) {
      results.push(...walkFiles(full, exts, maxDepth - 1));
    } else if (exts.has(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

/**
 * Convert an arbitrary string to kebab-case, replacing non-alphanumeric
 * characters with hyphens and collapsing consecutive hyphens.
 * @param {string} str
 * @returns {string}
 */
function toKebab(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Convert a kebab-case identifier into a title-cased human label.
 * e.g. "artifact-detail" → "Artifact Detail"
 * @param {string} kebab
 * @returns {string}
 */
function toTitle(kebab) {
  return kebab
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Derive a route path from an App Router file path relative to the routes
 * root directory. Dynamic segments like [id] are preserved.
 *
 * Examples:
 *   "page.tsx"                    → "/"
 *   "artifacts/page.tsx"          → "/artifacts"
 *   "artifacts/[id]/page.tsx"     → "/artifacts/[id]"
 *
 * @param {string} fileRelToRouteRoot - Path relative to the routes root dir
 * @returns {string}
 */
function fileToRoute(fileRelToRouteRoot) {
  // Drop the filename (page.tsx / route.tsx / index.tsx etc.)
  const dir = dirname(fileRelToRouteRoot);
  if (dir === '.' || dir === '') return '/';
  // Normalise path separators and prefix with /
  return '/' + dir.replace(/\\/g, '/');
}

/**
 * Count the depth of a route path (number of non-empty segments).
 * "/" → 0, "/artifacts" → 1, "/artifacts/[id]" → 2
 * @param {string} route
 * @returns {number}
 */
function routeDepth(route) {
  return route.split('/').filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Screenshot / GIF builders
// ---------------------------------------------------------------------------

/**
 * Build a single screenshot entry conforming to screenshots.schema.json.
 *
 * @param {object} opts
 * @param {string} opts.id         - Kebab-case unique identifier
 * @param {string} opts.page       - Route path, command name, or context
 * @param {string} opts.alt        - Accessibility / README alt text
 * @param {string} opts.category   - "readme" | "features" | "cli" | "gifs"
 * @param {number} opts.width      - Viewport pixel width
 * @param {number} opts.height     - Viewport pixel height
 * @param {string} opts.notes      - Capture instructions for author/agent
 * @param {string[]} [opts.features] - Feature IDs illustrated (default [])
 * @returns {object} Screenshot entry
 */
function makeScreenshot({ id, page, alt, category, width, height, notes, features = [] }) {
  return {
    id,
    file: `docs/screenshots/${id}.png`,
    alt,
    width,
    height,
    category,
    page,
    features,
    captured: null,
    status: 'pending',
    notes,
  };
}

/**
 * Build a single GIF entry conforming to screenshots.schema.json.
 *
 * Note: The `hold` field in GifStep uses milliseconds throughout this script
 * (matching the planning guide examples), even though the JSON Schema types
 * it as `number` with no unit restriction.
 *
 * @param {object} opts
 * @param {string} opts.id       - Kebab-case unique identifier
 * @param {string} opts.alt      - Accessibility text
 * @param {string} opts.notes    - Recording instructions
 * @param {object[]} opts.sequence - Ordered GifStep objects
 * @returns {object} GIF entry
 */
function makeGif({ id, alt, notes, sequence }) {
  return {
    id,
    file: `docs/screenshots/gifs/${id}.gif`,
    alt,
    tool: GIF_TOOL,
    config: { ...GIF_CONFIG },
    sequence,
    status: 'pending',
    notes,
  };
}

// ---------------------------------------------------------------------------
// Web / SaaS analysis
// ---------------------------------------------------------------------------

/**
 * Locate the route root directory for a web project by checking the common
 * conventions in order: Next.js App Router (app/), Pages Router (pages/),
 * SvelteKit / Remix-style (src/routes/).
 *
 * @param {string} root - Project root
 * @returns {{ routeDir: string, convention: string }|null}
 */
function findRouteDir(root) {
  const candidates = [
    { rel: 'app', convention: 'nextjs-app-router' },
    { rel: 'src/app', convention: 'nextjs-app-router' },
    { rel: 'pages', convention: 'nextjs-pages-router' },
    { rel: 'src/pages', convention: 'nextjs-pages-router' },
    { rel: 'src/routes', convention: 'svelte-kit' },
    { rel: 'routes', convention: 'generic' },
  ];

  for (const { rel, convention } of candidates) {
    const dir = join(root, rel);
    if (isDir(dir)) {
      return { routeDir: dir, convention };
    }
  }
  return null;
}

/**
 * Return true if a filename (without extension) is an App Router
 * infrastructure file that does not represent a real navigable page.
 * @param {string} name - Filename without extension
 * @returns {boolean}
 */
function isInfraFile(name) {
  return NEXTJS_INFRA_FILES.has(name);
}

/**
 * Enumerate navigable routes from a route directory.
 *
 * For App Router projects we look for `page` files; for Pages Router we
 * look for any non-infrastructure file; for generic dirs we use all files.
 *
 * @param {string} routeDir - Absolute path to the routes root
 * @param {string} convention - e.g. "nextjs-app-router"
 * @returns {string[]} Sorted route paths (e.g. ["/", "/artifacts", ...])
 */
function enumerateRoutes(routeDir, convention) {
  const files = walkFiles(routeDir, PAGE_EXTENSIONS);
  const routes = new Set();

  for (const file of files) {
    const rel = relative(routeDir, file);
    const name = basename(rel, extname(rel));

    if (convention === 'nextjs-app-router') {
      // Only include `page` files — everything else is infrastructure
      if (name !== 'page') continue;
      routes.add(fileToRoute(rel));
    } else if (convention === 'nextjs-pages-router') {
      // Skip infrastructure and API routes
      if (isInfraFile(name)) continue;
      if (rel.startsWith('api/') || rel.startsWith('api\\')) continue;
      routes.add(fileToRoute(rel));
    } else {
      // Generic: include all non-infrastructure files
      if (isInfraFile(name)) continue;
      routes.add(fileToRoute(rel));
    }
  }

  // Sort by depth ascending (shallower = more important), then alphabetically
  return [...routes].sort((a, b) => {
    const depthDiff = routeDepth(a) - routeDepth(b);
    return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
  });
}

/**
 * Derive a human-readable label from a route path.
 * "/artifacts/[id]" → "Artifact Detail"
 * "/" → "Home"
 * @param {string} route
 * @returns {string}
 */
function routeToLabel(route) {
  if (route === '/') return 'Home';
  const segments = route.split('/').filter(Boolean);
  // Use last meaningful segment, stripping dynamic [param] markers
  const last = segments[segments.length - 1].replace(/\[.*?\]/g, 'detail').replace(/-/g, ' ');
  const parent = segments.length > 1 ? toTitle(segments[0]) + ' ' : '';
  return parent + toTitle(last.replace(/ /g, '-'));
}

/**
 * Generate notes for a web/SaaS screenshot entry.
 * @param {string} route
 * @param {boolean} isHero
 * @returns {string}
 */
function webNotes(route, isHero) {
  const base = `Navigate to ${route}.`;
  const data = 'Ensure sample data is loaded (no empty states).';
  const hero = isHero ? ' Capture the primary overview state for the README hero shot.' : '';
  return `${base} ${data}${hero}`;
}

/**
 * Check if the project has an openapi.json and return its path if found.
 * @param {string} root
 * @returns {string|null}
 */
function findOpenApiJson(root) {
  const candidates = [
    'openapi.json',
    'docs/openapi.json',
    'public/openapi.json',
    'api/openapi.json',
  ];
  for (const rel of candidates) {
    if (existsSync(join(root, rel))) return rel;
  }
  return null;
}

/**
 * Analyse a web or SaaS project and return screenshot + GIF entries.
 *
 * Strategy:
 *  1. Discover routes; skip infrastructure files.
 *  2. First entry → category "readme" (hero); rest → "features".
 *  3. If openapi.json exists, add a Swagger UI screenshot.
 *  4. GIFs: top-3 routes by depth (shallowest = highest priority).
 *
 * @param {string} root
 * @param {string} type - "web" | "saas"
 * @returns {{ screenshots: object[], gifs: object[] }}
 */
function analyzeWeb(root, type) {
  const viewport = VIEWPORTS[type];
  const screenshots = [];
  const gifs = [];

  // Discover routes
  const routeDirResult = findRouteDir(root);
  let routes = [];

  if (routeDirResult) {
    routes = enumerateRoutes(routeDirResult.routeDir, routeDirResult.convention);
  }

  // If no routes discovered, generate a sensible placeholder
  if (routes.length === 0) {
    routes = ['/'];
  }

  // Build screenshot entries
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const isHero = i === 0;
    const isSecond = i === 1;
    const category = isHero || isSecond ? 'readme' : 'features';
    const label = routeToLabel(route);
    const id = toKebab(route === '/' ? 'home-overview' : route.replace(/\//g, '-').replace(/\[|\]/g, ''));

    screenshots.push(
      makeScreenshot({
        id,
        page: route,
        alt: `${label} view${isHero ? ' — primary README hero shot' : ''}`,
        category,
        width: viewport.width,
        height: viewport.height,
        notes: webNotes(route, isHero),
      }),
    );
  }

  // Optional: Swagger UI screenshot if openapi.json detected
  const openapiPath = findOpenApiJson(root);
  if (openapiPath) {
    screenshots.push(
      makeScreenshot({
        id: 'api-reference',
        page: '/api-docs',
        alt: 'API reference page showing available endpoints',
        category: 'features',
        width: viewport.width,
        height: viewport.height,
        notes:
          'Navigate to the Swagger UI / API docs page. Ensure at least one endpoint group is expanded to show the request/response schema.',
      }),
    );
  }

  // GIFs: top-3 shallowest routes
  const gifRoutes = routes.slice(0, 3);
  if (gifRoutes.length > 0) {
    const sequence = gifRoutes.map((route, idx) => {
      const steps = [
        {
          action: 'navigate',
          url: route,
          label: routeToLabel(route),
          hold: 2000,
        },
      ];
      // Add a generic interaction step for non-root pages
      if (route !== '/' && idx > 0) {
        steps.push({
          action: 'screenshot',
          hold: 3000,
        });
      }
      return steps;
    });

    // Flatten and add final screenshot hold
    const flatSequence = sequence.flat();
    flatSequence.push({ action: 'screenshot', hold: 3000 });

    gifs.push(
      makeGif({
        id: 'quickstart-workflow',
        alt: 'Quickstart workflow showing the primary application flow',
        notes: `Record the main user flow: ${gifRoutes.map(r => routeToLabel(r)).join(' → ')}. Start the dev server and seed sample data before recording.`,
        sequence: flatSequence,
      }),
    );
  }

  return { screenshots, gifs };
}

// ---------------------------------------------------------------------------
// CLI analysis
// ---------------------------------------------------------------------------

/**
 * Extract binary names from package.json `bin` field.
 * The field may be a string (single binary) or an object (multiple).
 * @param {Object} pkg - Parsed package.json
 * @returns {string[]} Binary names
 */
function extractBinaries(pkg) {
  if (!pkg.bin) return [];
  if (typeof pkg.bin === 'string') {
    return [pkg.name || 'cli'];
  }
  return Object.keys(pkg.bin);
}

/**
 * Extract script names from a pyproject.toml [project.scripts] section.
 * We do a simple regex parse since we have no external TOML library.
 * Matches lines like:   scriptname = "module:entrypoint"
 *
 * @param {string} root
 * @returns {string[]} Script names
 */
function extractPyprojectScripts(root) {
  const pyprojectPath = join(root, 'pyproject.toml');
  if (!existsSync(pyprojectPath)) return [];

  try {
    const content = readFileSync(pyprojectPath, 'utf8');
    // Find [project.scripts] section and collect entries until the next section
    const sectionMatch = content.match(/\[project\.scripts\]([\s\S]*?)(?=\n\[|$)/);
    if (!sectionMatch) return [];

    const names = [];
    const lines = sectionMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w-]+)\s*=/);
      if (match) {
        names.push(match[1]);
      }
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * Look for subcommand definitions by scanning Python source files for Click
 * group/command patterns and JavaScript source files for commander patterns.
 *
 * This is a best-effort heuristic — not a full AST parse. Results are used
 * to generate screenshot entries, not for functional execution.
 *
 * @param {string} root
 * @returns {string[]} Candidate subcommand names (deduplicated)
 */
function discoverSubcommands(root) {
  const found = new Set();

  // Python: look for @<group>.command("name") or @cli.command("name")
  const pyFiles = walkFiles(root, new Set(['.py']));
  const pyPattern = /@\w+\.command\(["']([^"']+)["']\)/g;
  for (const file of pyFiles.slice(0, 50)) {
    // Cap to avoid huge repos
    try {
      const content = readFileSync(file, 'utf8');
      let m;
      while ((m = pyPattern.exec(content)) !== null) {
        found.add(m[1]);
      }
    } catch {
      // Skip unreadable files
    }
  }

  // JavaScript/TypeScript: look for .command("name") (commander pattern)
  const jsFiles = walkFiles(root, new Set(['.js', '.ts', '.mjs', '.cjs']));
  const jsPattern = /\.command\(["']([^"'\s]+)["']/g;
  for (const file of jsFiles.slice(0, 50)) {
    try {
      const content = readFileSync(file, 'utf8');
      let m;
      while ((m = jsPattern.exec(content)) !== null) {
        found.add(m[1]);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return [...found].slice(0, 10); // Cap at 10 to keep spec readable
}

/**
 * Analyse a CLI project and return screenshot + GIF entries.
 *
 * Strategy:
 *  1. Find binary names from package.json or pyproject.toml.
 *  2. Each binary gets a `<binary> --help` screenshot.
 *  3. Discovered subcommands each get a help screenshot.
 *  4. First binary screenshot → "readme"; rest → "cli".
 *  5. One GIF: help → first subcommand → output.
 *
 * @param {string} root
 * @returns {{ screenshots: object[], gifs: object[] }}
 */
function analyzeCli(root) {
  const viewport = VIEWPORTS.cli;
  const screenshots = [];
  const gifs = [];

  // Discover binaries
  const pkg = tryReadJson(join(root, 'package.json'));
  const binaries = pkg ? extractBinaries(pkg) : [];
  const pyScripts = extractPyprojectScripts(root);
  const allBinaries = [...new Set([...binaries, ...pyScripts])];

  // Fallback: use directory name as binary name
  const primaryBinary = allBinaries[0] || basename(root);

  // Primary help screenshot (README hero)
  screenshots.push(
    makeScreenshot({
      id: `${toKebab(primaryBinary)}-help`,
      page: `${primaryBinary} --help`,
      alt: `${primaryBinary} CLI help output showing available commands`,
      category: 'readme',
      width: viewport.width,
      height: viewport.height,
      notes: `Run \`${primaryBinary} --help\` in a terminal. Ensure the full help text is visible including all top-level subcommands. Use an 80-column terminal width.`,
    }),
  );

  // Additional binaries
  for (const binary of allBinaries.slice(1)) {
    const id = toKebab(`${binary}-help`);
    screenshots.push(
      makeScreenshot({
        id,
        page: `${binary} --help`,
        alt: `${binary} CLI help output`,
        category: 'cli',
        width: viewport.width,
        height: viewport.height,
        notes: `Run \`${binary} --help\` in a terminal.`,
      }),
    );
  }

  // Subcommand screenshots
  const subcommands = discoverSubcommands(root);
  for (const sub of subcommands) {
    const id = toKebab(`${primaryBinary}-${sub}`);
    screenshots.push(
      makeScreenshot({
        id,
        page: `${primaryBinary} ${sub} --help`,
        alt: `${primaryBinary} ${sub} subcommand help and example output`,
        category: 'cli',
        width: viewport.width,
        height: viewport.height,
        notes: `Run \`${primaryBinary} ${sub} --help\` to show the subcommand usage. If available, also capture a successful run with sample arguments.`,
      }),
    );
  }

  // GIF: main workflow — install → first subcommand → output
  const firstSub = subcommands[0] || 'run';
  gifs.push(
    makeGif({
      id: `${toKebab(primaryBinary)}-quickstart`,
      alt: `${primaryBinary} quickstart workflow from help to first command`,
      notes: `Record the primary CLI workflow: help → ${firstSub} → output. Open a clean terminal, navigate to a temp directory, then execute the sequence.`,
      sequence: [
        {
          action: 'navigate',
          url: 'terminal',
          label: 'Open terminal',
          hold: 1000,
        },
        {
          action: 'type',
          target: 'terminal',
          label: `${primaryBinary} --help`,
          hold: 2000,
        },
        {
          action: 'type',
          target: 'terminal',
          label: `${primaryBinary} ${firstSub}`,
          hold: 3000,
        },
        {
          action: 'screenshot',
          hold: 3000,
        },
      ],
    }),
  );

  return { screenshots, gifs };
}

// ---------------------------------------------------------------------------
// Library analysis
// ---------------------------------------------------------------------------

/**
 * Enumerate example files from an `examples/` directory, returning paths
 * relative to the project root.
 * @param {string} root
 * @returns {string[]} Relative file paths
 */
function findExampleFiles(root) {
  const examplesDir = join(root, 'examples');
  if (!isDir(examplesDir)) return [];

  const exts = new Set(['.ts', '.js', '.py', '.mjs', '.cjs', '.tsx', '.jsx']);
  const files = walkFiles(examplesDir, exts);
  return files.map(f => relative(root, f));
}

/**
 * Check if the project has TypeDoc or JSDoc configuration, indicating a
 * generated API reference.
 * @param {string} root
 * @returns {boolean}
 */
function hasApiRefConfig(root) {
  const candidates = [
    'typedoc.json',
    'typedoc.config.js',
    'jsdoc.json',
    '.jsdoc.json',
    'jsdoc.config.js',
  ];
  return candidates.some(f => existsSync(join(root, f)));
}

/**
 * Derive a label from an example file path.
 * "examples/basic-usage.ts" → "Basic Usage"
 * @param {string} relPath
 * @returns {string}
 */
function exampleLabel(relPath) {
  const name = basename(relPath, extname(relPath));
  return toTitle(name);
}

/**
 * Analyse a library project and return screenshot + GIF entries.
 *
 * Strategy:
 *  1. Look for examples/ directory → each file gets an output screenshot.
 *  2. Check for TypeDoc/JSDoc config → API reference screenshot.
 *  3. Always add a "code-example" screenshot showing usage + output.
 *  4. No GIFs — library READMEs are code-focused.
 *
 * @param {string} root
 * @returns {{ screenshots: object[], gifs: object[] }}
 */
function analyzeLibrary(root) {
  const viewport = VIEWPORTS.library;
  const screenshots = [];

  const pkg = tryReadJson(join(root, 'package.json'));
  const libraryName = pkg?.name || basename(root);

  // Usage example screenshot — always included first (README hero)
  screenshots.push(
    makeScreenshot({
      id: 'usage-example',
      page: 'code-example',
      alt: `${libraryName} usage example showing import and basic API`,
      category: 'readme',
      width: viewport.width,
      height: viewport.height,
      notes:
        'Capture a code editor or terminal showing the minimal working import and a basic API call. Use syntax highlighting. Show output alongside the code if possible.',
    }),
  );

  // Example files
  const examples = findExampleFiles(root);
  for (let i = 0; i < examples.length; i++) {
    const rel = examples[i];
    const label = exampleLabel(rel);
    const id = toKebab(`example-${label}`);
    // Second example entry gets "readme" category (useful overview)
    const category = i === 0 ? 'readme' : 'features';
    screenshots.push(
      makeScreenshot({
        id,
        page: rel,
        alt: `${label} example demonstrating ${libraryName} in action`,
        category,
        width: viewport.width,
        height: viewport.height,
        notes: `Run \`node ${rel}\` (or equivalent) and capture the terminal output alongside the source code. Ensure the output demonstrates the expected result.`,
      }),
    );
  }

  // API reference screenshot if docs generator is configured
  if (hasApiRefConfig(root)) {
    screenshots.push(
      makeScreenshot({
        id: 'api-reference',
        page: 'docs/api',
        alt: `${libraryName} API reference documentation showing available functions and types`,
        category: 'features',
        width: viewport.width,
        height: viewport.height,
        notes:
          'Open the generated TypeDoc/JSDoc HTML output in a browser. Navigate to the main module or index page. Ensure function signatures and type annotations are visible.',
      }),
    );
  }

  // Libraries typically do not use GIFs — return empty
  return { screenshots, gifs: [] };
}

// ---------------------------------------------------------------------------
// Spec assembly and output
// ---------------------------------------------------------------------------

/**
 * Assemble the final screenshots.json spec from screenshots and GIF entries.
 *
 * Adds `$schema` reference and `lastUpdated` timestamp so the file is
 * immediately valid against the JSON Schema.
 *
 * @param {object[]} screenshots
 * @param {object[]} gifs
 * @returns {object} Full spec object
 */
function assembleSpec(screenshots, gifs) {
  return {
    $schema: '../../.claude/skills/managing-readmes/data-schemas/screenshots.schema.json',
    lastUpdated: new Date().toISOString().slice(0, 10),
    screenshots,
    gifs,
  };
}

/**
 * Write the spec to disk, creating parent directories as needed.
 * @param {string} outputPath - Absolute path to write
 * @param {object} spec
 */
function writeSpec(outputPath, spec) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(spec, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Validate required --type
  const VALID_TYPES = new Set(['cli', 'web', 'library', 'saas']);
  if (!options.type) {
    console.error('Error: --type is required. Use --help for usage.');
    process.exit(1);
  }
  if (!VALID_TYPES.has(options.type)) {
    console.error(`Error: Unknown type "${options.type}". Valid types: cli, web, library, saas`);
    process.exit(1);
  }

  const root = options.root ? options.root : process.cwd();

  // Verify root exists
  if (!isDir(root)) {
    console.error(`Error: Project root does not exist or is not a directory: ${root}`);
    process.exit(1);
  }

  // Run analysis
  let screenshots = [];
  let gifs = [];

  switch (options.type) {
    case 'web':
    case 'saas': {
      const result = analyzeWeb(root, options.type);
      screenshots = result.screenshots;
      gifs = result.gifs;
      break;
    }
    case 'cli': {
      const result = analyzeCli(root);
      screenshots = result.screenshots;
      gifs = result.gifs;
      break;
    }
    case 'library': {
      const result = analyzeLibrary(root);
      screenshots = result.screenshots;
      gifs = result.gifs;
      break;
    }
  }

  const spec = assembleSpec(screenshots, gifs);
  const json = JSON.stringify(spec, null, 2) + '\n';

  if (options.dryRun) {
    process.stdout.write(json);
    console.error(
      `\n[dry-run] Generated ${screenshots.length} screenshot(s) + ${gifs.length} GIF(s) for ${options.type} project`,
    );
    process.exit(0);
  }

  // Write output
  const outputRel = options.output || '.github/readme/data/screenshots.json';
  const outputPath = join(root, outputRel);
  writeSpec(outputPath, spec);

  console.log(
    `Generated ${screenshots.length} screenshot(s) + ${gifs.length} GIF(s) for ${options.type} project`,
  );
  console.log(`Written to: ${outputPath}`);
  process.exit(0);
}

main();

// ---------------------------------------------------------------------------
// Exports (for testing / programmatic use)
// ---------------------------------------------------------------------------
export {
  parseArgs,
  analyzeWeb,
  analyzeCli,
  analyzeLibrary,
  assembleSpec,
  enumerateRoutes,
  findRouteDir,
  discoverSubcommands,
  toKebab,
  toTitle,
  fileToRoute,
  routeDepth,
  makeScreenshot,
  makeGif,
};
