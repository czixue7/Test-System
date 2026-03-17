const fs = require('fs');
const path = require('path');

// 读取 bank-index.json
const bankIndexPath = path.join(__dirname, '..', 'bank-index.json');
const bankIndex = JSON.parse(fs.readFileSync(bankIndexPath, 'utf8'));

// 图片文件夹映射
const imageFolders = {
  '第一周考题': 'public/banks/第一周考题/image',
  '第二周考题': 'public/banks/第二周考题/image',
  '第三周考题': 'public/banks/第三周考题/image',
  '第四周考题': 'public/banks/第四周考题/image',
  '第五周考题': 'public/banks/第五周考题/image',
  '第六周考题': 'public/banks/第六周考题/image',
  '第七周考题': 'public/banks/第七周考题/image',
  '第八周考题': 'public/banks/第八周考题/image',
  '第九周考题': 'public/banks/第九周考题/image',
  '第十周考题': 'public/banks/第十周考题/image',
};

// 扫描本地图片文件
function scanLocalImages(folderPath) {
  const images = [];
  const fullPath = path.join(__dirname, '..', folderPath);
  
  if (!fs.existsSync(fullPath)) {
    return images;
  }
  
  const files = fs.readdirSync(fullPath);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
      images.push(file);
    }
  }
  
  return images.sort();
}

// 获取GitHub API中的文件SHA
async function fetchGitHubSha(filePath) {
  const GITHUB_REPO = 'czixue7/Test-System';
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch SHA for ${filePath}: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.sha;
  } catch (error) {
    console.error(`Error fetching SHA for ${filePath}:`, error);
    return null;
  }
}

async function updateBankIndex() {
  console.log('开始更新 bank-index.json...\n');
  
  // 更新系统题库
  for (const bank of bankIndex.systemBanks) {
    const folderName = bank.name;
    const imagePath = imageFolders[folderName];
    
    if (!imagePath) {
      console.log(`跳过: ${folderName} (未找到图片路径映射)`);
      continue;
    }
    
    const localImages = scanLocalImages(imagePath);
    
    if (localImages.length === 0) {
      console.log(`跳过: ${folderName} (无本地图片)`);
      bank.images = [];
      continue;
    }
    
    console.log(`处理: ${folderName} (${localImages.length} 张图片)`);
    
    const images = [];
    for (const filename of localImages) {
      const filePath = `${imagePath}/${filename}`;
      const sha = await fetchGitHubSha(filePath);
      
      if (sha) {
        images.push({ filename, sha });
        console.log(`  ✓ ${filename}: ${sha.substring(0, 16)}...`);
      } else {
        console.log(`  ✗ ${filename}: 获取失败`);
      }
      
      // 添加延迟避免触发GitHub API限制
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    bank.images = images;
    console.log('');
  }
  
  // 保存更新后的 bank-index.json
  fs.writeFileSync(bankIndexPath, JSON.stringify(bankIndex, null, 2));
  console.log('✓ bank-index.json 更新完成!');
}

updateBankIndex().catch(console.error);
