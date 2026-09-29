// Root index.js for Railway compatibility
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export * from './dist/index.mjs';