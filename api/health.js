/**
 * api/health.js
 * 
 * Vercel Serverless Function for application health checks.
 */
export default function handler(req, res) {
  return res.status(200).json({
    status: "ok",
    service: "SG Carpark & EV Finder API",
    timestamp: new Date().toISOString()
  });
}
