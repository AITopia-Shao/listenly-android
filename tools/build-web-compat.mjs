/** Ship one classic bundle that also works with Android 8's Chromium 58 WebView. */
import {build} from 'esbuild';
import {transformAsync} from '@babel/core';
import presetEnv from '@babel/preset-env';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const web=path.resolve('app/src/main/assets/web');
const first=await build({entryPoints:[path.join(web,'app.js')],bundle:true,write:false,
  format:'iife',platform:'browser',target:'esnext',legalComments:'inline'});
const transformed=await transformAsync(first.outputFiles[0].text,{babelrc:false,configFile:false,
  sourceType:'module',presets:[[presetEnv,{targets:{chrome:'58'},modules:false,
    useBuiltIns:'usage',corejs:'3.50',bugfixes:true}]],comments:true});
await build({stdin:{contents:transformed.code,resolveDir:path.resolve('.'),loader:'js'},
  bundle:true,format:'iife',platform:'browser',target:'chrome58',minify:true,
  legalComments:'inline',outfile:path.join(web,'app.compat.js')});
await mkdir('.build/web',{recursive:true});
await writeFile('.build/web/build.json',JSON.stringify({target:'Chromium 58+',classicScript:true,
  generated:'app/src/main/assets/web/app.compat.js',builtAt:new Date().toISOString()},null,2));
console.log('Built classic app.compat.js with Chromium 58 syntax and standard-library polyfills.');
