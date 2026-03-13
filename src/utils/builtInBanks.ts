import { QuestionBank, JsonBankData, Question, QuestionType } from '../types';

export const BUILT_IN_BANK_PREFIX = 'built-in-';

const BUILT_IN_BANKS = [
  { file: '01第一周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}01` },
  { file: '02第二周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}02` },
  { file: '03第三周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}03` },
  { file: '04第四周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}04` },
  { file: '05第五周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}05` },
  { file: '06第六周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}06` },
  { file: '07第七周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}07` },
  { file: '08第八周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}08` },
  { file: '09第九周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}09` },
  { file: '10第十周考题（答案）.json', id: `${BUILT_IN_BANK_PREFIX}10` },
];

export function isBuiltInBank(id: string): boolean {
  return id.startsWith(BUILT_IN_BANK_PREFIX);
}

function generateQuestionId(bankId: string, questionIndex: number): string {
  return `${bankId}-q-${questionIndex}`;
}

function convertJsonToBuiltInBank(data: JsonBankData, bankId: string): QuestionBank {
  const now = new Date().toISOString();
  const questions: Question[] = data.questions.map((q, index) => ({
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
    allowDisorder: q.allowDisorder
  }));

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
      const response = await fetch(`/banks/${encodeURIComponent(bankInfo.file)}`);
      if (!response.ok) {
        console.warn(`Failed to load built-in bank: ${bankInfo.file}`);
        continue;
      }
      const data: JsonBankData = await response.json();
      const bank = convertJsonToBuiltInBank(data, bankInfo.id);
      banks.push(bank);
    } catch (error) {
      console.warn(`Error loading built-in bank ${bankInfo.file}:`, error);
    }
  }

  return banks;
}

export function getAllBuiltInBankIds(): string[] {
  return BUILT_IN_BANKS.map(b => b.id);
}
