import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const result=await build({entryPoints:[path.join(root,'apps/desktop/src/preload/index.ts')],outfile:path.join(root,'apps/desktop/dist/preload/index.cjs'),bundle:true,format:'iife',platform:'browser',target:'es2022',external:['electron'],metafile:true,write:false});
for(const output of Object.values(result.metafile.outputs))for(const imported of output.imports)assert.equal(imported.path,'electron','Sandboxed preload may require only Electron.');
for(const file of result.outputFiles){await mkdir(path.dirname(file.path),{recursive:true});await writeFile(file.path,file.contents);}
console.log('Sandboxed preload bundled; only Electron remains external.');
