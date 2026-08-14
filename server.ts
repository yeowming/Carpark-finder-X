/**
 * server.ts
 * 
 * Express full-stack server running on port 3000 (host 0.0.0.0).
 * Proxies API requests to api/insight.js and serves static HTML/CSS/JS files.
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import insightHandler from './api/insight.js';
import healthHandler from './api/health.js';

dotenv.config();

const app = express();
const PORT = 3000;

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.all('/api/health', (req, res) => {
  healthHandler(req, res);
});

// API Routes for Carpark Insight & Availability
app.all('/api/insight', (req, res) => {
  insightHandler(req, res);
});

app.all('/api/insight.js', (req, res) => {
  insightHandler(req, res);
});

// Serve static assets directly from root and dist
const staticRoot = process.cwd();
const distRoot = path.join(staticRoot, 'dist');

app.use(express.static(staticRoot, {
  extensions: ['html', 'htm'],
  index: 'index.html'
}));

app.use(express.static(distRoot, {
  extensions: ['html', 'htm'],
  index: 'index.html'
}));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  const rootIndex = path.join(staticRoot, 'index.html');
  const distIndex = path.join(distRoot, 'index.html');
  if (fs.existsSync(rootIndex)) {
    res.sendFile(rootIndex);
  } else if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else {
    res.status(404).send('Not Found');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SG Carpark & EV Locator Server running on http://0.0.0.0:${PORT}`);
});
