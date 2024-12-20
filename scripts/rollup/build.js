'use strict';

const rollup = require('rollup');
const babel = require('rollup-plugin-babel');
const closure = require('./plugins/closure-plugin');
const commonjs = require('rollup-plugin-commonjs');
const prettier = require('rollup-plugin-prettier');
const replace = require('rollup-plugin-replace');
const stripBanner = require('rollup-plugin-strip-banner');
const chalk = require('chalk');
const resolve = require('rollup-plugin-node-resolve');
const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2));
const Modules = require('./modules');
const Bundles = require('./bundles');
const Stats = require('./stats');
const Sync = require('./sync');
const sizes = require('./plugins/sizes-plugin');
const useForks = require('./plugins/use-forks-plugin');
const stripUnusedImports = require('./plugins/strip-unused-imports');
const Packaging = require('./packaging');
const {asyncRimRaf} = require('./utils');
const codeFrame = require('babel-code-frame');
const Wrappers = require('./wrappers');

// Errors in promises should be fatal.
let loggedErrors = new Set();
process.on('unhandledRejection', err => {
  if (loggedErrors.has(err)) {
    // No need to print it twice.
    process.exit(1);
  }
  throw err;
});

const {
  UMD_DEV
} = Bundles.bundleTypes;

const {getFilename} = Bundles;

function parseRequestedNames(names, toCase) {
  let result = [];
  for (let i = 0; i < names.length; i++) {
    let splitNames = names[i].split(',');
    for (let j = 0; j < splitNames.length; j++) {
      let name = splitNames[j].trim();
      if (!name) {
        continue;
      }
      if (toCase === 'uppercase') {
        name = name.toUpperCase();
      } else if (toCase === 'lowercase') {
        name = name.toLowerCase();
      }
      result.push(name);
    }
  }
  return result;
}

const requestedBundleTypes = argv.type
  ? parseRequestedNames([argv.type], 'uppercase')
  : [];
const requestedBundleNames = parseRequestedNames(argv._, 'lowercase');
const forcePrettyOutput = argv.pretty;
const isWatchMode = argv.watch;

const closureOptions = {
  compilation_level: 'SIMPLE',
  language_in: 'ECMASCRIPT_2018',
  language_out: 'ECMASCRIPT_2018',
  env: 'CUSTOM',
  warning_level: 'QUIET',
  apply_input_source_maps: false,
  use_types_for_optimization: false,
  process_common_js_modules: false,
  rewrite_polyfills: false,
  inject_libraries: false,
};

// Non-ES2015 stuff applied before closure compiler.
const babelPlugins = [
  // These plugins filter out non-ES2015.
  '@babel/plugin-transform-flow-strip-types',
  'syntax-trailing-function-commas',
];

function getBabelConfig(
  updateBabelOptions,
  bundleType,
  packageName,
  externals,
  isDevelopment,
  bundle
) {
  const canAccessReactObject =
    packageName === 'react' || externals.indexOf('react') !== -1;
  let options = {
    exclude: '/**/node_modules/**',
    babelrc: false,
    configFile: false,
    presets: [],
    plugins: [...babelPlugins],
  };
  if (isDevelopment) {
    options.plugins.push(
      // Turn console.error/warn() into a custom wrapper
      [
        require('../babel/transform-replace-console-calls'),
        {
          shouldError: !canAccessReactObject,
        },
      ]
    );
  }
  if (updateBabelOptions) {
    options = updateBabelOptions(options);
  }

  return options;
}

function getRollupOutputOptions(
  outputPath,
  format,
  globals,
  globalName,
  bundleType
) {
  return {
    file: outputPath,
    format,
    globals,
    compact: true,
    validate: true,
    interop: 'compat',
    name: globalName,
    sourcemap: false,
    esModule: false,
    generatedCode: {
      symbols: false,
      preset: 'es2015',
      constBindings: true,
      arrowFunctions: true,
      objectShorthand: true
    }
  };
}

function getFormat(bundleType) {
  switch (bundleType) {
    case UMD_DEV:
      return `umd`;
  }
}

function forbidFBJSImports() {
  return {
    name: 'forbidFBJSImports',
    resolveId(importee, importer) {
      if (/^fbjs\//.test(importee)) {
        throw new Error(
          `Don't import ${importee} (found in ${importer}). ` +
            `Use the utilities in packages/shared/ instead.`
        );
      }
    },
  };
}

function getPlugins(
  entry,
  externals,
  updateBabelOptions,
  filename,
  packageName,
  bundleType,
  globalName,
  moduleType,
  pureExternalModules,
  bundle
) {
  const forks = Modules.getForks(bundleType, entry, moduleType, bundle);
  const isUMDBundle = true;
  const shouldStayReadable = true;
  return [
    // Shim any modules that need forking in this environment.
    useForks(forks),
    // Ensure we don't try to bundle any fbjs modules.
    forbidFBJSImports(),
    // Use Node resolution mechanism.
    resolve({
      skip: externals,
    }),
    // Remove license headers from individual modules
    stripBanner({
      exclude: 'node_modules/**/*',
    }),
    // Compile to ES2015.
    babel(
      getBabelConfig(
        updateBabelOptions,
        bundleType,
        packageName,
        externals,
        true,
        bundle
      )
    ),
    // Remove 'use strict' from individual source files.
    {
      transform(source) {
        return source.replace(/['"]use strict["']/g, '');
      },
    },
    // Turn __DEV__ and process.env checks into constants.
    replace({
      __DEV__: 'false',
      __PROFILE__: 'false',
      __UMD__: 'true',
      __EXPERIMENTAL__: false,
      // Enable forked reconciler.
      // NOTE: I did not put much thought into how to configure this.
      __VARIANT__: bundle.enableNewReconciler === true,
    }),
    // Apply dead code elimination and/or minification.
      closure(
        Object.assign({}, closureOptions, {
          // Don't let it create global variables in the browser.
          // https://github.com/facebook/react/issues/10909
          assume_function_wrapper: !isUMDBundle,
          renaming: !shouldStayReadable,
        })
      ),
    // HACK to work around the fact that Rollup isn't removing unused, pure-module imports.
    // Note that this plugin must be called after closure applies DCE.
    stripUnusedImports(pureExternalModules),
    // Add the whitespace back if necessary.
    shouldStayReadable &&
      prettier({
        parser: 'babel',
        singleQuote: false,
        trailingComma: 'none',
        bracketSpacing: true,
      }),
    // License and haste headers, top-level `if` blocks.
    {
      renderChunk(source) {
        return Wrappers.wrapBundle(
          source,
          bundleType,
          globalName,
          filename,
          moduleType,
          bundle.wrapWithModuleBoundaries
        );
      },
    },
    // Record bundle size.
    sizes({
      getSize: (size, gzip) => {
        const currentSizes = Stats.currentBuildResults.bundleSizes;
        const recordIndex = currentSizes.findIndex(
          record =>
            record.filename === filename && record.bundleType === bundleType
        );
        const index = recordIndex !== -1 ? recordIndex : currentSizes.length;
        currentSizes[index] = {
          filename,
          bundleType,
          packageName,
          size,
          gzip,
        };
      },
    }),
  ].filter(Boolean);
}

function shouldSkipBundle(bundle, bundleType) {
  const shouldSkipBundleType = bundle.bundleTypes.indexOf(bundleType) === -1;
  if (shouldSkipBundleType) {
    return true;
  }
  if (requestedBundleTypes.length > 0) {
    const isAskingForDifferentType = requestedBundleTypes.every(
      requestedType => bundleType.indexOf(requestedType) === -1
    );
    if (isAskingForDifferentType) {
      return true;
    }
  }
  if (requestedBundleNames.length > 0) {
    // If the name ends with `something/index` we only match if the
    // entry ends in something. Such as `react-dom/index` only matches
    // `react-dom` but not `react-dom/server`. Everything else is fuzzy
    // search.
    const entryLowerCase = bundle.entry.toLowerCase() + '/index.js';
    const isAskingForDifferentNames = requestedBundleNames.every(
      requestedName => {
        const matchEntry = entryLowerCase.indexOf(requestedName) !== -1;
        if (!bundle.name) {
          return !matchEntry;
        }
        const matchName =
          bundle.name.toLowerCase().indexOf(requestedName) !== -1;
        return !matchEntry && !matchName;
      }
    );
    if (isAskingForDifferentNames) {
      return true;
    }
  }
  return false;
}

async function createBundle(bundle, bundleType) {
  if (shouldSkipBundle(bundle, bundleType)) {
    return;
  }

  const filename = getFilename(bundle, bundleType);
  const logKey =
    chalk.white.bold(filename) + chalk.dim(` (${bundleType.toLowerCase()})`);
  const format = getFormat(bundleType);
  const packageName = Packaging.getPackageName(bundle.entry);

  let resolvedEntry = require.resolve(bundle.entry);

  const shouldBundleDependencies = true;
  const peerGlobals = Modules.getPeerGlobals(bundle.externals, bundleType);
  let externals = Object.keys(peerGlobals);
  if (!shouldBundleDependencies) {
    const deps = Modules.getDependencies(bundleType, bundle.entry);
    externals = externals.concat(deps);
  }

  const importSideEffects = Modules.getImportSideEffects();
  const pureExternalModules = Object.keys(importSideEffects).filter(
    module => !importSideEffects[module]
  );

  const rollupConfig = {
    input: resolvedEntry,
    treeshake: {
      pureExternalModules,
    },
    external(id) {
      const containsThisModule = pkg => id === pkg || id.startsWith(pkg + '/');
      const isProvidedByDependency = externals.some(containsThisModule);
      if (!shouldBundleDependencies && isProvidedByDependency) {
        if (id.indexOf('/src/') !== -1) {
          throw Error(
            'You are trying to import ' +
              id +
              ' but ' +
              externals.find(containsThisModule) +
              ' is one of npm dependencies, ' +
              'so it will not contain that source file. You probably want ' +
              'to create a new bundle entry point for it instead.'
          );
        }
        return true;
      }
      return !!peerGlobals[id];
    },
    onwarn: handleRollupWarning,
    plugins: getPlugins(
      bundle.entry,
      externals,
      bundle.babel,
      filename,
      packageName,
      bundleType,
      bundle.global,
      bundle.moduleType,
      pureExternalModules,
      bundle
    ),
    output: {
      externalLiveBindings: false,
      freeze: false,
      interop: false,
      esModule: false,
    },
  };
  const mainOutputPath = Packaging.getBundleOutputPath(
    bundleType,
    filename,
    packageName
  );
  const rollupOutputOptions = getRollupOutputOptions(
    mainOutputPath,
    format,
    peerGlobals,
    bundle.global,
    bundleType
  );

  if (isWatchMode) {
    rollupConfig.output = [rollupOutputOptions];
    const watcher = rollup.watch(rollupConfig);
    watcher.on('event', async event => {
      switch (event.code) {
        case 'BUNDLE_START':
          console.log(`${chalk.bgYellow.black(' BUILDING ')} ${logKey}`);
          break;
        case 'BUNDLE_END':
          console.log(`${chalk.bgGreen.black(' COMPLETE ')} ${logKey}\n`);
          break;
        case 'ERROR':
        case 'FATAL':
          console.log(`${chalk.bgRed.black(' OH NOES! ')} ${logKey}\n`);
          handleRollupError(event.error);
          break;
      }
    });
  } else {
    console.log(`${chalk.bgYellow.black(' BUILDING ')} ${logKey}`);
    try {
      const result = await rollup.rollup(rollupConfig);
      await result.write(rollupOutputOptions);
    } catch (error) {
      console.log(`${chalk.bgRed.black(' OH NOES! ')} ${logKey}\n`);
      handleRollupError(error);
      throw error;
    }
    console.log(`${chalk.bgGreen.black(' COMPLETE ')} ${logKey}\n`);
  }
}

function handleRollupWarning(warning) {
  if (warning.code === 'UNUSED_EXTERNAL_IMPORT') {
    const match = warning.message.match(/external module '([^']+)'/);
    if (!match || typeof match[1] !== 'string') {
      throw new Error(
        'Could not parse a Rollup warning. ' + 'Fix this method.'
      );
    }
    const importSideEffects = Modules.getImportSideEffects();
    const externalModule = match[1];
    if (typeof importSideEffects[externalModule] !== 'boolean') {
      throw new Error(
        'An external module "' +
          externalModule +
          '" is used in a DEV-only code path ' +
          'but we do not know if it is safe to omit an unused require() to it in production. ' +
          'Please add it to the `importSideEffects` list in `scripts/rollup/modules.js`.'
      );
    }
    // Don't warn. We will remove side effectless require() in a later pass.
    return;
  }

  if (warning.code === 'CIRCULAR_DEPENDENCY') {
    // Ignored
  } else if (typeof warning.code === 'string') {
    // This is a warning coming from Rollup itself.
    // These tend to be important (e.g. clashes in namespaced exports)
    // so we'll fail the build on any of them.
    console.error();
    console.error(warning.message || warning);
    console.error();
    process.exit(1);
  } else {
    // The warning is from one of the plugins.
    // Maybe it's not important, so just print it.
    console.warn(warning.message || warning);
  }
}

function handleRollupError(error) {
  loggedErrors.add(error);
  if (!error.code) {
    console.error(error);
    return;
  }
  console.error(
    `\x1b[31m-- ${error.code}${error.plugin ? ` (${error.plugin})` : ''} --`
  );
  console.error(error.stack);
  if (error.loc && error.loc.file) {
    const {file, line, column} = error.loc;
    // This looks like an error from Rollup, e.g. missing export.
    // We'll use the accurate line numbers provided by Rollup but
    // use Babel code frame because it looks nicer.
    const rawLines = fs.readFileSync(file, 'utf-8');
    // column + 1 is required due to rollup counting column start position from 0
    // whereas babel-code-frame counts from 1
    const frame = codeFrame(rawLines, line, column + 1, {
      highlightCode: true,
    });
    console.error(frame);
  } else if (error.codeFrame) {
    // This looks like an error from a plugin (e.g. Babel).
    // In this case we'll resort to displaying the provided code frame
    // because we can't be sure the reported location is accurate.
    console.error(error.codeFrame);
  }
}

async function buildEverything() {
  if (!argv['unsafe-partial']) {
    await asyncRimRaf('build');
  }

  // Run them serially for better console output
  // and to avoid any potential race conditions.

  let bundles = [];
  // eslint-disable-next-line no-for-of-loops/no-for-of-loops
  for (const bundle of Bundles.bundles) {
    bundles.push(
      [bundle, UMD_DEV]
    );
  }

  if (process.env.CIRCLE_NODE_TOTAL) {
    // In CI, parallelize bundles across multiple tasks.
    const nodeTotal = parseInt(process.env.CIRCLE_NODE_TOTAL, 10);
    const nodeIndex = parseInt(process.env.CIRCLE_NODE_INDEX, 10);
    bundles = bundles.filter((_, i) => i % nodeTotal === nodeIndex);
  }

  // eslint-disable-next-line no-for-of-loops/no-for-of-loops
  for (const [bundle, bundleType] of bundles) {
    await createBundle(bundle, bundleType);
  }

  console.log(Stats.printResults());
  if (!forcePrettyOutput) {
    Stats.saveResults();
  }
}

buildEverything();
