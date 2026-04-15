#!/usr/bin/env node
/**
 * build-readme.js - Main README assembly script
 *
 * Assembles README.md from partials and data files using Handlebars templating.
 * Loads data from <readme-dir>/data/, partials from <readme-dir>/partials/,
 * and templates from <readme-dir>/templates/.
 *
 * Usage: node build-readme.js [options]
 *
 * Options:
 *   --root <path>          Project root directory (default: cwd)
 *   --readme-dir <path>    README system dir relative to root (default: .github/readme)
 *   --version <ver>        Override version string in output
 *   --dry-run              Print to stdout instead of writing file
 *   --section <name>       Update only specific section (partial name)
 *   --help                 Show help message
 *
 * @example
 *   node build-readme.js                              # Build full README from cwd
 *   node build-readme.js --root /my/project           # Explicit root
 *   node build-readme.js --dry-run                    # Preview without writing
 *   node build-readme.js --version 0.4.0              # Override version
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';

// createRequire is used to load CJS packages (handlebars) from an ESM context
const require = createRequire(import.meta.url);

/**
 * Parse command line arguments.
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    root: null,
    readmeDir: null,
    version: null,
    dryRun: false,
    section: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root':
        options.root = args[++i];
        break;
      case '--readme-dir':
        options.readmeDir = args[++i];
        break;
      case '--version':
        options.version = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--section':
        options.section = args[++i];
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
build-readme.js - Assemble README.md from partials and data

Usage: node build-readme.js [options]

Options:
  --root <path>          Project root directory (default: cwd)
  --readme-dir <path>    README system dir relative to root (default: .github/readme)
  --version <ver>        Override version string in output
  --dry-run              Print to stdout instead of writing file
  --section <name>       Update only specific section (partial name)
  --help, -h             Show this help message

Examples:
  node build-readme.js                              # Build full README from cwd
  node build-readme.js --root /my/project           # Explicit root
  node build-readme.js --dry-run                    # Preview without writing
  node build-readme.js --version 0.4.0              # Override version
  node build-readme.js --section hero               # Build only hero section
`);
}

/**
 * Load JSON data file with error handling.
 * @param {string} filename - Name of JSON file in data directory
 * @param {string} dataDir - Absolute path to the data directory
 * @returns {Object} Parsed JSON data
 */
function loadData(filename, dataDir) {
  const filepath = join(dataDir, filename);
  try {
    const content = readFileSync(filepath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Data file not found: ${filepath}`);
    } else if (err instanceof SyntaxError) {
      console.error(`Invalid JSON in ${filename}: ${err.message}`);
    } else {
      console.error(`Error loading ${filename}: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Load and register all partials with Handlebars.
 * Loads .md files from partials/ and .hbs files from templates/ (excluding README.hbs).
 *
 * @param {Object} Handlebars - Handlebars instance
 * @param {string} readmeDir - Absolute path to the readme system directory
 * @returns {Object} Map of partial names to content
 */
function loadPartials(Handlebars, readmeDir) {
  const partialsDir = join(readmeDir, 'partials');
  const templatesDir = join(readmeDir, 'templates');
  const partials = {};

  // Load .md content partials from partials/
  if (existsSync(partialsDir)) {
    for (const file of readdirSync(partialsDir)) {
      if (!file.endsWith('.md')) continue;

      const name = basename(file, '.md');
      const filepath = join(partialsDir, file);

      try {
        const content = readFileSync(filepath, 'utf8');
        Handlebars.registerPartial(name, content);
        partials[name] = content;
      } catch (err) {
        console.error(`Error loading partial ${file}: ${err.message}`);
        process.exit(1);
      }
    }
  } else {
    console.warn(`Partials directory not found: ${partialsDir}`);
    console.warn('Creating empty partials directory...');
    mkdirSync(partialsDir, { recursive: true });
  }

  // Load .hbs structural partials from templates/ (excluding the main README.hbs)
  if (existsSync(templatesDir)) {
    for (const file of readdirSync(templatesDir)) {
      if (!file.endsWith('.hbs')) continue;
      if (file === 'README.hbs') continue;

      const name = basename(file, '.hbs');
      const filepath = join(templatesDir, file);

      try {
        const content = readFileSync(filepath, 'utf8');
        Handlebars.registerPartial(name, content);
        partials[name] = content;
      } catch (err) {
        console.error(`Error loading template partial ${file}: ${err.message}`);
        process.exit(1);
      }
    }
  }

  return partials;
}

/**
 * Register custom Handlebars helpers.
 * All helpers are intentionally generic — none are project-specific.
 *
 * @param {Object} Handlebars - Handlebars instance
 */
function registerHelpers(Handlebars) {
  // Format a date value as a human-readable string
  Handlebars.registerHelper('formatDate', function (date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  });

  // Emit the current ISO timestamp
  Handlebars.registerHelper('isoDate', function () {
    return new Date().toISOString();
  });

  // Filter array by key===value
  Handlebars.registerHelper('filter', function (array, key, value) {
    if (!Array.isArray(array)) return [];
    return array.filter((item) => item[key] === value);
  });

  // Equality check for {{#if (eq a b)}} blocks
  Handlebars.registerHelper('eq', function (a, b) {
    return a === b;
  });

  // Count items in an array
  Handlebars.registerHelper('count', function (array) {
    return Array.isArray(array) ? array.length : 0;
  });

  // Join array elements with a separator
  Handlebars.registerHelper('join', function (array, separator) {
    if (!Array.isArray(array)) return '';
    return array.join(typeof separator === 'string' ? separator : ', ');
  });

  // True when value is odd — used for alternating table row styles
  Handlebars.registerHelper('isOdd', function (value) {
    return value % 2 === 1;
  });

  // Collect every feature with highlight===true across all categories
  Handlebars.registerHelper('highlightedFeatures', function (categories) {
    if (!Array.isArray(categories)) return [];
    const highlighted = [];
    for (const category of categories) {
      if (Array.isArray(category.features)) {
        for (const feature of category.features) {
          if (feature.highlight) {
            highlighted.push({ ...feature, category: category.name });
          }
        }
      }
    }
    return highlighted;
  });

  // Filter screenshots array to a specific category, excluding pending entries
  Handlebars.registerHelper('screenshotsByCategory', function (screenshots, category) {
    if (!Array.isArray(screenshots)) return [];
    return screenshots.filter((s) => s.category === category && s.status !== 'pending');
  });

  // Sum of features across all categories
  Handlebars.registerHelper('totalFeatures', function (categories) {
    if (!Array.isArray(categories)) return 0;
    return categories.reduce((sum, cat) => sum + (cat.features?.length || 0), 0);
  });

  // True when at least one feature in the array declares a cliCommand
  Handlebars.registerHelper('hasCliCommands', function (features) {
    if (!Array.isArray(features)) return false;
    return features.some((feature) => feature.cliCommand);
  });

  // Render backtick-wrapped CLI commands from a feature array, comma-separated
  Handlebars.registerHelper('cliCommands', function (features) {
    if (!Array.isArray(features)) return '';
    return features
      .filter((feature) => feature && feature.cliCommand)
      .map((feature) => `\`${feature.cliCommand}\``)
      .join(', ');
  });
}

/**
 * Load and compile the main README.hbs template.
 *
 * @param {Object} Handlebars - Handlebars instance
 * @param {string} readmeDir - Absolute path to the readme system directory
 * @returns {Function} Compiled template function
 */
function loadTemplate(Handlebars, readmeDir) {
  const templatePath = join(readmeDir, 'templates', 'README.hbs');

  if (!existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    console.error('Please create README.hbs in the templates directory.');
    process.exit(1);
  }

  try {
    const template = readFileSync(templatePath, 'utf8');
    return Handlebars.compile(template);
  } catch (err) {
    console.error(`Error loading template: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Build the README from template and data.
 *
 * @param {Object} options - Build options
 * @param {string} readmeDir - Absolute path to the readme system directory
 * @returns {string} Rendered README content
 */
function buildReadme(options, readmeDir) {
  let Handlebars;
  try {
    Handlebars = require('handlebars');
  } catch {
    console.error('Handlebars not found. Please install it: npm install handlebars');
    process.exit(1);
  }

  const dataDir = join(readmeDir, 'data');

  console.log('Loading data files...');
  const features = loadData('features.json', dataDir);
  const screenshots = loadData('screenshots.json', dataDir);
  const version = loadData('version.json', dataDir);

  if (options.version) {
    version.current = options.version;
  }

  registerHelpers(Handlebars);

  console.log('Loading partials...');
  const partials = loadPartials(Handlebars, readmeDir);
  console.log(`  Loaded ${Object.keys(partials).length} partial(s)`);

  console.log('Compiling template...');
  const template = loadTemplate(Handlebars, readmeDir);

  const context = {
    features: features.categories,
    featureStats: features.stats,
    artifactTypes: features.artifactTypes,
    screenshots: screenshots.screenshots,
    gifs: screenshots.gifs,
    version: version.current,
    releaseDate: version.releaseDate,
    previousVersions: version.previousVersions,
    upcoming: version.upcoming,
    generated: new Date().toISOString(),
    // Convenience accessors used by standard templates
    readmeScreenshots: screenshots.screenshots.filter((s) => s.category === 'readme'),
    capturedScreenshots: screenshots.screenshots.filter((s) => s.status === 'captured'),
    pendingScreenshots: screenshots.screenshots.filter((s) => s.status === 'pending'),
  };

  console.log('Rendering README...');
  return template(context);
}

/**
 * Write the README to the project root (or print to stdout in dry-run mode).
 *
 * @param {string} content - README content
 * @param {boolean} dryRun - If true, print to stdout instead of writing
 * @param {string} projectRoot - Absolute project root path
 */
function writeReadme(content, dryRun, projectRoot) {
  if (dryRun) {
    console.log('\n--- DRY RUN OUTPUT ---\n');
    console.log(content);
    console.log('\n--- END DRY RUN ---\n');
    return;
  }

  const outputPath = join(projectRoot, 'README.md');

  try {
    writeFileSync(outputPath, content, 'utf8');
    console.log(`README.md written to ${outputPath}`);
    const lines = content.split('\n').length;
    const size = Buffer.byteLength(content, 'utf8');
    console.log(`  Lines: ${lines}`);
    console.log(`  Size: ${(size / 1024).toFixed(2)} KB`);
  } catch (err) {
    console.error(`Error writing README: ${err.message}`);
    process.exit(1);
  }
}

function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const PROJECT_ROOT = options.root || process.cwd();
  const README_DIR = join(PROJECT_ROOT, options.readmeDir || '.github/readme');

  console.log('Building README.md...\n');

  if (options.section) {
    console.warn(`Section-only build (${options.section}) not yet implemented.`);
    console.warn('Building full README instead.');
  }

  const content = buildReadme(options, README_DIR);
  writeReadme(content, options.dryRun, PROJECT_ROOT);

  console.log('\nBuild complete!');
}

main();

export { buildReadme, loadData, parseArgs };
