// Railway-compatible CommonJS build script
const { build } = require('esbuild');
const pinoPlugin = require('esbuild-plugin-pino');

// Set build output to dist directory
const outDir = "./dist";

build({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  outdir: outDir,
  platform: "node",
  format: "cjs",
  sourcemap: true,
  plugins: [pinoPlugin()],
  outExtension: { ".js": ".cjs" },
  external: [
    "cookie-parser",
    "cors",
    "drizzle-orm",
    "express",
    "pino",
    "pino-http",
    "zod",
    "better-sqlite3",
    "canvas",
    "fsevents",
    "lightningcss",
    "onnxruntime-node",
    "oracledb",
    "pg-native",
    "sharp",
    "sqlite3",
    "utf-8-validate",
    "zlib"
  ]
}).catch(() => process.exit(1));