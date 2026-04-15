#!/usr/bin/env node
/**
 * bootstrap.js - Scaffold a .github/readme/ build system for any project
 *
 * Creates the full directory structure and seed data files needed to run the
 * managing-readmes build pipeline. Project-type seeds are opinionated starting
 * points; edit the generated files to match your actual content.
 *
 * Usage: node bootstrap.js --project-type [cli|web|library|saas] [options]
 *
 * Options:
 *   --project-type <type>  One of: cli, web, library, saas (required)
 *   --output <dir>         Target directory (default: .github/readme)
 *   --name <name>          Project name (default: from package.json or dirname)
 *   --force                Overwrite existing files (default: skip)
 *   --help, -h             Show this help message
 *
 * @example
 *   node bootstrap.js --project-type cli
 *   node bootstrap.js --project-type saas --name "My App" --output .readme-build
 *   node bootstrap.js --project-type web --force
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';


const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse process.argv into a structured options object.
 * @returns {{ projectType: string|null, output: string, name: string|null, force: boolean, help: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    projectType: null,
    output: '.github/readme',
    name: null,
    force: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--project-type':
        options.projectType = args[++i];
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--name':
        options.name = args[++i];
        break;
      case '--force':
        options.force = true;
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

function showHelp() {
  console.log(`
bootstrap.js - Scaffold a .github/readme/ README build system

Usage: node bootstrap.js --project-type <type> [options]

Options:
  --project-type <type>  Required. One of: cli, web, library, saas
  --output <dir>         Target directory relative to cwd (default: .github/readme)
  --name <name>          Project name. Derived from package.json or dirname if omitted
  --force                Overwrite files that already exist (default: skip existing)
  --help, -h             Show this help message

Examples:
  node bootstrap.js --project-type cli
  node bootstrap.js --project-type saas --name "Acme SaaS" --output .readme
  node bootstrap.js --project-type web --force
`);
}

// ---------------------------------------------------------------------------
// Project name resolution
// ---------------------------------------------------------------------------

/**
 * Walk upward from cwd looking for the nearest package.json and return its
 * name field, or fall back to the current directory name.
 * @returns {string}
 */
function deriveProjectName() {
  let dir = process.cwd();
  // Limit search depth to avoid traversing all the way to /
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
        if (pkg.name && typeof pkg.name === 'string') {
          // Strip any npm scope prefix (e.g. @scope/name -> name)
          return pkg.name.replace(/^@[^/]+\//, '');
        }
      } catch {
        // Malformed package.json — fall through
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return basename(process.cwd());
}

// ---------------------------------------------------------------------------
// Seed data definitions
// ---------------------------------------------------------------------------

const VALID_TYPES = ['cli', 'web', 'library', 'saas'];

/**
 * Return seeded features.json content for the given project type.
 * @param {'cli'|'web'|'library'|'saas'} projectType
 * @returns {object}
 */
function buildFeaturesData(projectType) {
  const seeds = {
    cli: [
      {
        category: 'Core Commands',
        items: [
          { id: 'placeholder-1', name: 'Initialize', description: 'Set up a new project with sensible defaults', highlight: true },
          { id: 'placeholder-2', name: 'Run', description: 'Execute the primary workflow', highlight: false },
          { id: 'placeholder-3', name: 'Status', description: 'Display current state and health checks', highlight: false },
        ],
      },
      {
        category: 'Configuration',
        items: [
          { id: 'placeholder-4', name: 'Config Get/Set', description: 'Read and write configuration values', highlight: false },
          { id: 'placeholder-5', name: 'Profiles', description: 'Manage multiple environment profiles', highlight: false },
        ],
      },
      {
        category: 'Output',
        items: [
          { id: 'placeholder-6', name: 'JSON output', description: 'Machine-readable output via --json flag', highlight: false },
          { id: 'placeholder-7', name: 'Verbose mode', description: 'Detailed logging with --verbose flag', highlight: false },
          { id: 'placeholder-8', name: 'Color themes', description: 'Adaptive color support for terminals', highlight: false },
        ],
      },
    ],
    web: [
      {
        category: 'User Interface',
        items: [
          { id: 'placeholder-1', name: 'Responsive layout', description: 'Adapts seamlessly to any screen size', highlight: true },
          { id: 'placeholder-2', name: 'Dark mode', description: 'System-aware dark/light theme toggle', highlight: false },
          { id: 'placeholder-3', name: 'Keyboard navigation', description: 'Full keyboard accessibility throughout', highlight: false },
        ],
      },
      {
        category: 'Data Management',
        items: [
          { id: 'placeholder-4', name: 'Real-time updates', description: 'Live data sync without page refresh', highlight: true },
          { id: 'placeholder-5', name: 'Filtering and search', description: 'Fast client-side and server-side filtering', highlight: false },
          { id: 'placeholder-6', name: 'Export', description: 'Download data in CSV, JSON, or PDF', highlight: false },
        ],
      },
      {
        category: 'Authentication',
        items: [
          { id: 'placeholder-7', name: 'OAuth providers', description: 'Sign in with GitHub, Google, and more', highlight: false },
          { id: 'placeholder-8', name: 'Role-based access', description: 'Granular permissions per resource', highlight: false },
        ],
      },
    ],
    library: [
      {
        category: 'Core API',
        items: [
          { id: 'placeholder-1', name: 'Zero dependencies', description: 'No runtime dependencies — lean and portable', highlight: true },
          { id: 'placeholder-2', name: 'TypeScript-first', description: 'Full type definitions included', highlight: true },
          { id: 'placeholder-3', name: 'Tree-shakeable', description: 'Import only what you use', highlight: false },
        ],
      },
      {
        category: 'Utilities',
        items: [
          { id: 'placeholder-4', name: 'Validation helpers', description: 'Runtime type guards and schema validation', highlight: false },
          { id: 'placeholder-5', name: 'Async utilities', description: 'Promise combinators and cancellation', highlight: false },
        ],
      },
      {
        category: 'Configuration',
        items: [
          { id: 'placeholder-6', name: 'Global defaults', description: 'Configure once, apply everywhere', highlight: false },
          { id: 'placeholder-7', name: 'Instance overrides', description: 'Per-instance options override globals', highlight: false },
        ],
      },
    ],
    saas: [
      {
        category: 'Platform',
        items: [
          { id: 'placeholder-1', name: 'Multi-tenancy', description: 'Isolated workspaces per organization', highlight: true },
          { id: 'placeholder-2', name: 'Audit logs', description: 'Immutable record of every user action', highlight: false },
          { id: 'placeholder-3', name: 'Usage analytics', description: 'Built-in dashboards and event tracking', highlight: false },
        ],
      },
      {
        category: 'Integrations',
        items: [
          { id: 'placeholder-4', name: 'REST API', description: 'Full-featured API with OpenAPI spec', highlight: true },
          { id: 'placeholder-5', name: 'Webhooks', description: 'Push events to any HTTP endpoint', highlight: false },
          { id: 'placeholder-6', name: 'SSO / SAML', description: 'Enterprise single sign-on support', highlight: false },
        ],
      },
      {
        category: 'Administration',
        items: [
          { id: 'placeholder-7', name: 'User management', description: 'Invite, suspend, and manage members', highlight: false },
          { id: 'placeholder-8', name: 'Billing portal', description: 'Self-serve subscription and invoice management', highlight: false },
        ],
      },
    ],
  };

  return { categories: seeds[projectType] };
}

/**
 * Return seeded screenshots.json content for the given project type.
 * @param {'cli'|'web'|'library'|'saas'} projectType
 * @returns {object}
 */
function buildScreenshotsData(projectType) {
  const seeds = {
    cli: {
      screenshots: [
        {
          id: 'terminal-output',
          type: 'screenshot',
          status: 'pending',
          path: 'assets/screenshots/terminal-output.png',
          alt: 'Terminal output showing main command',
          caption: 'Running the primary command',
          notes: 'Capture: run `<command>` in a clean terminal at 120x35 cols, screenshot with iTerm2 or similar',
        },
        {
          id: 'demo-workflow',
          type: 'gif',
          status: 'pending',
          path: 'assets/screenshots/demo-workflow.gif',
          alt: 'Animated demo of core workflow',
          caption: 'End-to-end workflow demo',
          notes: 'Record: use `vhs` or `asciinema` to capture init → run → status sequence',
        },
      ],
    },
    web: {
      screenshots: [
        {
          id: 'dashboard',
          type: 'screenshot',
          status: 'pending',
          path: 'assets/screenshots/dashboard.png',
          alt: 'Main dashboard view',
          caption: 'Dashboard overview',
          notes: 'Capture: logged-in state, populated with demo data, 1440px wide viewport',
        },
        {
          id: 'detail-page',
          type: 'screenshot',
          status: 'pending',
          path: 'assets/screenshots/detail-page.png',
          alt: 'Detail page showing full record',
          caption: 'Detail view',
          notes: 'Capture: representative record open, sidebar visible, 1440px viewport',
        },
        {
          id: 'quickstart-gif',
          type: 'gif',
          status: 'pending',
          path: 'assets/screenshots/quickstart.gif',
          alt: 'Animated quickstart walkthrough',
          caption: 'Get up and running in 60 seconds',
          notes: 'Record: from landing page through first meaningful action, keep under 30s at 2x speed',
        },
      ],
    },
    library: {
      screenshots: [
        {
          id: 'code-example',
          type: 'screenshot',
          status: 'pending',
          path: 'assets/screenshots/code-example.png',
          alt: 'Code snippet showing primary API usage',
          caption: 'Core API in action',
          notes: 'Capture: syntax-highlighted code block rendered in browser (carbon.now.sh or Ray.so)',
        },
      ],
    },
    saas: {
      screenshots: [
        {
          id: 'dashboard',
          type: 'screenshot',
          status: 'pending',
          path: 'assets/screenshots/dashboard.png',
          alt: 'Main application dashboard',
          caption: 'Dashboard overview',
          notes: 'Capture: tenant with representative data, 1440px viewport, hide PII',
        },
        {
          id: 'settings',
          type: 'screenshot',
          status: 'pending',
          path: 'assets/screenshots/settings.png',
          alt: 'Settings and administration panel',
          caption: 'Admin settings',
          notes: 'Capture: organization settings page, 1440px viewport',
        },
        {
          id: 'onboarding-gif',
          type: 'gif',
          status: 'pending',
          path: 'assets/screenshots/onboarding.gif',
          alt: 'Animated onboarding walkthrough',
          caption: 'Onboarding in under a minute',
          notes: 'Record: sign-up through first meaningful action, keep under 45s',
        },
      ],
    },
  };

  return seeds[projectType];
}

// ---------------------------------------------------------------------------
// Template and partial content
// ---------------------------------------------------------------------------

/**
 * Return the README.hbs template appropriate for the project type.
 * CLI templates lead with commands; web/saas lead with screenshots; library
 * leads with an installation + API example pattern.
 * @param {'cli'|'web'|'library'|'saas'} projectType
 * @param {string} projectName
 * @returns {string}
 */
function buildReadmeTemplate(projectType, projectName) {
  // All types share the same structural skeleton; the conditional blocks and
  // ordering differ to emphasize what matters most for each type.
  const commandsBlock = `
{{#if showCommands}}
## Commands

<!-- TODO: populate this section from your CLI help output -->

| Command | Description |
|---------|-------------|
| \`{{cliName}} <command>\` | <!-- TODO: describe --> |

{{/if}}`;

  const screenshotsBlock = `
{{#if showScreenshots}}
## Screenshots

{{#each screenshots}}
{{#unless (eq this.status "pending")}}
### {{this.caption}}

![{{this.alt}}]({{this.path}})

{{/unless}}
{{/each}}

{{/if}}`;

  const installBlock = `
## Installation

\`\`\`bash
# TODO: replace with actual install command
npm install {{packageName}}
\`\`\``;

  const apiBlock = `
{{#if showApiExample}}
## Usage

\`\`\`typescript
// TODO: add a minimal working example
import { /* TODO */ } from '{{packageName}}';
\`\`\`

{{/if}}`;

  const bodies = {
    cli: `{{> hero}}

${installBlock}

{{> quickstart}}

${commandsBlock}

{{#if showFeatures}}
## Features

{{> features}}

{{/if}}

${screenshotsBlock}

{{> contributing}}

{{> footer}}
`,
    web: `{{> hero}}

${screenshotsBlock}

${installBlock}

{{> quickstart}}

{{#if showFeatures}}
## Features

{{> features}}

{{/if}}

{{> contributing}}

{{> footer}}
`,
    library: `{{> hero}}

${installBlock}

${apiBlock}

{{#if showFeatures}}
## API Reference

{{> features}}

{{/if}}

{{> quickstart}}

{{> contributing}}

{{> footer}}
`,
    saas: `{{> hero}}

${screenshotsBlock}

{{> quickstart}}

{{#if showFeatures}}
## Features

{{> features}}

{{/if}}

{{> contributing}}

{{> footer}}
`,
  };

  return `{{!--
  README.hbs — main README template for ${projectName}
  Project type: ${projectType}

  Context variables expected (see data/ directory):
    projectName   string   — display name
    tagline       string   — one-line description
    packageName   string   — npm package name or CLI binary name
    cliName       string   — CLI binary (cli type only)
    version       string   — current version from data/version.json
    showFeatures  boolean  — render features section
    showScreenshots boolean — render screenshots section
    showCommands  boolean  — render commands table (cli type)
    showApiExample boolean  — render code example (library type)
    screenshots   array    — from data/screenshots.json
--}}
${bodies[projectType]}`;
}

/** Partial: hero.md */
const HERO_PARTIAL = `{{!-- hero.md partial --}}
# {{projectName}}

> {{tagline}}

<!-- TODO: add badges (CI, npm version, license) -->
<!-- Example: ![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg) -->

`;

/** Return quickstart partial appropriate for project type. */
function buildQuickstartPartial(projectType) {
  const bodies = {
    cli: `## Quickstart

\`\`\`bash
# TODO: replace with actual install + first-run commands
npm install -g <your-package>
<cli-command> init
<cli-command> --help
\`\`\`
`,
    web: `## Quickstart

\`\`\`bash
# TODO: replace with actual setup commands
git clone <repo-url>
cd <project>
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) in your browser.
`,
    library: `## Quickstart

\`\`\`bash
npm install <your-package>
\`\`\`

\`\`\`typescript
// TODO: minimal working example
import { /* TODO */ } from '<your-package>';

// TODO: show one meaningful usage
\`\`\`
`,
    saas: `## Quickstart

1. [Sign up](<!-- TODO: signup URL -->) for a free account
2. Create your first workspace
3. <!-- TODO: describe the next meaningful step -->

\`\`\`bash
# Optional: CLI or SDK quickstart
# TODO: add CLI install + auth command
\`\`\`
`,
  };

  return `{{!-- quickstart.md partial — ${projectType} type --}}
${bodies[projectType]}
`;
}

/** Partial: features.md */
const FEATURES_PARTIAL = `{{!-- features.md partial --}}
{{#each featureCategories}}
### {{this.category}}

{{#each this.items}}
- **{{this.name}}** — {{this.description}}
{{/each}}

{{/each}}
`;

/** Partial: contributing.md */
const CONTRIBUTING_PARTIAL = `{{!-- contributing.md partial --}}
## Contributing

<!-- TODO: adjust contribution workflow to match your project -->

1. Fork the repository
2. Create a feature branch: \`git checkout -b feat/your-feature\`
3. Commit your changes: \`git commit -m "feat: add your feature"\`
4. Push to the branch: \`git push origin feat/your-feature\`
5. Open a pull request

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.
`;

/** Partial: footer.md */
const FOOTER_PARTIAL = `{{!-- footer.md partial --}}
---

<!-- TODO: update license if not MIT -->
Released under the [MIT License](LICENSE).

Generated by [managing-readmes](https://github.com/anthropics/claude-code) skill.
`;

// ---------------------------------------------------------------------------
// package.json for the output directory
// ---------------------------------------------------------------------------

const OUTPUT_PACKAGE_JSON = {
  type: 'module',
  private: true,
  description: 'README build system — managed by the managing-readmes skill',
  scripts: {
    build: 'node scripts/build-readme.js',
    'build:dry': 'node scripts/build-readme.js --dry-run',
    validate: 'node scripts/validate-links.js',
    'check-screenshots': 'node scripts/check-screenshots.js',
  },
  dependencies: {
    handlebars: '^4.7',
  },
};

// ---------------------------------------------------------------------------
// File writer with skip-if-exists logic
// ---------------------------------------------------------------------------

/**
 * Write a file, optionally skipping if it already exists.
 * @param {string} filePath - Absolute or cwd-relative path
 * @param {string} content - UTF-8 content to write
 * @param {boolean} force - Overwrite if true; skip if false
 * @returns {'created'|'skipped'}
 */
function writeFile(filePath, content, force) {
  if (existsSync(filePath) && !force) {
    return 'skipped';
  }
  writeFileSync(filePath, content, 'utf8');
  return 'created';
}

// ---------------------------------------------------------------------------
// Main scaffold logic
// ---------------------------------------------------------------------------

/**
 * Scaffold the full build system directory tree.
 * @param {{ projectType: string, outputDir: string, projectName: string, force: boolean }} opts
 */
function scaffold({ projectType, outputDir, projectName, force }) {
  const created = [];
  const skipped = [];

  /**
   * Convenience: write a file and record the outcome.
   * @param {string} relPath - Path relative to outputDir
   * @param {string} content
   */
  function emit(relPath, content) {
    const abs = join(outputDir, relPath);
    const result = writeFile(abs, content, force);
    (result === 'created' ? created : skipped).push(relPath);
  }

  // 1. Create directory tree
  for (const sub of ['scripts', 'templates', 'partials', 'data']) {
    mkdirSync(join(outputDir, sub), { recursive: true });
  }

  // 2. package.json
  emit('package.json', JSON.stringify(OUTPUT_PACKAGE_JSON, null, 2) + '\n');

  // 3. templates/README.hbs
  emit('templates/README.hbs', buildReadmeTemplate(projectType, projectName));

  // 4. partials/
  emit('partials/hero.md', HERO_PARTIAL);
  emit('partials/quickstart.md', buildQuickstartPartial(projectType));
  emit('partials/features.md', FEATURES_PARTIAL);
  emit('partials/contributing.md', CONTRIBUTING_PARTIAL);
  emit('partials/footer.md', FOOTER_PARTIAL);

  // 5. data/
  emit('data/features.json', JSON.stringify(buildFeaturesData(projectType), null, 2) + '\n');
  emit('data/screenshots.json', JSON.stringify(buildScreenshotsData(projectType), null, 2) + '\n');
  emit(
    'data/version.json',
    JSON.stringify({ current: '0.1.0', releaseDate: TODAY }, null, 2) + '\n',
  );

  return { created, skipped };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs();

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  // Validate --project-type
  if (!opts.projectType) {
    console.error('Error: --project-type is required');
    showHelp();
    process.exit(1);
  }
  if (!VALID_TYPES.includes(opts.projectType)) {
    console.error(`Error: --project-type must be one of: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  const projectName = opts.name ?? deriveProjectName();
  const outputDir = resolve(process.cwd(), opts.output);

  console.log(`Bootstrapping ${opts.projectType} README build system`);
  console.log(`  Project : ${projectName}`);
  console.log(`  Output  : ${outputDir}`);
  console.log(`  Force   : ${opts.force}`);
  console.log('');

  try {
    mkdirSync(outputDir, { recursive: true });
    const { created, skipped } = scaffold({
      projectType: opts.projectType,
      outputDir,
      projectName,
      force: opts.force,
    });

    if (created.length > 0) {
      console.log('Created:');
      for (const f of created) {
        console.log(`  + ${f}`);
      }
    }

    if (skipped.length > 0) {
      console.log('');
      console.log('Skipped (already exist — use --force to overwrite):');
      for (const f of skipped) {
        console.log(`  ~ ${f}`);
      }
    }

    console.log('');
    console.log('Done. Next steps:');
    console.log(`  1. cd ${opts.output}`);
    console.log('  2. npm install          # install handlebars');
    console.log('  3. Copy build scripts from the managing-readmes skill scripts/ dir');
    console.log('  4. Edit data/ files with your real content');
    console.log('  5. npm run build        # generate README.md');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
