import http from 'node:http';
http.createServer((q,r)=>{ r.writeHead(403,{'content-type':'text/html'}); r.end('<h1>Forbidden</h1>'); }).listen(4203);
