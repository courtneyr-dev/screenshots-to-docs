#!/usr/bin/env node
// Mock of the Figma upload endpoint for tests. POST /ok/<n> records the body size and answers 200;
// POST /fail answers 500; GET /__stats returns what was received.
import http from 'node:http';
const port = Number(process.argv[2]);
const got = [];
http.createServer((q, r) => {
  if (q.method === 'GET' && q.url === '/__stats') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(got)); }
  if (q.method !== 'POST') { r.writeHead(405); return r.end(); }
  const chunks = [];
  q.on('data', c => chunks.push(c));
  q.on('end', () => {
    const body = Buffer.concat(chunks);
    if (q.url.startsWith('/fail')) { r.writeHead(500, { 'content-type': 'text/plain' }); return r.end('simulated upload failure'); }
    got.push({ url: q.url, contentType: q.headers['content-type'], bytes: body.length, pngSignature: body.subarray(0, 8).toString('hex') });
    r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"imageHash":"x"}');
  });
}).listen(port);
