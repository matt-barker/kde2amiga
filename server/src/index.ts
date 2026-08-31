import express from 'express';
import path from 'node:path';
import { createFetchProxyHandler } from './proxy.js';

const app = express();
const PORT = process.env.PORT ?? 3001;
const CLIENT_DIST = path.resolve(import.meta.dirname, '../../client/dist');

app.use(express.static(CLIENT_DIST));

app.get('/api/fetch-url', createFetchProxyHandler());

app.listen(PORT, () => {
  console.log(`kde2amiga server listening on http://localhost:${PORT}`);
});
