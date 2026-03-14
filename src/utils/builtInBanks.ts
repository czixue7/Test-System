import { QuestionBank, JsonBankData, Question, QuestionType } from '../types';

export const BUILT_IN_BANK_PREFIX = 'built-in-';

// 新的目录结构：每个题库一个文件夹，图片放在 image 子目录下
const BUILT_IN_BANKS = [
  { folder: '第一周考题', file: '第一周考题.json', id: `${BUILT_IN_BANK_PREFIX}01` },
  { folder: '第二周考题', file: '第二周考题.json', id: `${BUILT_IN_BANK_PREFIX}02` },
  { folder: '第三周考题', file: '第三周考题.json', id: `${BUILT_IN_BANK_PREFIX}03` },
  { folder: '第四周考题', file: '第四周考题.json', id: `${BUILT_IN_BANK_PREFIX}04` },
  { folder: '第五周考题', file: '第五周考题.json', id: `${BUILT_IN_BANK_PREFIX}05` },
  { folder: '第六周考题', file: '第六周考题.json', id: `${BUILT_IN_BANK_PREFIX}06` },
  { folder: '第七周考题', file: '第七周考题.json', id: `${BUILT_IN_BANK_PREFIX}07` },
  { folder: '第八周考题', file: '第八周考题.json', id: `${BUILT_IN_BANK_PREFIX}08` },
  { folder: '第九周考题', file: '第九周考题.json', id: `${BUILT_IN_BANK_PREFIX}09` },
  { folder: '第十周考题', file: '第十周考题.json', id: `${BUILT_IN_BANK_PREFIX}10` },
];

export function isBuiltInBank(id: string): boolean {
  return id.startsWith(BUILT_IN_BANK_PREFIX);
}

function generateQuestionId(bankId: string, questionIndex: number): string {
  return `${bankId}-q-${questionIndex}`;
}

/**
 * 加载题库图片
 * 从 /banks/{folder}/image/ 目录加载图片
 * 图片命名格式：{题号}-{序号}.jpg（如 6-1.jpg 表示第6题的第1张图）
 */
async function loadBankImages(folder: string): Promise<Map<string, string[]>> {
  const questionImagesMap = new Map<string, string[]>();
  
  try {
    // 尝试加载图片清单或直接加载已知图片
    // 图片路径格式：/banks/{folder}/image/{questionIndex}-{imageIndex}.jpg
    const imagePromises: Promise<void>[] = [];
    
    // 预加载前20道题的图片，每道题最多5张图
    for (let qIndex = 0; qIndex < 20; qIndex++) {
      for (let imgIndex = 1; imgIndex <= 5; imgIndex++) {
        const imagePath = `/banks/${encodeURIComponent(folder)}/image/${qIndex + 1}-${imgIndex}.jpg`;
        
        const promise = fetch(imagePath, { method: 'HEAD' })
          .then(response => {
            if (response.ok) {
              if (!questionImagesMap.has(qIndex.toString())) {
                questionImagesMap.set(qIndex.toString(), []);
              }
              questionImagesMap.get(qIndex.toString())?.push(imagePath);
            }
          })
          .catch(() => {
            // 图片不存在，忽略错误
          });
        
        imagePromises.push(promise);
      }
    }
    
    await Promise.all(imagePromises);
  } catch (error) {
    console.warn(`Error loading images for bank ${folder}:`, error);
  }
  
  return questionImagesMap;
}

function convertJsonToBuiltInBank(
  data: JsonBankData, 
  bankId: string, 
  questionImagesMap: Map<string, string[]>
): QuestionBank {
  const now = new Date().toISOString();
  const questions: Question[] = data.questions.map((q, index) => {
    // 获取该题的图片
    const images = questionImagesMap.has(index.toString()) 
      ? questionImagesMap.get(index.toString()) 
      : q.images;
    
    return {
      id: generateQuestionId(bankId, index),
      type: q.type as QuestionType,
      content: q.content,
      options: q.options?.map(opt => ({
        id: opt.id,
        content: opt.content
      })),
      correctAnswer: q.correctAnswer,
      score: q.score ?? 10,
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
    updatedAt: now
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
      
      // 加载题库图片
      const questionImagesMap = await loadBankImages(bankInfo.folder);
      
      // 转换并创建题库对象
      const bank = convertJsonToBuiltInBank(data, bankInfo.id, questionImagesMap);
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
