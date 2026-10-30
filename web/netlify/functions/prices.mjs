/**
 * Netlify Function wrapper for GET /api/prices.
 * The real work lives in server/prices.mjs, shared with Vercel's api/prices.mjs.
 */
import { readPrices } from "../../../server/prices.mjs";

export const handler = async () => {
  const { status, headers, body } = await readPrices();
  return { statusCode: status, headers, body: JSON.stringify(body) };
};
