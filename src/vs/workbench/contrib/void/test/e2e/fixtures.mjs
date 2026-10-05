/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. Small local servers the scenarios use as "the internet".

import { createServer } from 'node:http';

/** A tiny web app the browser tool can really load, click and type into. */
export function startWebFixture() {
	const page = `<!doctype html><html><head><title>Vader Fixture</title></head><body>
<h1 id="h">Fixture heading</h1>
<p>The counter is <span id="count">0</span>.</p>
<button id="inc" onclick="document.getElementById('count').textContent = Number(document.getElementById('count').textContent) + 1">Increment</button>
<form onsubmit="event.preventDefault(); document.getElementById('hello').textContent = 'Hello, ' + document.getElementById('name').value + '!'">
  <label>Your name <input id="name" type="text" aria-label="Your name"></label>
  <button type="submit">Greet</button>
</form>
<p id="hello"></p>
<script>console.error('fixture console error'); setTimeout(() => { throw new Error('fixture page error'); }, 50);</script>
</body></html>`;
	const server = createServer((req, res) => {
		if (req.url === '/' || req.url?.startsWith('/index')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return; }
		if (req.url === '/api/ping') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"pong":true}'); return; }
		res.writeHead(404); res.end('not found');
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(() => r())) })));
}
