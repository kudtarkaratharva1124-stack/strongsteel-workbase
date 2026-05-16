#!/usr/bin/env node
// Run with: node generate-icons.js
// Generates simple placeholder PNG icons for PWA
const { createCanvas } = require('canvas');
const fs = require('fs');

function generateIcon(size, outputPath) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0d0f12';
  ctx.fillRect(0, 0, size, size);

  // Orange circle accent
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.38, 0, Math.PI * 2);
  ctx.fill();

  // "SS" text
  ctx.fillStyle = '#000000';
  ctx.font = `bold ${size * 0.32}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SS', size / 2, size / 2);

  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  console.log(`Generated ${outputPath}`);
}

generateIcon(192, './public/icons/icon-192.png');
generateIcon(512, './public/icons/icon-512.png');
