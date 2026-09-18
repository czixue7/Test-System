import { QuestionBank, BankIndex, BankIndexItem, BankImageInfo } from '../types';
import { isBuiltInBank } from './builtInBanks';
import { contentsApiCandidates, fetchRemoteJson, repoFileCandidates } from './remoteRepo';

const USER_BANK_PATH = 'Question_bank';

interface RepoContentItem {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  download_url?: string;
}

/**
 * 动态获取 Question_bank 目录下所有用户题库
 * 优先 Gitee，失败回退 GitHub；遍历子目录，找到 JSON 文件和图片目录
 */
async function fetchUserBanksFromRepo(): Promise<BankIndexItem[]> {
  const items: BankIndexItem[] = [];

  try {
    const dirContents = await fetchRemoteJson<RepoContentItem[]>(
      contentsApiCandidates(USER_BANK_PATH)
    );
    if (!Array.isArray(dirContents)) {
      return items;
    }

    const subDirs = dirContents.filter(item => item.type === 'dir');

    for (const subDir of subDirs) {
      try {
        const subContents = await fetchRemoteJson<RepoContentItem[]>(
          contentsApiCandidates(subDir.path)
        );
        if (!Array.isArray(subContents)) continue;

        const jsonFile = subContents.find(
          f => f.type === 'file' && f.name.endsWith('.json')
        );

        if (jsonFile && jsonFile.download_url) {
          const hasImageDir = subContents.some(f => f.type === 'dir' && f.name === 'image');

          items.push({
            name: subDir.name,
            filename: jsonFile.name,
            downloadUrl: jsonFile.download_url,
            imagePath: hasImageDir ? `${subDir.path}/image` : undefined,
            sha: jsonFile.sha,
            images: []
          });
        }
      } catch (err) {
        console.warn(`Failed to fetch sub-directory ${subDir.name}:`, err);
      }
    }
  } catch (error) {
    console.error('Error fetching user banks:', error);
  }

  return items;
}

export interface BankStatus {
  exists: boolean;
  hasUpdate: boolean;
  hasImageUpdate: boolean;
  isBuiltIn: boolean;
  missingImages: string[]; // 本地缺失的图片
  changedImages: string[]; // 哈希变化的图片
}

export interface BankUpdateInfo {
  hasUpdate: boolean;
  hasImageUpdate: boolean;
  remoteSha: string | null;
  remoteImages: BankImageInfo[] | null;
  missingImages: string[];
  changedImages: string[];
}

/**
 * 获取题库索引文件
 * 合并静态bank-index.json和动态获取的用户题库（均优先 Gitee，失败回退 GitHub）
 */
export async function fetchBankIndex(): Promise<BankIndex | null> {
  try {
    // 1. 获取静态索引文件（优先 Gitee，失败回退 GitHub）
    let index: BankIndex;
    try {
      index = await fetchRemoteJson<BankIndex>(repoFileCandidates('bank-index.json'));
    } catch (error) {
      console.warn('Failed to fetch bank index, using empty defaults:', error);
      index = { systemBanks: [], userBanks: [] };
    }

    // 2. 动态获取 Question_bank 目录下的用户题库
    const dynamicUserBanks = await fetchUserBanksFromRepo();

    // 3. 合并用户题库：动态获取的优先，静态索引中不重复的保留
    const dynamicNames = new Set(dynamicUserBanks.map(b => b.filename));
    const staticOnly = index.userBanks.filter(b => !dynamicNames.has(b.filename));
    index.userBanks = [...dynamicUserBanks, ...staticOnly];

    return index;
  } catch (error) {
    console.error('Error fetching bank index:', error);
    return null;
  }
}

/**
 * 从索引中查找题库信息
 */
export function findBankInIndex(
  index: BankIndex,
  filename: string,
  source: 'system' | 'user'
): BankIndexItem | undefined {
  const banks = source === 'system' ? index.systemBanks : index.userBanks;
  return banks.find(b => b.filename === filename);
}

/**
 * 比较本地和远程图片列表，找出差异
 */
function compareImages(
  localImages: BankImageInfo[] | undefined,
  remoteImages: BankImageInfo[] | undefined
): { missingImages: string[]; changedImages: string[] } {
  const missingImages: string[] = [];
  const changedImages: string[] = [];

  if (!remoteImages || remoteImages.length === 0) {
    return { missingImages, changedImages };
  }

  // 创建本地图片映射
  const localImagesMap = new Map<string, string>();
  if (localImages) {
    localImages.forEach(img => {
      localImagesMap.set(img.filename, img.sha);
    });
  }

  // 检查远程图片
  for (const remoteImg of remoteImages) {
    const localSha = localImagesMap.get(remoteImg.filename);
    if (!localSha) {
      // 本地没有这张图片
      missingImages.push(remoteImg.filename);
    } else if (localSha !== remoteImg.sha) {
      // 图片哈希不同，有更新
      changedImages.push(remoteImg.filename);
    }
  }

  return { missingImages, changedImages };
}

/**
 * 检查题库状态（用于下载页面）
 * @param bankName 题库名称
 * @param remoteSha 远程题库SHA
 * @param remoteImages 远程图片列表
 * @param filename 文件名
 * @param source 来源
 * @param localBanks 本地题库列表
 */
export function checkBankStatus(
  bankName: string,
  remoteSha: string,
  remoteImages: BankImageInfo[] | undefined,
  filename: string,
  source: 'system' | 'user',
  localBanks: QuestionBank[]
): BankStatus {
  const isBuiltIn = source === 'system' && isBuiltInBankFile(filename);

  const existingBank = localBanks.find(bank => {
    if (bank.name === bankName) return true;
    const normalizedName = bankName.replace(/周考题（答案）/, '').trim();
    if (bank.name.includes(normalizedName) || normalizedName.includes(bank.name)) return true;
    if (bank.sourceFilename === filename) return true;
    return false;
  });

  if (!existingBank) {
    return { exists: false, hasUpdate: false, hasImageUpdate: false, isBuiltIn, missingImages: [], changedImages: [] };
  }

  // 没有 sourceSha 的旧数据（包括早期版本的内置题库）
  if (!existingBank.sourceSha) {
    return { exists: true, hasUpdate: false, hasImageUpdate: false, isBuiltIn, missingImages: [], changedImages: [] };
  }

  // 哈希算法不同的情况按「有更新」处理（与 checkBankUpdate 保持一致）
  const hasUpdate = shaIndicatesUpdate(compareSha(existingBank.sourceSha, remoteSha));
  
  // 比较图片差异
  const { missingImages, changedImages } = compareImages(existingBank.images, remoteImages);
  const hasImageUpdate = missingImages.length > 0 || changedImages.length > 0;

  return {
    exists: true,
    hasUpdate,
    hasImageUpdate,
    isBuiltIn,
    missingImages,
    changedImages
  };
}

/**
 * 比较两个内容哈希。
 *
 * - `missing`      —— 任一侧没有哈希，无法判断
 * - `same`         —— 完全一致
 * - `different`    —— 同一算法下的不同哈希
 * - `incomparable` —— 两侧哈希算法不同（长度不同，例如旧的 40 位 SHA-1
 *                    与新的 64 位 SHA-256）
 *
 * ⚠️ 历史上把「长度不同」直接当成「没变」，导致内置题库「第一周考题」
 * （`builtInBanks.ts` 里是 40 位、索引里是 64 位）的更新检测**永久失效**。
 * 现在 `incomparable` 按「有更新」处理：用户更新一次后 sourceSha 会被写成
 * 新算法的值，之后比较即可正常工作（自愈）。
 */
export type ShaComparison = 'missing' | 'same' | 'different' | 'incomparable';

export function compareSha(localSha?: string | null, remoteSha?: string | null): ShaComparison {
  if (!localSha || !remoteSha) return 'missing';
  if (localSha === remoteSha) return 'same';

  const isSha1 = (s: string) => /^[0-9a-f]{40}$/i.test(s);
  const isSha256 = (s: string) => /^[0-9a-f]{64}$/i.test(s);

  if ((isSha1(localSha) && isSha1(remoteSha)) || (isSha256(localSha) && isSha256(remoteSha))) {
    return 'different';
  }
  return 'incomparable';
}

/** 由哈希比较结果推导「是否有更新」 */
export function shaIndicatesUpdate(comparison: ShaComparison): boolean {
  return comparison === 'different' || comparison === 'incomparable';
}

/**
 * 检查题库是否有更新（用于管理页面）
 * @param bank 本地题库
 * @param index 题库索引
 */
export function checkBankUpdate(bank: QuestionBank, index: BankIndex | null): BankUpdateInfo {
  if (!bank.sourceSha || !bank.sourceFilename || !index) {
    return { 
      hasUpdate: false, 
      hasImageUpdate: false, 
      remoteSha: null, 
      remoteImages: null,
      missingImages: [],
      changedImages: []
    };
  }

  const remoteBank = findBankInIndex(index, bank.sourceFilename, bank.sourceType || 'user');

  if (!remoteBank) {
    return { 
      hasUpdate: false, 
      hasImageUpdate: false, 
      remoteSha: null, 
      remoteImages: null,
      missingImages: [],
      changedImages: []
    };
  }

  // 哈希算法不同的情况按「有更新」处理，让 sourceSha 自愈升级到新算法
  const hasUpdate = shaIndicatesUpdate(compareSha(bank.sourceSha, remoteBank.sha));
  
  // 比较图片差异
  const { missingImages, changedImages } = compareImages(bank.images, remoteBank.images);
  const hasImageUpdate = missingImages.length > 0 || changedImages.length > 0;

  return {
    hasUpdate,
    hasImageUpdate,
    remoteSha: remoteBank.sha,
    remoteImages: remoteBank.images || null,
    missingImages,
    changedImages
  };
}

/**
 * 判断是否为内置题库文件
 */
function isBuiltInBankFile(filename: string): boolean {
  const builtInFiles = [
    '第一周考题.json',
    '第二周考题.json',
    '第三周考题.json',
    '第四周考题.json',
    '第五周考题.json',
    '第六周考题.json',
    '第七周考题.json',
    '第八周考题.json',
    '第九周考题.json',
    '第十周考题.json',
  ];
  return builtInFiles.includes(filename);
}

/**
 * 获取所有题库列表（从索引）
 */
export function getAllBanksFromIndex(index: BankIndex): Array<BankIndexItem & { source: 'system' | 'user' }> {
  const systemBanks = index.systemBanks.map(b => ({ ...b, source: 'system' as const }));
  const userBanks = index.userBanks.map(b => ({ ...b, source: 'user' as const }));
  return [...systemBanks, ...userBanks];
}
