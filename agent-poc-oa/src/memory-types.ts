// MemoryTool用の型定義

export type MemoryType = 
  | "learning_progress"     // 学習進捗
  | "learning_challenge"     // 学習課題・弱点
  | "commitment"            // 約束・宿題
  | "emotional_state"       // 感情・モチベーション
  | "milestone"             // 重要イベント
  | "preference"            // 好み・選好
  | "custom";              // その他

export interface Memory {
  id: string;
  userId: string;
  sessionId: string;
  type: MemoryType;
  content: any;
  timestamp: Date;
  relevance: number;      // 0-1の重要度スコア
  accessed: number;       // 参照回数
  lastAccessed?: Date;
  tags: string[];         // 検索用タグ
  expired: boolean;       // 期限切れフラグ
  expiresAt?: Date;      // 有効期限
}

// 学習進捗の記録
export interface LearningProgressMemory {
  type: "learning_progress";
  date: string;
  subject: "vocabulary" | "listening" | "reading" | "writing" | "grammar" | "speaking";
  achievement: string;
  score?: number;
  context?: string;
  timeSpent?: number; // 分単位
}

// 学習課題・弱点の記録  
export interface LearningChallengeMemory {
  type: "learning_challenge";
  date: string;
  category: "grammar" | "vocabulary" | "time_management" | "motivation" | "comprehension" | "pronunciation";
  description: string;
  attemptedSolutions?: string[];
  resolved: boolean;
  resolvedDate?: string;
}

// 約束・宿題の記録
export interface CommitmentMemory {
  type: "commitment";
  date: string;
  deadline: string;
  task: string;
  frequency: "daily" | "weekly" | "once" | "custom";
  completed: boolean;
  completedDate?: string;
  notes?: string;
}

// 感情・モチベーション状態
export interface EmotionalStateMemory {
  type: "emotional_state";
  date: string;
  emotion: "anxious" | "motivated" | "frustrated" | "confident" | "tired" | "excited" | "stressed";
  trigger?: string;
  intensity: 1 | 2 | 3 | 4 | 5; // 1=低い, 5=高い
  supportProvided?: string;
}

// 重要イベント・マイルストーン
export interface MilestoneMemory {
  type: "milestone";
  dateMentioned: string;
  eventDate: string;
  event: string;
  importance: "critical" | "high" | "medium" | "low";
  preparation?: string[];
  completed?: boolean;
}

// メモリー検索条件
export interface MemorySearchCriteria {
  userId?: string;
  type?: MemoryType | MemoryType[];
  tags?: string[];
  fromDate?: Date;
  toDate?: Date;
  minRelevance?: number;
  notExpired?: boolean;
  limit?: number;
}

// メモリー保存判定結果
export interface MemorySaveDecision {
  shouldSave: boolean;
  type?: MemoryType;
  confidence: number;     // 0-1の確信度
  reason?: string;
  suggestedTags?: string[];
}

// メモリー取得判定結果
export interface MemoryRetrievalDecision {
  memories: Memory[];
  relevanceScores: Map<string, number>;
  reason?: string;
}