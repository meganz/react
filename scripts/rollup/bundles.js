'use strict';

const bundleTypes = {
  UMD_DEV: 'UMD_DEV'
};

const {
  UMD_DEV,
} = bundleTypes;

const moduleTypes = {
  // React
  ISOMORPHIC: 'ISOMORPHIC',
  // Individual renderers. They bundle the reconciler. (e.g. ReactDOM)
  RENDERER: 'RENDERER',
  // Helper packages that access specific renderer's internals. (e.g. TestUtils)
  RENDERER_UTILS: 'RENDERER_UTILS',
  // Standalone reconciler for third-party renderers.
  RECONCILER: 'RECONCILER',
};

const {ISOMORPHIC, RENDERER, RENDERER_UTILS, RECONCILER} = moduleTypes;

const bundles = [
  /******* Isomorphic *******/
  {
    bundleTypes: [
      UMD_DEV,
    ],
    moduleType: ISOMORPHIC,
    entry: 'react',
    global: 'React',
    minifyWithProdErrorCodes: false,
    wrapWithModuleBoundaries: true,
    externals: [],
  },

  /******* React DOM *******/
  {
    bundleTypes: [
      UMD_DEV,
    ],
    moduleType: RENDERER,
    entry: 'react-dom',
    global: 'ReactDOM',
    minifyWithProdErrorCodes: true,
    wrapWithModuleBoundaries: true,
    externals: ['react'],
  },
];

// Based on deep-freeze by substack (public domain)
function deepFreeze(o) {
  Object.freeze(o);
  Object.getOwnPropertyNames(o).forEach(function(prop) {
    if (
      o[prop] !== null &&
      (typeof o[prop] === 'object' || typeof o[prop] === 'function') &&
      !Object.isFrozen(o[prop])
    ) {
      deepFreeze(o[prop]);
    }
  });
  return o;
}

// Don't accidentally mutate config as part of the build
deepFreeze(bundles);
deepFreeze(bundleTypes);
deepFreeze(moduleTypes);

function getFilename(bundle, bundleType) {
  let name = bundle.name || bundle.entry;
  // we do this to replace / to -, for react-dom/server
  name = name.replace('/index.', '.').replace('/', '-');
  switch (bundleType) {
    case UMD_DEV:
      return `${name}.js`;
  }
}

module.exports = {
  bundleTypes,
  moduleTypes,
  bundles,
  getFilename,
};
