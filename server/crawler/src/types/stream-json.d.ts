/** stream-json/stream-chain ship no types (npm has no @types package for either) — a transitive
 *  dep of crawlee, now a direct dep here too (src/analysis/store.ts). Narrow ambient types
 *  covering only the surface this repo actually calls.
 *
 *  All four submodules export `module.exports = SomeClassOrFn` and attach extra named entry
 *  points (`.parser`, `.pick`, `.streamArray`, `.chain`) onto that export AFTER the
 *  class/function is defined — a pattern cjs-module-lexer's static export scan doesn't see, so
 *  `import { x } from "..."` throws "does not provide an export named 'x'" under Node's ESM
 *  loader even though `require("...")` .x works fine under CommonJS. Default-import the whole
 *  export and call the attached property instead (see store.ts) — verified working against the
 *  real 12.4MB books-full-site/issues.json before relying on it. */
declare module "stream-chain" {
  import type { Duplex, Stream } from "node:stream";
  export default class Chain {
    static chain(streams: Stream[]): Duplex;
  }
}

declare module "stream-json" {
  import type { Transform } from "node:stream";
  interface StreamJsonMain {
    (options?: Record<string, unknown>): Transform;
    parser(options?: Record<string, unknown>): Transform;
  }
  const main: StreamJsonMain;
  export default main;
}

declare module "stream-json/filters/Pick.js" {
  import type { Transform } from "node:stream";
  type PickOptions = { filter: string | RegExp | ((path: (string | number)[]) => boolean) };
  // Unlike the main stream-json/stream-chain modules, Pick's default export is the class itself
  // (not a callable factory) — .pick(...)/.make(...) are static methods on it, not the export.
  interface PickCtor {
    pick(options: PickOptions): Transform;
    make(options: PickOptions): Transform;
  }
  const main: PickCtor;
  export default main;
}

declare module "stream-json/streamers/StreamArray.js" {
  import type { Transform } from "node:stream";
  interface StreamArrayCtor {
    streamArray(): Transform;
    make(): Transform;
  }
  const main: StreamArrayCtor;
  export default main;
}

declare module "stream-json/Assembler.js" {
  import type { EventEmitter } from "node:events";
  import type { Stream } from "node:stream";
  export default class Assembler extends EventEmitter {
    current: unknown;
    static connectTo(stream: Stream): Assembler;
  }
}
