export type QuestionType = 'fill-in-blank' | 'single-choice' | 'multiple-choice' | 'subjective';

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
}

export interface UserAnswer {
  questionId: string;
  answer: string | string[];
  score?: number;
  similarity?: number;
}

export interface ExamRecord {
  id: string;
  bankId: string;
  bankName: string;
  answers: UserAnswer[];
  totalScore: number;
  maxScore: number;
  percentage: number;
  duration: number;
  startedAt: string;
  finishedAt: string;
}

export type QuestionStatus = 'unanswered' | 'correct' | 'incorrect';

export interface QuestionResult {
  answer: string | string[];
  isConfirmed: boolean;
  isCorrect: boolean;
  score: number;
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
