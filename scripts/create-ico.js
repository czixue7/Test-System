import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');

const createIcoFile = () => {
  const iconDir = Buffer.alloc(6);
  iconDir.writeUInt16LE(0, 0);
  iconDir.writeUInt16LE(1, 2);
  iconDir.writeUInt16LE(1, 4);
  
  const iconDirEntry = Buffer.alloc(16);
  iconDirEntry.writeUInt8(32, 0);
  iconDirEntry.writeUInt8(32, 1);
  iconDirEntry.writeUInt8(0, 2);
  iconDirEntry.writeUInt8(0, 3);
  iconDirEntry.writeUInt16LE(1, 4);
  iconDirEntry.writeUInt16LE(32, 6);
  
  const pngData = createMinimalPng(32);
  const pngSize = pngData.length;
  
  iconDirEntry.writeUInt32LE(pngSize, 8);
  iconDirEntry.writeUInt32LE(22, 12);
  
  return Buffer.concat([iconDir, iconDirEntry, pngData]);
};

const createMinimalPng = (size) => {
  const header = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52,
    (size >> 24) & 0xFF, (size >> 16) & 0xFF, (size >> 8) & 0xFF, size & 0xFF,
    (size >> 24) & 0xFF, (size >> 16) & 0xFF, (size >> 8) & 0xFF, size & 0xFF,
    0x08, 0x02,
    0x00, 0x00, 0x00,
  ]);
  
  const crc = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  
  const idat = Buffer.from([
    0x00, 0x00, 0x00, 0x01, 0x49, 0x44, 0x41, 0x54,
    0x08, 0xD7, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
  ]);
  
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
  
  return Buffer.concat([header, crc, idat, iend]);
};

const ico = createIcoFile();
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), ico);
console.log('Created icon.ico');
