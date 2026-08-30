const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};

http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
  const relative=pathname==='/'?'loan_tracker.html':pathname.replace(/^\/+/, '');
  const target=path.resolve(root,relative);
  if(!target.startsWith(root+path.sep)){ response.writeHead(403); response.end('Forbidden'); return; }
  fs.readFile(target,(error,data)=>{
    if(error){ response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
    response.end(data);
  });
}).listen(4173,'127.0.0.1');
