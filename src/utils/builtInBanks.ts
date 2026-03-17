import { QuestionBank, JsonBankData, Question, QuestionType } from '../types';

export const BUILT_IN_BANK_PREFIX = 'built-in-';

// 新的目录结构：每个题库一个文件夹，图片放在 image 子目录下
// 注意：sha 值需要与 bank-index.json 中的对应题库保持一致
const BUILT_IN_BANKS = [
  { folder: '第一周考题', file: '第一周考题.json', id: `${BUILT_IN_BANK_PREFIX}01`, sha: 'b64eb605cc22b439c5a00bee19d149a82bd58fa1' },
  { folder: '第二周考题', file: '第二周考题.json', id: `${BUILT_IN_BANK_PREFIX}02`, sha: '180bee9682fabc3cab639a47e6a63d2f82a85f5e47d9b30c6ce638ecc84abebb' },
  { folder: '第三周考题', file: '第三周考题.json', id: `${BUILT_IN_BANK_PREFIX}03`, sha: '7e09ae64e1fcd2e62d1329fef8bfd37cce3ba720a62e4e4eb81254ae47049e3a' },
  { folder: '第四周考题', file: '第四周考题.json', id: `${BUILT_IN_BANK_PREFIX}04`, sha: 'b2c65a9cc2282bfda8584e1e13e3445c974ae917b3805c6fd7b5840c7f35c7af' },
  { folder: '第五周考题', file: '第五周考题.json', id: `${BUILT_IN_BANK_PREFIX}05`, sha: 'e5695835ee0a708360c8216ef4b9597471cb9dbf56be28d2f4f0e0d2377e9428' },
  { folder: '第六周考题', file: '第六周考题.json', id: `${BUILT_IN_BANK_PREFIX}06`, sha: 'e03ef0d7bba94f5859bae2bdd5e492040e025ac18f183723a58bee2da6d29b48' },
  { folder: '第七周考题', file: '第七周考题.json', id: `${BUILT_IN_BANK_PREFIX}07`, sha: 'f4dc6d3ce0b9c0b7a1ac4b78e99af994eb748f5ecafcf69f91439531494a148f' },
  { folder: '第八周考题', file: '第八周考题.json', id: `${BUILT_IN_BANK_PREFIX}08`, sha: '1c787e3580809d0aaa2769bdbd03a73546f6c8c4208230b7adbbd604c6ce9301' },
  { folder: '第九周考题', file: '第九周考题.json', id: `${BUILT_IN_BANK_PREFIX}09`, sha: '2ed488b1e116c47566d5a6a4def26200a07736074eb61cc766f4639e34a4b023' },
  { folder: '第十周考题', file: '第十周考题.json', id: `${BUILT_IN_BANK_PREFIX}10`, sha: 'c12e95d65f0a0c2be257969a7695cbdb310f07d0ac34b2595562f5fe61b6ff88' },
];

export function isBuiltInBank(id: string): boolean {
  return id.startsWith(BUILT_IN_BANK_PREFIX);
}

function generateQuestionId(bankId: string, questionIndex: number): string {
  return `${bankId}-q-${questionIndex}`;
}

function convertJsonToBuiltInBank(
  data: JsonBankData,
  bankId: string,
  sha: string,
  filename: string
): QuestionBank {
  const now = new Date().toISOString();
  const questions: Question[] = data.questions.map((q, index) => {
    // 只使用JSON中显式定义的question.images作为题目图片
    // image/文件夹中的图片是答案图片，不应该作为题目图片显示
    const images = q.images;

    return {
      id: generateQuestionId(bankId, index),
      type: q.type as QuestionType,
      question: q.question,
      content: q.content,
      options: q.options?.map(opt => ({
        id: opt.id,
        content: opt.content
      })),
      correctAnswer: q.correctAnswer,
      score: q.score ?? 10,
      category: q.category ?? 'default',
      difficulty: (q.difficulty as 'easy' | 'medium' | 'hard') ?? 'medium',
      explanation: q.explanation,
      images: images,
      allowDisorder: q.allowDisorder
    };
  });

  return {
    id: bankId,
    name: data.name,
    description: data.description,
    questions,
    createdAt: now,
    updatedAt: now,
    sourceSha: sha,
    sourceFilename: filename,
    sourceType: 'system'
  };
}

export async function loadBuiltInBanks(): Promise<QuestionBank[]> {
  const banks: QuestionBank[] = [];

  for (const bankInfo of BUILT_IN_BANKS) {
    try {
      // 加载题库 JSON 文件
      const response = await fetch(`/banks/${encodeURIComponent(bankInfo.folder)}/${encodeURIComponent(bankInfo.file)}`);
      if (!response.ok) {
        console.warn(`Failed to load built-in bank: ${bankInfo.folder}/${bankInfo.file}`);
        continue;
      }

      const data: JsonBankData = await response.json();

      // 转换并创建题库对象，携带 sourceSha 和 sourceFilename 用于更新检测
      // 注意：不再自动加载image/文件夹中的图片作为题目图片
      // 因为这些图片实际上是答案图片，应该在答案区域显示
      const bank = convertJsonToBuiltInBank(data, bankInfo.id, bankInfo.sha, bankInfo.file);
      banks.push(bank);
    } catch (error) {
      console.warn(`Error loading built-in bank ${bankInfo.folder}/${bankInfo.file}:`, error);
    }
  }

  return banks;
}

export function getAllBuiltInBankIds(): string[] {
  return BUILT_IN_BANKS.map(b => b.id);
}

/**
 * 获取内置题库的文件路径信息
 * 用于下载图库功能
 */
export function getBuiltInBankPath(bankId: string): { folder: string; file: string } | null {
  const bank = BUILT_IN_BANKS.find(b => b.id === bankId);
  if (!bank) return null;
  return { folder: bank.folder, file: bank.file };
}
