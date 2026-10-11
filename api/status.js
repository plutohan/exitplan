// Vercel Function (web fetch signature). Static files are served from web/ by Vercel itself.
import { createApp } from '../server/app.mjs';

const app = createApp({});

export default { fetch(request) { return app.fetch(request, process.env); } };
