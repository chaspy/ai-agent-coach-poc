// 学習記録専用の型定義
// メモリとは別に、構造化された学習活動を記録するための型

// スタディサプリのコンテンツタイプ
export type StudyContentType = 
  | 'basics'        // 基礎講座（関先生の講義動画）
  | 'dictation'     // ディクテーション
  | 'shadowing'     // シャドーイング
  | 'practice'      // パート別演習問題
  | 'vocabulary'    // 単語クイズ
  | 'mock_test';    // 模擬試験

// 学習記録
export interface StudyRecord {
  id: string;
  userId: string;
  date: string; // ISO 8601 format (YYYY-MM-DD)
  contentType: StudyContentType;
  partNumber?: 1 | 2 | 3 | 4 | 5 | 6 | 7; // TOEIC Part番号（該当する場合）
  durationMinutes: number; // 学習時間（分）
  questionCount?: number; // 問題数
  correctCount?: number; // 正答数
  score?: number; // スコア
  notes?: string; // メモ
  completed: boolean; // 完了フラグ
}

// Part別統計
export interface PartStats {
  partNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  totalMinutes: number;
  sessions: number;
  averageAccuracy?: number; // 平均正答率（0-1）
}

// コンテンツタイプ別統計
export interface ContentTypeStats {
  contentType: StudyContentType;
  totalMinutes: number;
  sessions: number;
}

// 日別統計
export interface DayStats {
  date: string; // YYYY-MM-DD
  minutes: number;
}

// 今週の統計
export interface WeekStats {
  totalMinutes: number;
  sessions: number;
  byDay: DayStats[];
}

// 総合学習統計
export interface StudyStats {
  userId: string;
  totalStudyTimeMinutes: number; // 累計学習時間
  consecutiveDays: number; // 連続学習日数
  lastStudyDate?: string; // 最終学習日
  byPart: PartStats[]; // Part別統計
  byContentType: ContentTypeStats[]; // コンテンツタイプ別統計
  thisWeek: WeekStats; // 今週の統計
}