export type QuestionType = 'single-choice' | 'multiple-choice' | 'fill-in-blank' | 'true-false' | 'subjective';

export interface Question {
  id: string;
  type: QuestionType;
  question: string;
  content?: string;
  options?: Array<{ id: string; content: string }>;
  correctAnswer: string | string[];
  score: number;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  explanation?: string;
  allowDisorder?: boolean;
  images?: string[];
}

export interface Exam {
  id: string;
  name: string;
  description: string;
  questions: Question[];
  timeLimit: number;
  totalScore: number;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  createdAt: string;
  updatedAt: string;
}

export interface QuestionResult {
  questionId?: string;
  question?: string;
  userAnswer?: string | string[];
  correctAnswer?: string | string[];
  answer?: string | string[];
  isCorrect: number;
  score: number;
  maxScore?: number;
  explanation?: string;
  aiFeedback?: string;
  aiExplanation?: string;
  gradingMode?: 'ai' | 'fixed' | 'ai-fallback';
  isConfirmed?: boolean;
  blankResults?: BlankResult[];
}

export interface UserAnswer {
  questionId?: string;
  answer: string | string[];
  answerImages?: string[];
  isCorrect?: boolean | number;
  score?: number;
  blankResults?: BlankResult[];
  aiFeedback?: string;
  aiExplanation?: string;
  gradingMode?: 'ai' | 'fixed' | 'ai-fallback';
}

export interface ExamResult {
  examId: string;
  examName: string;
  score: number;
  totalScore: number;
  correctCount: number;
  totalCount: number;
  timeSpent: number;
  answers: UserAnswer[];
  questionResults: QuestionResult[];
  submittedAt: string;
}

export interface ExamRecord {
  id: string;
  examId: string;
  examName: string;
  bankName?: string;
  bankId?: string;
  score: number;
  totalScore: number;
  maxScore?: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  timeSpent: number;
  duration?: number;
  answers: UserAnswer[];
  questions: Question[];
  submittedAt: string;
  finishedAt?: string;
  startedAt?: string;
  gradingMode?: 'fixed' | 'ai';
  gradingProvider?: GradingProvider;
  percentage?: number;
  aiEvaluation?: string;
}

export type GradingProvider = 'api' | 'fixed';

export type GradingMode = 'fixed' | 'ai';

export interface BlankResult {
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
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
  images?: BankImageInfo[];
}

export interface BankImageInfo {
  filename: string;
  sha: string;
}

export interface BankIndexItem {
  name: string;
  filename: string;
  downloadUrl: string;
  imagePath?: string;
  sha: string;
  images?: BankImageInfo[];
}

export interface BankIndex {
  systemBanks: BankIndexItem[];
  userBanks: BankIndexItem[];
}

export interface JsonQuestionData {
  id?: string;
  type: string;
  question: string;
  content?: string;
  options?: Array<{ id: string; content: string }>;
  correctAnswer: string | string[];
  score?: number;
  category?: string;
  difficulty?: string;
  explanation?: string;
  allowDisorder?: boolean;
  images?: string[];
}

export interface JsonBankData {
  name: string;
  description?: string;
  questions: JsonQuestionData[];
}

export interface AnswerWithImages {
  text: string;
  images: string[];
}

export interface ExamState {
  examId?: string;
  examName?: string;
  bankId?: string;
  bankName?: string;
  questions: Question[];
  currentQuestionIndex?: number;
  currentIndex: number;
  answers: Map<string, string | string[]>;
  results: Map<string, QuestionResult>;
  status?: 'idle' | 'in-progress' | 'completed';
  startTime: number;
  endTime?: number;
  isFinished?: boolean;
}

export type QuestionStatus = 'unanswered' | 'answered' | 'marked' | 'correct' | 'incorrect';

export type PracticeMode = 'all' | 'wrong' | 'marked' | 'sequential' | 'view' | 'favorites' | 'common';


