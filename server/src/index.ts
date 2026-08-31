import express from 'express';
import path from 'node:path';
import { createFetchProxyHandler } from './proxy.js';

const app = express();
const PORT = process.env.PORT ?? 3001;
const CLIENT_DIST = path.resolve(import.meta.dirname, '../../client/dist');

app.use(express.static(CLIENT_DIST));

app.get('/api/fetch-url', createFetchProxyHandler());

// v1 is local-only: bind to loopback explicitly rather than all interfaces.
app.listen(Number(PORT), '127.0.0.1', () => {
  console.log(`kde2amiga server listening on http://localhost:${PORT}`);
});
