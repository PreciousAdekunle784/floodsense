// Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
// The Express app keeps the original URL, so its /api routes match unchanged.
import app from '../server/app.js';

export default app;
