export type QuestionType = 'single-choice' | 'multiple-choice' | 'fill-in-blank' | 'true-false' | 'subjective';

export interface Question {
  id: string;
  type: QuestionType;
  question: string;
  content?: string;
  options?: Array<{ id: string; content: string }>;
  correctAnswer: string | string[] | AnswerWithImages;
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
  correctAnswer?: string | string[] | AnswerWithImages;
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

/** 统一的对/错/部分正确/未答统计（Result、Records、recordStore 共用） */
export interface AutomationStats {
  correct: number;
  partial: number;
  wrong: number;
  unanswered: number;
  total: number;
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
  correctAnswer: string | string[] | AnswerWithImages;
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

// ===== 值班表相关类型 =====

// 班次类型
export type DutyShiftType = 'morning' | 'noon' | 'night' | 'allday';

// 值班表中的一条班次记录（单个日期下的一个班次）
export interface DutyShift {
  id: string;
  date: string;           // YYYY-MM-DD
  shiftType: DutyShiftType; // 班次类型
  startTime?: string;     // HH:mm
  endTime?: string;       // HH:mm
  tasks: string[];        // 任务列表
  personInCharge?: string; // 负责人
  notes?: string;         // 备注
  group?: string;         // 班组：A/B/C/D，空字符串为长白班
}

// 演练抽检计划中的一项：某日期某班组对应的演练名称
export interface DutyDrill {
  date: string;   // YYYY-MM-DD
  group: string;  // 班组 A/B/C/D
  name: string;   // 演练名称
}

// 岗位划分中的一项：岗位名称 → 人员
export interface DutyRolePost {
  name: string;    // 岗位名，如 配电 / 柴发 / 暖通① / 暖通②
  person: string;  // 该岗位人员
}

// 某日期某班组的岗位划分（用于夜班多岗位分工显示）
export interface DutyRoleAssignment {
  date: string;              // YYYY-MM-DD
  group: string;             // 班组 A/B/C/D
  shiftType: DutyShiftType;  // 班次（当前仅夜班）
  leader?: string;           // 值班长
  posts: DutyRolePost[];     // 岗位划分
}

// 一份值班表（可包含多天、多班次）
export interface DutySchedule {
  id: string;
  name: string;
  description?: string;
  shifts: DutyShift[];
  drills?: DutyDrill[];   // 演练抽检计划（日期+班组→演练名称）
  roles?: DutyRoleAssignment[]; // 岗位划分（日期+班组→岗位→人员）
  createdAt: string;
  updatedAt: string;
  sourceSha?: string;
  sourceFilename?: string;
  sourceType?: 'system' | 'user';
}

// 索引文件中的一项（与 BankIndexItem 对应）
export interface DutyIndexItem {
  name: string;
  filename: string;
  downloadUrl: string;
  sha: string;
}

// 索引文件结构
export interface DutyIndex {
  systemDuties: DutyIndexItem[];
  userDuties: DutyIndexItem[];
}

// 用于本地 JSON 导入的原始数据结构
export interface JsonDutyShiftData {
  date: string;
  shiftType?: string;
  startTime?: string;
  endTime?: string;
  tasks?: string[];
  personInCharge?: string;
  notes?: string;
  group?: string;
}

export interface JsonDutyScheduleData {
  name: string;
  description?: string;
  shifts: JsonDutyShiftData[];
}

// ===== 知识库相关类型 =====

// 知识库条目（导入的文档）
export interface KnowledgeItem {
  id: string;
  title: string;       // 标题
  category: string;    // 分类（专业领域）
  content: string;     // 正文内容
  createdAt: string;
  updatedAt: string;
  kind?: 'note';       // 由"帮我记"创建的汇总条目（同一分类只保留一个，记录追加写入）
}

// 知识库搜索数据源
export type KnowledgeSearchSource = 'knowledge' | 'questionBank' | 'combined' | 'ai';



