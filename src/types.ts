export type QuestionType = 'fill-in-blank' | 'single-choice' | 'multiple-choice' | 'subjective';

export type PracticeMode = 'sequential' | 'wrong' | 'favorites' | 'common' | 'view';

export interface AnswerWithImages {
  text: string;
  images?: string[];
}

export interface Question {
  id: string;
  type: QuestionType;
  content: string;
  options?: QuestionOption[];
  correctAnswer: string | string[] | AnswerWithImages;
  score: number;
  explanation?: string;
  images?: string[];
  allowDisorder?: boolean;
}

export interface QuestionOption {
  id: string;
  content: string;
}

export interface QuestionBank {
  id: string;
  name: string;
  description?: string;
  questions: Question[];
  createdAt: string;
  updatedAt: string;
  sourceSha?: string;
  sourceFilename?: string;
  sourceType?: 'system' | 'user';
}

export interface UserAnswer {
  questionId: string;
  answer: string | string[];
  score?: number;
  similarity?: number;
  isCorrect: 0 | 1 | 2; // 0=错误, 1=部分正确, 2=正确
  aiFeedback?: string;
  aiExplanation?: string;
  gradingMode?: GradingMode;
  blankResults?: BlankResult[];
}

export interface ExamRecord {
  id: string;
  bankId: string;
  bankName: string;
  questions: Question[];
  answers: UserAnswer[];
  totalScore: number;
  maxScore: number;
  percentage: number;
  duration: number;
  startedAt: string;
  finishedAt: string;
  aiEvaluation?: string;
  gradingMode?: GradingMode;
}

export type QuestionStatus = 'unanswered' | 'correct' | 'incorrect' | 'partial';

export interface BlankResult {
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
}

export interface QuestionResult {
  answer: string | string[];
  isConfirmed: boolean;
  isCorrect: 0 | 1 | 2; // 0=错误, 1=部分正确, 2=正确
  score: number;
  aiFeedback?: string;
  aiExplanation?: string;
  gradingMode?: GradingMode;
  blankResults?: BlankResult[];
}

export interface ExamState {
  bankId: string;
  bankName: string;
  questions: Question[];
  currentIndex: number;
  answers: Map<string, string | string[]>;
  results: Map<string, QuestionResult>;
  startTime: number;
  isFinished: boolean;
}

export interface JsonQuestionData {
  type: string;
  content: string;
  options?: { id: string; content: string }[];
  correctAnswer: string | string[] | AnswerWithImages;
  score?: number;
  explanation?: string;
  images?: string[];
  allowDisorder?: boolean;
}

export interface JsonBankData {
  name: string;
  description?: string;
  questions: JsonQuestionData[];
}

export type GradingMode = 'ai' | 'fixed' | 'ai-fallback';

export type GradingProvider = 'webllm' | 'api' | 'fixed';

export interface AIGradingResult {
  score: number;
  isCorrect: boolean;
  similarity?: number;
  feedback?: string;
}

export interface APIModelConfig {
  id: string;
  name: string;
  maxTokens: number;
}

export const API_MODELS: APIModelConfig[] = [
  { id: 'glm-4-flash', name: 'GLM-4-Flash (推荐)', maxTokens: 4096 },
  { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', maxTokens: 65536 },
  { id: 'glm-4-plus', name: 'GLM-4-Plus', maxTokens: 128000 },
  { id: 'glm-4-air', name: 'GLM-4-Air', maxTokens: 8192 },
];

// 火山引擎模型列表
export const VOLCENGINE_MODELS: APIModelConfig[] = [
  { id: 'doubao-seed-1-6-flash-250828', name: 'Doubao-Seed-1.6-flash (默认)', maxTokens: 32000 },
  { id: 'doubao-seed-1-8-251228', name: 'Doubao-Seed-1.8', maxTokens: 32000 },
];
