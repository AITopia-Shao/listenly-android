import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const web=path.join(root,'app/src/main/assets/web');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.png':'image/png','.lrc':'text/plain; charset=utf-8'};
export async function startPreview(port=4173,webRoot=web){
 const previewWeb=path.resolve(webRoot);
 const server=http.createServer(async(req,res)=>{
   try{
     const url=new URL(req.url,'http://127.0.0.1');
     const decoded=decodeURIComponent(url.pathname);
     const archive=decoded.startsWith('/archive/');
     const base=archive?path.join(root,'materials'):previewWeb;
     const file=path.resolve(base,(archive?decoded.slice(9):decoded.slice(1))||'index.html');
     if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return}
     const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
     const headers={'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
     let start=0,end=info.size-1,status=200;
     if(req.headers.range){const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!range||(!range[1]&&!range[2])){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return}
       if(!range[1])start=Math.max(0,info.size-Number(range[2]));else start=Number(range[1]);
       if(range[1]&&range[2])end=Math.min(end,Number(range[2]));
       if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return}
       headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;status=206;
     }
     headers['Content-Length']=end-start+1;res.writeHead(status,headers);
     if(req.method==='HEAD'){res.end();return}
     createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
   }catch{res.writeHead(404);res.end('Not found')}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const demo=process.argv.includes('--demo');
 const port=process.argv.slice(2).find(arg=>/^\d+$/.test(arg));
 const webRoot=demo?path.join(root,'.build/demo/main/assets/web'):(process.env.LISTENLY_WEB_DIR||web);
 const server=await startPreview(Number(port||4173),webRoot);console.log(`拾听预览：http://127.0.0.1:${server.address().port}`);
}
