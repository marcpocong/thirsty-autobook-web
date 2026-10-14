/** Match CI's scheduling without removing tests or changing any timeout. Explicit Vitest arguments retain normal CLI behavior. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { sourceRoot } from './build-support.mjs';
const args=process.argv.slice(2),heavy=['tests/shotgun-test-lab.test.ts','tests/strategy-flow.test.ts','tests/normal-test-lab.test.ts'];
function run(args){execFileSync(process.execPath,[join(sourceRoot,'node_modules/vitest/vitest.mjs'),'run',...args],{cwd:sourceRoot,stdio:'inherit'});}
try{if(args.length)run(args);else {run(heavy.flatMap(file=>['--exclude',file]));for(const file of heavy)run([file]);}}catch{process.exitCode=1;}
