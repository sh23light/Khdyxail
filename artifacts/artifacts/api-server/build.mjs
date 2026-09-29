import { build } from 'esbuild';
import pinoPlugin from 'esbuild-plugin-pino';

// Set build output to project root
const outDir = process.cwd();

build({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  outdir: outDir,
  platform: "node",
  format: "esm",
  sourcemap: true,
  plugins: [pinoPlugin()],
  external: [
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