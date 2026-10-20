import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'canvas';
const { createCanvas, loadImage } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function roundRect(ctx, x, y, width, height, radius) {
  if (typeof radius === 'number') {
    radius = { tl: radius, tr: radius, br: radius, bl: radius };
  }
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + width - radius.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  ctx.lineTo(x + width, y + height - radius.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  ctx.lineTo(x + radius.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
}

const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
const androidResDir = path.join(__dirname, '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');

const CORNER_RADIUS_RATIO = 0.2;
const PRIMARY_COLOR = '#2980B9';

const PC_SIZES = [
  { name: '32x32.png', size: 32 },
  { name: '64x64.png', size: 64 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
];

const WINDOWS_SIZES = [
  { name: 'Square30x30Logo.png', size: 30 },
  { name: 'Square44x44Logo.png', size: 44 },
  { name: 'Square71x71Logo.png', size: 71 },
  { name: 'Square89x89Logo.png', size: 89 },
  { name: 'Square107x107Logo.png', size: 107 },
  { name: 'Square142x142Logo.png', size: 142 },
  { name: 'Square150x150Logo.png', size: 150 },
  { name: 'Square284x284Logo.png', size: 284 },
  { name: 'Square310x310Logo.png', size: 310 },
  { name: 'StoreLogo.png', size: 50 },
];

const ANDROID_SIZES = [
  { name: 'mipmap-mdpi', size: 48 },
  { name: 'mipmap-hdpi', size: 72 },
  { name: 'mipmap-xhdpi', size: 96 },
  { name: 'mipmap-xxhdpi', size: 144 },
  { name: 'mipmap-xxxhdpi', size: 192 },
];

const IOS_SIZES = [
  { name: 'AppIcon-20x20@1x.png', size: 20 },
  { name: 'AppIcon-20x20@2x.png', size: 40 },
  { name: 'AppIcon-20x20@2x-1.png', size: 40 },
  { name: 'AppIcon-20x20@3x.png', size: 60 },
  { name: 'AppIcon-29x29@1x.png', size: 29 },
  { name: 'AppIcon-29x29@2x.png', size: 58 },
  { name: 'AppIcon-29x29@2x-1.png', size: 58 },
  { name: 'AppIcon-29x29@3x.png', size: 87 },
  { name: 'AppIcon-40x40@1x.png', size: 40 },
  { name: 'AppIcon-40x40@2x.png', size: 80 },
  { name: 'AppIcon-40x40@2x-1.png', size: 80 },
  { name: 'AppIcon-40x40@3x.png', size: 120 },
  { name: 'AppIcon-60x60@2x.png', size: 120 },
  { name: 'AppIcon-60x60@3x.png', size: 180 },
  { name: 'AppIcon-76x76@1x.png', size: 76 },
  { name: 'AppIcon-76x76@2x.png', size: 152 },
  { name: 'AppIcon-83.5x83.5@2x.png', size: 167 },
  { name: 'AppIcon-512@2x.png', size: 1024 },
];

async function createRoundedIcon(size, sourceImage = null) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, size, size);
  
  const cornerRadius = size * CORNER_RADIUS_RATIO;
  
  ctx.beginPath();
  roundRect(ctx, 0, 0, size, size, cornerRadius);
  ctx.clip();
  
  if (sourceImage) {
    ctx.drawImage(sourceImage, 0, 0, size, size);
  } else {
    ctx.fillStyle = PRIMARY_COLOR;
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = '#FFFFFF';
    const fontSize = size * 0.5;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('题', size / 2, size / 2);
  }
  
  return canvas.toBuffer('image/png');
}

async function createIco(pngBuffers) {
  const iconDir = Buffer.alloc(6);
  iconDir.writeUInt16LE(0, 0);
  iconDir.writeUInt16LE(1, 2);
  iconDir.writeUInt16LE(pngBuffers.length, 4);
  
  let offset = 6 + pngBuffers.length * 16;
  const entries = [];
  const datas = [];
  
  for (const png of pngBuffers) {
    const entry = Buffer.alloc(16);
    const size = Math.min(png.width, 255);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    datas.push(png.data);
    offset += png.data.length;
  }
  
  return Buffer.concat([iconDir, ...entries, ...datas]);
}

async function createIcns(pngBuffers) {
  return Buffer.concat(pngBuffers.map(p => p.data));
}

async function generateIcons() {
  console.log('Starting icon generation...');
  
  let sourceImage = null;
  const sourceIconPath = path.join(iconsDir, 'icon.png');
  
  if (fs.existsSync(sourceIconPath)) {
    try {
      sourceImage = await loadImage(sourceIconPath);
      console.log('Loaded source icon from icon.png');
    } catch (err) {
      console.log('Could not load source icon, using default design');
    }
  }
  
  console.log('\nGenerating PC icons...');
  const icoBuffers = [];
  
  for (const { name, size } of PC_SIZES) {
    const pngBuffer = await createRoundedIcon(size, sourceImage);
    fs.writeFileSync(path.join(iconsDir, name), pngBuffer);
    console.log(`  Created ${name} (${size}x${size})`);
    icoBuffers.push({ width: size, data: pngBuffer });
  }
  
  const ico = await createIco(icoBuffers);
  fs.writeFileSync(path.join(iconsDir, 'icon.ico'), ico);
  console.log('  Created icon.ico');
  
  console.log('\nGenerating Windows Store icons...');
  for (const { name, size } of WINDOWS_SIZES) {
    const pngBuffer = await createRoundedIcon(size, sourceImage);
    fs.writeFileSync(path.join(iconsDir, name), pngBuffer);
    console.log(`  Created ${name} (${size}x${size})`);
  }
  
  console.log('\nGenerating iOS icons...');
  const iosDir = path.join(iconsDir, 'ios');
  if (!fs.existsSync(iosDir)) {
    fs.mkdirSync(iosDir, { recursive: true });
  }
  
  for (const { name, size } of IOS_SIZES) {
    const pngBuffer = await createRoundedIcon(size, sourceImage);
    fs.writeFileSync(path.join(iosDir, name), pngBuffer);
    console.log(`  Created ${name} (${size}x${size})`);
  }
  
  const icnsBuffer = await createIcns([
    { width: 512, data: await createRoundedIcon(512, sourceImage) },
    { width: 1024, data: await createRoundedIcon(1024, sourceImage) }
  ]);
  fs.writeFileSync(path.join(iconsDir, 'icon.icns'), icnsBuffer);
  console.log('  Created icon.icns');
  
  console.log('\nGenerating Android mipmap icons...');
  for (const { name: mipmapDir, size } of ANDROID_SIZES) {
    const dirPath = path.join(androidResDir, mipmapDir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    const pngBuffer = await createRoundedIcon(size, sourceImage);
    fs.writeFileSync(path.join(dirPath, 'ic_launcher.png'), pngBuffer);
    fs.writeFileSync(path.join(dirPath, 'ic_launcher_round.png'), pngBuffer);
    console.log(`  Created ${mipmapDir}/ic_launcher.png (${size}x${size})`);
    
    const fgBuffer = await createForegroundIcon(size, sourceImage);
    fs.writeFileSync(path.join(dirPath, 'ic_launcher_foreground.png'), fgBuffer);
    console.log(`  Created ${mipmapDir}/ic_launcher_foreground.png`);
  }
  
  console.log('\nUpdating Android adaptive icon background...');
  updateAdaptiveIconBackground();
  
  console.log('\n✅ All icons generated successfully!');
}

async function createForegroundIcon(size, sourceImage) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, size, size);
  
  const iconSize = size * 0.6;
  const offset = (size - iconSize) / 2;
  
  if (sourceImage) {
    ctx.drawImage(sourceImage, offset, offset, iconSize, iconSize);
  } else {
    ctx.fillStyle = PRIMARY_COLOR;
    const cornerRadius = iconSize * CORNER_RADIUS_RATIO;
    ctx.beginPath();
    roundRect(ctx, offset, offset, iconSize, iconSize, cornerRadius);
    ctx.fill();
    
    ctx.fillStyle = '#FFFFFF';
    const fontSize = iconSize * 0.5;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('题', size / 2, size / 2);
  }
  
  return canvas.toBuffer('image/png');
}

function updateAdaptiveIconBackground() {
  const drawablePath = path.join(androidResDir, 'drawable');
  if (!fs.existsSync(drawablePath)) {
    fs.mkdirSync(drawablePath, { recursive: true });
  }
  
  const backgroundXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M0,0h108v108h-108z" />
</vector>`;
  
  fs.writeFileSync(path.join(drawablePath, 'ic_launcher_background.xml'), backgroundXml);
  console.log('  Updated ic_launcher_background.xml');
}

generateIcons().catch(console.error);
