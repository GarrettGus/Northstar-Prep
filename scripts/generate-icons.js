// Renders the PNG app icons in public/icons from their SVG sources, using the Chromium that
// Playwright already provides:  node scripts/generate-icons.js
// The "maskable" icon keeps the artwork inside the central 80% circle so Android can crop it to
// any shape without cutting into the shield. Commit the PNGs; this only needs re-running when an
// SVG changes.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = new URL('../public/icons/', import.meta.url);
const outputs = [
  {source: 'icon.svg', name: 'icon-192.png', size: 192},
  {source: 'icon.svg', name: 'icon-512.png', size: 512},
  {source: 'icon.svg', name: 'apple-touch-icon.png', size: 180},
  {source: 'icon-maskable.svg', name: 'icon-maskable-512.png', size: 512},
];

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH} : {});
try {
  for (const {source, name, size} of outputs) {
    const page = await browser.newPage({viewport: {width: size, height: size}, deviceScaleFactor: 1});
    const svg = readFileSync(fileURLToPath(new URL(source, dir)), 'utf8');
    await page.setContent(`<!doctype html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    writeFileSync(fileURLToPath(new URL(name, dir)), await page.screenshot({type: 'png', clip: {x: 0, y: 0, width: size, height: size}}));
    await page.close();
    console.log(`wrote public/icons/${name} (${size}x${size})`);
  }
} finally { await browser.close(); }
