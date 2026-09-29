/**
 * Clean UI/runtime build into ./dist: removes the previous generated dist (so no orphaned module from a
 * deleted source can survive), compiles, copies assets and writes dist/build-info.json.
 */
import { join } from 'node:path';
import { compile, copyAssets, removeGenerated, sourceRoot, writeBuildInfo } from './build-support.mjs';

const dist = join(sourceRoot, 'dist');
await removeGenerated(dist);
compile(dist);
await copyAssets(dist);
const info = await writeBuildInfo(dist);
console.log(JSON.stringify({ dist, buildId: info.buildId, gitSha: info.gitSha, dirty: info.dirty }));
