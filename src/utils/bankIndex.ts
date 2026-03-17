import { QuestionBank, BankIndex, BankIndexItem, BankImageInfo } from '../types';
import { isBuiltInBank } from './builtInBanks';

const BANK_INDEX_URL = 'https://raw.githubusercontent.com/czixue7/Test-System/main/bank-index.json';

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
 */
export async function fetchBankIndex(): Promise<BankIndex | null> {
  try {
    const response = await fetch(BANK_INDEX_URL);
    if (!response.ok) {
      console.warn('Failed to fetch bank index:', response.status);
      return null;
    }
    return await response.json();
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
    return { exists: false, hasUpdate: false, hasImageUpdate: false, isBuiltIn: false, missingImages: [], changedImages: [] };
  }

  // 没有 sourceSha 的旧数据（包括早期版本的内置题库）
  if (!existingBank.sourceSha) {
    return { exists: true, hasUpdate: false, hasImageUpdate: false, isBuiltIn, missingImages: [], changedImages: [] };
  }

  const hasUpdate = existingBank.sourceSha !== remoteSha;
  
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

  const hasUpdate = remoteBank.sha !== bank.sourceSha;
  
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
