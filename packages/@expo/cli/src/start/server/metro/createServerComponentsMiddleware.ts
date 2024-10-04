/**
 * Copyright © 2022 650 Industries.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { SerialAsset } from '@expo/metro-config/build/serializer/serializerAssets';
import { getRscMiddleware } from '@expo/server/build/middleware/rsc';
import assert from 'assert';
import path from 'path';

import { logMetroError } from './metroErrorInterface';
import { stripAnsi } from '../../../utils/ansi';
import { memoize } from '../../../utils/fn';
import { streamToStringAsync } from '../../../utils/stream';

import {
  createBuiltinAPIRequestHandler,
  winterNext,
} from '../middleware/createBuiltinAPIRequestHandler';
import { createBundleUrlSearchParams, ExpoMetroOptions } from '../middleware/metroOptions';
import { getMetroServerRoot } from '@expo/config/paths';
import { ExportAssetMap } from '../../../export/saveAssets';

const debug = require('debug')('expo:rsc') as typeof console.log;

type SSRLoadModuleArtifactsFunc = (
  filePath: string,
  specificOptions?: Partial<ExpoMetroOptions>
) => Promise<{ artifacts: SerialAsset[]; src: string }>;

type SSRLoadModuleFunc = <T extends Record<string, any>>(
  filePath: string,
  specificOptions?: Partial<ExpoMetroOptions>,
  extras?: { hot?: boolean }
) => Promise<T>;

const getMetroServerRootMemo = memoize(getMetroServerRoot);

export function createServerComponentsMiddleware(
  projectRoot: string,
  {
    rscPath,
    instanceMetroOptions,
    ssrLoadModule,
    ssrLoadModuleArtifacts,
    getServerUrl,
    getStaticScriptUrl,
  }: {
    rscPath: string;
    instanceMetroOptions: Partial<ExpoMetroOptions>;
    ssrLoadModule: SSRLoadModuleFunc;
    ssrLoadModuleArtifacts: SSRLoadModuleArtifactsFunc;
    getServerUrl: () => string;
    getStaticScriptUrl: () => string;
  }
) {
  const serverRoot = getMetroServerRootMemo(projectRoot);

  globalThis.__metro_node_chunk_load__ = async (chunk) => {
    console.log('[SSR]__metro_node_chunk_load__:', chunk);

    const url = new URL(chunk, 'http://localhost:0');
    const getStringParam = (key: string) => {
      const param = url.searchParams.get(key);
      if (Array.isArray(param)) {
        throw new Error(`Expected single value for ${key}`);
      }
      return param;
    };

    let pathname = url.pathname;
    if (pathname.endsWith('.bundle')) {
      pathname = pathname.slice(0, -'.bundle'.length);
    }

    const options = {
      mode: (getStringParam('dev') ?? 'true') === 'true' ? 'development' : 'production',
      minify: (getStringParam('minify') ?? 'false') === 'true',
      lazy: (getStringParam('lazy') ?? 'false') === 'true',
      routerRoot: getStringParam('transform.routerRoot') ?? 'app',
      /** Enable React compiler support in Babel. */
      // reactCompiler: boolean;
      // baseUrl?: string;
      isExporting: (getStringParam('resolver.exporting') ?? 'false') === 'true',
      /** Is bundling a DOM Component ("use dom"). */
      // inlineSourceMap?: boolean;
      // clientBoundaries?: string[];
      // splitChunks?: boolean;
      // usedExports?: boolean;
      /** Enable optimized bundling (required for tree shaking). */
      // optimize?: boolean;

      environment: 'node', // getStringParam('transform.environment') ?? 'node',
      platform: url.searchParams.get('platform') ?? 'web',
    } as const;

    // console.log('[SSR] load:', options);

    console.log(
      await ssrLoadModule(path.join(serverRoot, pathname), {
        ...options,

        skipRunningSsr: true,
      })
    );
  };

  // globalThis.__webpack_require__ = (id) => {
  //   console.log('[SSR]__webpack_require__:', id);

  //   //   return null;
  //   return globalThis[`${__METRO_GLOBAL_PREFIX__}__r`](id);
  // };

  const htmlMiddleware = {
    async GET(req: Request): Promise<Response> {
      // TODO: Add this from prod branch
      // const getSsrConfig = () => ({ input: '', searchParams: new URLSearchParams(), body: new ReadableStream() });

      const url = getFullUrl(req.url);

      const platform =
        url.searchParams.get('platform') ?? req.headers.get('expo-platform') ?? 'web';
      if (typeof platform !== 'string' || !platform || platform !== 'web') {
        throw winterNext();
      }

      // HACK: Execution order matters since the module names collide (maybe)
      const entries = await getExpoRouterRscEntriesGetterAsync({ platform });

      console.log('GET', url.pathname, platform);
      const { renderHtml } = await getHtmlRendererAsync(platform);

      const { getSsrConfig } = await getRscRendererAsync(platform);

      console.log('GET.getSsrConfig', getSsrConfig);
      const htmlHead = `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />`;
      // <meta name="generator" content="expo" />

      const readable = await renderHtml({
        // config:,
        pathname: url.pathname,
        searchParams: url.searchParams,
        htmlHead,
        scriptUrl: getStaticScriptUrl(),

        // renderRscForHtml: async (input, searchParams) => {
        //   ctx.req.url.pathname =
        //     config.basePath + config.rscPath + '/' + encodeInput(input);
        //   ctx.req.url.search = searchParams.toString();
        //   const args: RenderRscArgs = {
        //     config,
        //     input,
        //     searchParams: ctx.req.url.searchParams,
        //     method: 'GET',
        //     context: ctx.context,
        //     body: ctx.req.body,
        //     contentType: '',
        //   };
        //   const readable = await (devServer
        //     ? renderRsc(args, {
        //         isDev: true,
        //         loadServerModuleRsc: devServer.loadServerModuleRsc,
        //         resolveClientEntry: devServer.resolveClientEntry,
        //         entries: await devServer.loadEntriesDev(config),
        //       })
        //     : renderRsc(args, { isDev: false, entries }));
        //   return readable;
        // },
        isExporting: false,
        serverRoot,
        async renderRscForHtml(input, searchParams) {
          console.log('SSR -> renderRscForHtml', input, searchParams);
          return await renderRscToReadableStream({
            input,
            decodedBody: searchParams.get('x-expo-params'),
            method: 'GET',
            contentType: '',
            platform,
            // ...args,
            body: req.body ?? undefined,
          });
        },
        async loadModule(id) {
          // TODO: Implement this
          console.warn('SSR -> loadModule not implemented', id);
        },

        resolveClientEntry: getResolveClientEntry({ platform, environment: 'node' }),
        getSsrConfigForHtml: async (pathname, searchParams) => {
          return getSsrConfig(
            { config: {}, pathname, searchParams },
            {
              entries,
              resolveClientEntry: getResolveClientEntry({ platform }),
            }
          );
        },
        // {
        //   isDev: true,
        //   loadServerModuleRsc: devServer.loadServerModuleRsc,
        //   resolveClientEntry: devServer.resolveClientEntry,
        //   entries: entriesDev!,
        // },
      });

      console.log('GET.renderHtml', readable);
      if (readable) {
        return new Response(readable, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
        });
      }

      // TODO: Wrap with Metro error handling...

      throw winterNext();
    },
  };

  const rscMiddleware = getRscMiddleware({
    config: {},
    // Disabled in development
    baseUrl: '',
    rscPath,
    onError: console.error,
    renderRsc: async (args) => {
      // Dev server-only implementation.
      try {
        return await renderRscToReadableStream({
          ...args,
          body: args.body!,
        });
      } catch (error: any) {
        // If you get a codeFrame error during SSR like when using a Class component in React Server Components, then this
        // will throw with:
        // {
        //   rawObject: {
        //     type: 'TransformError',
        //     lineNumber: 0,
        //     errors: [ [Object] ],
        //     name: 'SyntaxError',
        //     message: '...',
        //   }
        // }

        // TODO: Revisit all error handling now that we do direct metro bundling...
        await logMetroError(projectRoot, { error });

        const sanitizedServerMessage = stripAnsi(error.message) ?? error.message;
        throw new Response(sanitizedServerMessage, {
          status: 500,
          headers: {
            'Content-Type': 'text/plain',
          },
        });
      }
    },
  });

  let rscPathPrefix = rscPath;
  if (rscPathPrefix !== '/') {
    rscPathPrefix += '/';
  }

  async function getExpoRouterClientReferencesAsync(
    { platform }: { platform: string },
    files: ExportAssetMap
  ): Promise<{ reactClientReferences: string[]; cssModules: SerialAsset[] }> {
    const contents = await ssrLoadModuleArtifacts(
      'expo-router/build/rsc/router/expo-definedRouter',
      {
        environment: 'react-server',
        platform,
      }
    );

    // Extract the global CSS modules that are imported from the router.
    // These will be injected in the head of the HTML document for the website.
    const cssModules = contents.artifacts.filter((a) => a.type.startsWith('css'));

    const reactClientReferences = contents.artifacts
      .filter((a) => a.type === 'js')[0]
      .metadata.reactClientReferences?.map((ref) => fileURLToFilePath(ref));

    if (!reactClientReferences) {
      throw new Error(
        'Static client references were not returned from the Metro SSR bundle for definedRouter'
      );
    }
    debug('React client boundaries:', reactClientReferences);

    // While we're here, export the router for the server to dynamically render RSC.
    files.set(`_expo/rsc/${platform}/router.js`, {
      targetDomain: 'server',
      contents: wrapBundle(contents.src),
    });

    return { reactClientReferences, cssModules };
  }

  // async function getExpoRouterRscEntriesNodeGetterAsync({ platform }: { platform: string }) {
  //   return ssrLoadModule<typeof import('expo-router/build/rsc/router/expo-definedRouter')>(
  //     'expo-router/build/rsc/router/expo-definedRouter',
  //     {
  //       environment: 'node',
  //       platform,
  //     },
  //     {
  //       hot: false,
  //     }
  //   );
  // }

  async function getExpoRouterRscEntriesGetterAsync({ platform }: { platform: string }) {
    return ssrLoadModule<typeof import('expo-router/build/rsc/router/expo-definedRouter')>(
      'expo-router/build/rsc/router/expo-definedRouter',
      {
        environment: 'react-server',
        platform,
      },
      {
        hot: true,
      }
    );
  }

  function getResolveClientEntry(context: {
    platform: string;
    engine?: 'hermes' | null;
    ssrManifest?: Map<string, string>;
    environment?: 'node';
  }) {
    const serverRoot = getMetroServerRootMemo(projectRoot);

    const {
      mode,
      minify = false,
      isExporting,
      baseUrl,
      routerRoot,
      asyncRoutes,
      preserveEnvVars,
      reactCompiler,
      lazy,
    } = instanceMetroOptions;

    assert(
      isExporting != null &&
        baseUrl != null &&
        mode != null &&
        routerRoot != null &&
        asyncRoutes != null,
      `The server must be started. (isExporting: ${isExporting}, baseUrl: ${baseUrl}, mode: ${mode}, routerRoot: ${routerRoot}, asyncRoutes: ${asyncRoutes})`
    );

    return (file: string) => {
      if (isExporting) {
        assert(context.ssrManifest, 'SSR manifest must exist when exporting');
        let relativeFilePath = path.relative(serverRoot, file);

        if (context.environment === 'node') {
          // Use prefixed modules in SSR space.
          relativeFilePath = 'node:' + relativeFilePath;
        }

        assert(
          context.ssrManifest.has(relativeFilePath),
          `SSR manifest is missing client boundary "${relativeFilePath}"`
        );

        const chunk = context.ssrManifest.get(relativeFilePath);

        return {
          id: relativeFilePath,
          chunks: chunk != null ? [chunk] : [],
        };
      }

      const searchParams = createBundleUrlSearchParams({
        mainModuleName: '',
        platform: context.platform,
        mode,
        minify,
        lazy,
        preserveEnvVars,
        asyncRoutes,
        baseUrl,
        routerRoot,
        isExporting,
        reactCompiler: !!reactCompiler,
        engine: context.engine ?? undefined,
        bytecode: false,
        clientBoundaries: [],
        inlineSourceMap: false,
        environment: context.environment,
      });

      searchParams.set('dev', String(__DEV__));
      searchParams.set('resolver.clientboundary', String(true));
      searchParams.set('modulesOnly', String(true));
      searchParams.set('runModule', String(false));

      const clientReferenceUrl = new URL(getServerUrl());

      // TICKLE: Handshake 1
      searchParams.set('xRSC', '1');

      clientReferenceUrl.search = searchParams.toString();

      const filePath = file.startsWith('file://') ? fileURLToFilePath(file) : file;
      let relativeFilePath = path.relative(serverRoot, filePath);

      clientReferenceUrl.pathname = relativeFilePath;

      // Ensure url.pathname ends with '.bundle'
      if (!clientReferenceUrl.pathname.endsWith('.bundle')) {
        clientReferenceUrl.pathname += '.bundle';
      }

      // Return relative URLs to help Android fetch from wherever it was loaded from since it doesn't support localhost.
      const id = clientReferenceUrl.pathname + clientReferenceUrl.search;

      if (context.environment === 'node') {
        // Use prefixed modules in SSR space.
        relativeFilePath = 'node:' + relativeFilePath;
      }

      return { id: relativeFilePath, chunks: [id] };
    };
  }

  // const htmlRendererCache = new Map<string, typeof import('expo-router/src/rsc/html-renderer')>();

  async function getHtmlRendererAsync(platform: string) {
    // return require('expo-router/build/rsc/html-renderer');
    // // NOTE(EvanBacon): We memoize this now that there's a persistent server storage cache for Server Actions.
    // if (htmlRendererCache.has(platform)) {
    //   return htmlRendererCache.get(platform)!;
    // }

    const renderer = await ssrLoadModule<typeof import('expo-router/src/rsc/html-renderer')>(
      'expo-router/build/rsc/html-renderer',
      {
        environment: 'node',
        platform,
      }
    );

    // htmlRendererCache.set(platform, renderer);
    return renderer;
  }

  const rscRendererCache = new Map<string, typeof import('expo-router/src/rsc/rsc-renderer')>();

  async function getRscRendererAsync(platform: string) {
    // NOTE(EvanBacon): We memoize this now that there's a persistent server storage cache for Server Actions.
    if (rscRendererCache.has(platform)) {
      return rscRendererCache.get(platform)!;
    }

    // TODO: Extract CSS Modules / Assets from the bundler process
    const renderer = await ssrLoadModule<typeof import('expo-router/src/rsc/rsc-renderer')>(
      'expo-router/build/rsc/rsc-renderer',
      {
        environment: 'react-server',
        platform,
      }
    );

    rscRendererCache.set(platform, renderer);
    return renderer;
  }

  const rscRenderContext = new Map<string, any>();

  function getRscRenderContext(platform: string) {
    // NOTE(EvanBacon): We memoize this now that there's a persistent server storage cache for Server Actions.
    if (rscRenderContext.has(platform)) {
      return rscRenderContext.get(platform)!;
    }

    const context = {};

    rscRenderContext.set(platform, context);
    return context;
  }

  async function renderRscToReadableStream(
    {
      input,

      method,
      platform,
      body,
      engine,
      contentType,
      ssrManifest,
      decodedBody,
    }: {
      input: string;

      method: 'POST' | 'GET';
      platform: string;
      body?: ReadableStream<Uint8Array>;
      engine?: 'hermes' | null;
      contentType?: string;
      ssrManifest?: Map<string, string>;
      decodedBody?: unknown;
    },
    isExporting: boolean | undefined = instanceMetroOptions.isExporting
  ): Promise<ReadableStream> {
    assert(
      isExporting != null,
      'The server must be started before calling renderRscToReadableStream.'
    );

    if (method === 'POST') {
      assert(body, 'Server request must be provided when method is POST (server actions)');
    }

    const { renderRsc } = await getRscRendererAsync(platform);

    return renderRsc(
      {
        body,
        decodedBody,
        context: getRscRenderContext(platform),
        config: {},
        input,
        contentType,
      },
      {
        isExporting,
        entries: await getExpoRouterRscEntriesGetterAsync({ platform }),
        resolveClientEntry: getResolveClientEntry({ platform, engine, ssrManifest }),
        loadServerModuleRsc: async (url) => {
          // TODO: SSR load action code from Metro URL.
          throw new Error('React server actions are not implemented yet');
        },
      }
    );
  }

  return {
    // Get the static client boundaries (no dead code elimination allowed) for the production export.
    getExpoRouterClientReferencesAsync,

    async exportRoutesAsync(
      {
        platform,
        ssrManifest,
      }: {
        platform: string;
        ssrManifest: Map<string, string>;
      },
      files: ExportAssetMap
    ) {
      // TODO: When we add web SSR support, we need to extract CSS Modules / Assets from the bundler process to prevent FLOUC.
      const { getBuildConfig } = (await getExpoRouterRscEntriesGetterAsync({ platform })).default;

      // Get all the routes to render.
      const buildConfig = await getBuildConfig!(async () =>
        // TODO: Rework prefetching code to use Metro runtime.
        []
      );

      await Promise.all(
        Array.from(buildConfig).map(async ({ entries }) => {
          for (const { input, isStatic } of entries || []) {
            if (!isStatic) {
              debug('Skipping static export for route', { input });
              continue;
            }
            const destRscFile = path.join('_flight', platform, encodeInput(input));

            const pipe = await renderRscToReadableStream(
              {
                input,
                method: 'GET',
                platform,
                ssrManifest,
              },
              true
            );

            const rsc = await streamToStringAsync(pipe);
            debug('RSC Payload', { platform, input, rsc });

            files.set(destRscFile, {
              contents: rsc,
              targetDomain: 'client',
              rscId: input,
            });
          }
        })
      );
    },
    htmlMiddleware: htmlMiddleware.GET,
    // htmlMiddleware: createBuiltinAPIRequestHandler(
    //   // Match any path on web.
    //   (req) => {
    //     const url = getFullUrl(req.url);

    //     const platform = url.searchParams.get('platform') ?? req.headers.get('expo-platform');
    //     if (typeof platform !== 'string' || !platform) {
    //       return true;
    //     }
    //     return platform === 'web';
    //   },
    //   htmlMiddleware
    // ),

    middleware: createBuiltinAPIRequestHandler(
      // Match `/_flight/[platform]/[...path]`
      (req) => {
        return getFullUrl(req.url).pathname.startsWith(rscPathPrefix);
      },
      rscMiddleware
    ),
    onReloadRscEvent: () => {
      // NOTE: We cannot clear the renderer context because it would break the mounted context state.

      // Clear the render context to ensure that the next render is a fresh start.
      rscRenderContext.clear();
    },
  };
}

const getFullUrl = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return new URL(url, 'http://localhost:0');
  }
};

export const fileURLToFilePath = (fileURL: string) => {
  if (!fileURL.startsWith('file://')) {
    throw new Error('Not a file URL');
  }
  return decodeURI(fileURL.slice('file://'.length));
};

const encodeInput = (input: string) => {
  if (input === '') {
    return 'index.txt';
  }
  if (input === 'index') {
    throw new Error('Input should not be `index`');
  }
  if (input.startsWith('/')) {
    throw new Error('Input should not start with `/`');
  }
  if (input.endsWith('/')) {
    throw new Error('Input should not end with `/`');
  }
  return input + '.txt';
};

function wrapBundle(str: string) {
  // Skip the metro runtime so debugging is a bit easier.
  // Replace the __r() call with an export statement.
  // Use gm to apply to the last require line. This is needed when the bundle has side-effects.
  return str.replace(/^(__r\(.*\);)$/gm, 'module.exports = $1');
}
