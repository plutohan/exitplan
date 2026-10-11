// Vercel Function (web fetch signature). Builds an unsigned Kamino withdrawal with the SDK and simulates it; never sends.
import { createApp } from '../server/app.mjs';

const app = createApp({});

export default { fetch(request) { return app.fetch(request, process.env); } };
