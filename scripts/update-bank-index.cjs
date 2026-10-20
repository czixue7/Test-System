const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const publicBanksRoot = path.join(root, 'Question_bank', 'public', 'banks');
const indexPath = path.join(root, 'bank-index.json');
const previous = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blobHash = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const matches = (bytes, hash) => hash === digest(bytes) || hash === blobHash(bytes);
function assertPublicPath(file) {
  const relative = path.relative(publicBanksRoot, fs.realpathSync(file));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('公开题库索引仅允许读取 Question_bank/public/banks 内的文件');
  }
}
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  assertPublicPath(directory);
  return fs.readdirSync(directory, {withFileTypes:true}).filter(e => !e.name.startsWith('.')).flatMap(e => {
    const full = path.join(directory, e.name);
    return e.isDirectory() ? walk(full) : e.isFile() ? [full] : [];
  });
}
function committedTime(relative, bytes) {
  try {
    const stored = execFileSync('git', ['show', `HEAD:${relative}`], {cwd:root,stdio:['ignore','pipe','ignore'],maxBuffer:64*1024*1024});
    if (digest(stored) !== digest(bytes)) return 0;
    const value = execFileSync('git', ['log','-1','--format=%cI','--',relative], {cwd:root,stdio:['ignore','pipe','ignore'],encoding:'utf8'}).trim();
    return Date.parse(value) || 0;
  } catch { return 0; }
}
function assetTime(file, bytes, oldRelative) {
  const relative = path.relative(root,file).replace(/\\/g,'/');
  return committedTime(relative,bytes) || (oldRelative && committedTime(oldRelative,bytes)) || fs.statSync(file).mtimeMs;
}
function oldPath(item) {
  try { return decodeURIComponent(new URL(item.downloadUrl).pathname.split('/main/')[1] || ''); } catch { return ''; }
}
function entry(file, prior) {
  assertPublicPath(file);
  const bytes = fs.readFileSync(file), data = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(data.questions)) return null;
  const relative = path.relative(root,file).replace(/\\/g,'/');
  const imageDir = path.join(path.dirname(file),'image');
  const imageFiles = walk(imageDir).filter(p => /\.(?:png|jpe?g|gif|webp)$/i.test(p)).sort();
  const images = imageFiles.map(p => ({filename:path.basename(p),sha:digest(fs.readFileSync(p))}));
  const unchangedImages = images.length === (prior?.images?.length ?? 0) && imageFiles.every(p => {
    const old = prior?.images?.find(i => i.filename === path.basename(p));
    return old && matches(fs.readFileSync(p),old.sha);
  });
  const unchanged = prior && matches(bytes,prior.sha) && unchangedImages;
  const timestamp = unchanged && Date.parse(prior.updatedAt) ? Date.parse(prior.updatedAt) : Math.max(
    assetTime(file,bytes,prior && oldPath(prior)),
    ...imageFiles.map(p => assetTime(p,fs.readFileSync(p),prior?.imagePath ? `${prior.imagePath}/${path.basename(p)}` : undefined)),
  );
  return {
    bankId: data.bankId || prior?.bankId || `bank:${path.basename(file)}`,
    name: prior?.name || data.name || path.basename(file,'.json'),
    filename:path.basename(file),
    downloadUrl:`https://raw.githubusercontent.com/czixue7/Test-System/main/${relative}`,
    ...(imageFiles.length ? {imagePath:path.relative(root,imageDir).replace(/\\/g,'/')} : {}),
    sha:digest(bytes),updatedAt:new Date(timestamp).toISOString(),images,
  };
}
const systemFiles = walk(publicBanksRoot).filter(p => p.endsWith('.json'));
const systemBanks = previous.systemBanks.map(prior => {
  const files = systemFiles.filter(p => path.basename(p) === prior.filename);
  if (files.length !== 1) throw new Error(`系统题库无法唯一定位：${prior.filename}`);
  return entry(files[0],prior);
}).filter(Boolean);
// This is a public manifest. Never publish private bank metadata or retain it
// from the previous manifest; userBanks stays present for format compatibility.
const userBanks = [];
const all = [...systemBanks,...userBanks];
const ids = new Set();
for (const item of all) { if (ids.has(item.bankId)) throw new Error(`重复 bankId：${item.bankId}，请为不同题库设置独立 bankId`); ids.add(item.bankId); }
const output = {updatedAt:new Date(Math.max(...all.map(p => Date.parse(p.updatedAt)))).toISOString(),systemBanks,userBanks};
fs.writeFileSync(indexPath,JSON.stringify(output,null,2)+'\n');
console.log(`已离线更新 bank-index.json：${systemBanks.length} 个系统题库、${userBanks.length} 个用户题库；SHA-256、bankId 和 updatedAt 已写入。`);
