"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getWatchHandler = getWatchHandler;
exports.regenerateDeclarations = void 0;
function _ctxShared() {
  const data = require("expo-router/_ctx-shared");
  _ctxShared = function () {
    return data;
  };
  return data;
}
function _nodeFs() {
  const data = _interopRequireDefault(require("node:fs"));
  _nodeFs = function () {
    return data;
  };
  return data;
}
function _nodePath() {
  const data = _interopRequireDefault(require("node:path"));
  _nodePath = function () {
    return data;
  };
  return data;
}
function _generate() {
  const data = require("./generate");
  _generate = function () {
    return data;
  };
  return data;
}
function _matchers() {
  const data = require("../matchers");
  _matchers = function () {
    return data;
  };
  return data;
}
function _requireContextPonyfill() {
  const data = _interopRequireDefault(require("../testing-library/require-context-ponyfill"));
  _requireContextPonyfill = function () {
    return data;
  };
  return data;
}
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
const defaultCtx = (0, _requireContextPonyfill().default)(process.env.EXPO_ROUTER_APP_ROOT, true, _ctxShared().EXPO_ROUTER_CTX_IGNORE);
/**
 * Generate a Metro watch handler that regenerates the typed routes declaration file
 */
function getWatchHandler(outputDir, {
  ctx = defaultCtx,
  regenerateFn = regenerateDeclarations
} = {} // Exposed for testing
) {
  const routeFiles = new Set(ctx.keys().filter(key => (0, _matchers().isTypedRoute)(key)));
  return async function callback({
    filePath,
    type
  }) {
    // Sanity check that we are in an Expo Router project
    if (!process.env.EXPO_ROUTER_APP_ROOT) return;
    let shouldRegenerate = false;
    let relativePath = _nodePath().default.relative(process.env.EXPO_ROUTER_APP_ROOT, filePath);
    const isInsideAppRoot = !relativePath.startsWith('../');
    const basename = _nodePath().default.basename(relativePath);
    if (!isInsideAppRoot) return;

    // require.context paths always start with './' when relative to the root
    relativePath = `./${relativePath}`;
    if (type === 'delete') {
      ctx.__delete(relativePath);
      if (routeFiles.has(relativePath)) {
        routeFiles.delete(relativePath);
        shouldRegenerate = true;
      }
    } else if (type === 'add') {
      ctx.__add(relativePath);
      if ((0, _matchers().isTypedRoute)(basename)) {
        routeFiles.add(relativePath);
        shouldRegenerate = true;
      }
    } else {
      shouldRegenerate = routeFiles.has(relativePath);
    }
    if (shouldRegenerate) {
      regenerateFn(outputDir, ctx);
    }
  };
}

/**
 * A throttled function that regenerates the typed routes declaration file
 */
const regenerateDeclarations = exports.regenerateDeclarations = throttle((outputDir, ctx = defaultCtx) => {
  const file = (0, _generate().getTypedRoutesDeclarationFile)(ctx);
  if (!file) return;
  _nodeFs().default.writeFileSync(_nodePath().default.resolve(outputDir, './router.d.ts'), file);
}, 100);

/**
 * Throttles a function to only run once every `internal` milliseconds.
 * If called while waiting, it will run again after the timer has elapsed.
 */
function throttle(fn, interval) {
  let timerId;
  let shouldRunAgain = false;
  return function run(...args) {
    if (timerId) {
      shouldRunAgain = true;
    } else {
      fn(...args);
      timerId = setTimeout(() => {
        timerId = null; // reset the timer so next call will be executed
        if (shouldRunAgain) {
          shouldRunAgain = false;
          run(...args); // call the function again
        }
      }, interval);
    }
  };
}
//# sourceMappingURL=index.js.map