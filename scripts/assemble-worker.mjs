import {readFile,writeFile,readdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url);const assets={};
for(const name of await readdir(new URL('web/',root))){if(!/\.(html|css|mjs|svg)$/.test(name))continue;assets['/'+name]={body:await readFile(new URL('web/'+name,root),'utf8'),type:name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.svg')?'image/svg+xml':'text/javascript; charset=utf-8'};}
let source='';
for(const file of ['server/intent.mjs','server/hyperliquid.mjs','server/app.mjs']){const s=await readFile(new URL(file,root),'utf8');source+=s.replace(/^import .*;\s*$/gm,'').replace(/\bexport (?=(?:async )?function|const|class)/g,'')+'\n';}
source+='\nconst assets = '+JSON.stringify(assets)+';\nexport default createApp(assets);\n';
await writeFile(new URL('worker/index.js',root),source);
