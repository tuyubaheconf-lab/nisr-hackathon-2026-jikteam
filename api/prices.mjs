/**
 * Vercel Function wrapper for GET /api/prices.
 * The real work lives in server/prices.mjs, shared with Netlify's function.
 */
import { readPrices } from "../server/prices.mjs";

export default async function handler(_req, res) {
  const { status, headers, body } = await readPrices();
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.status(status).json(body);
}
