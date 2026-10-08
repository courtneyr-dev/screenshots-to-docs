import http from 'node:http';
const [port, siteName, color] = [process.argv[2], process.argv[3], process.argv[4]];
const pages = { '/': 'Home', '/pricing': 'Pricing', ...(siteName==='old' ? {'/legacy':'Legacy page'} : {}) };
http.createServer((q,r)=>{ const t=pages[q.url.replace(/(.)\/$/,'$1')];
 if(!t){r.writeHead(404,{'content-type':'text/html'});return r.end(`<h1>404 ${siteName}</h1>`);}
 r.writeHead(200,{'content-type':'text/html'});
 r.end(`<body style="margin:0;font:32px sans-serif"><div style="background:${color};color:#fff;padding:60px"><h1>${siteName}: ${t}</h1></div><div style="padding:40px;height:900px">Body content for ${t}</div>`);
}).listen(port);
