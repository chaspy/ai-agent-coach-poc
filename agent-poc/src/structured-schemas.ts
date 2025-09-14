import { z } from 'zod';

/**
 * Step 5: 構造化出力（Zod）スキーマ定義
 * 型安全な構造化データの返却用スキーマコレクション
 */

// プロフィール分析結果の構造化スキーマ
export const ProfileAnalysisSchema = z.object({
  userId: z.string().describe('分析対象のユーザーID'),
  role: z.enum(['student', 'coach']).describe('ユーザーの役割'),
  
  // 学習特性分析
  learningCharacteristics: z.object({
    level: z.enum(['beginner', 'intermediate', 'advanced']).describe('現在のレベル'),
    strengths: z.array(z.string()).describe('強み一覧'),
    weaknesses: z.array(z.string()).describe('改善点一覧'),
    preferredLearningStyle: z.enum(['visual', 'auditory', 'kinesthetic', 'mixed']).describe('学習スタイル'),
    motivationFactors: z.array(z.string()).describe('モチベーション要因'),
  }),
  
  // コミュニケーション特性
  communicationStyle: z.object({
    tone: z.enum(['formal', 'casual', 'friendly', 'professional']).describe('コミュニケーション調性'),
    preferredInteraction: z.enum(['supportive', 'challenging', 'balanced']).describe('好むインタラクション'),
    responseStyle: z.enum(['detailed', 'concise', 'encouraging', 'analytical']).describe('返答スタイル'),
  }),
  
  // 目標と計画
  goalsAndPlanning: z.object({
    shortTermGoals: z.array(z.string()).describe('短期目標（1-3ヶ月）'),
    longTermGoals: z.array(z.string()).describe('長期目標（6ヶ月以上）'),
    priorities: z.array(z.string()).describe('優先事項'),
    availabilityHours: z.number().describe('1日あたり学習可能時間'),
  }),
  
  // 分析メタ情報
  analysis: z.object({
    confidence: z.number().min(0).max(1).describe('分析信頼度（0-1）'),
    lastUpdated: z.string().describe('最終更新日時'),
    recommendedActions: z.array(z.string()).describe('推奨アクション'),
    riskFactors: z.array(z.string()).describe('注意すべきリスク要因'),
  }),
});

// 記憶エントリの構造化スキーマ
export const MemoryEntrySchema = z.object({
  id: z.string().describe('記憶エントリID'),
  type: z.enum(['learning_progress', 'learning_challenge', 'commitment', 'emotional_state', 'milestone']).describe('記憶タイプ'),
  
  // コアデータ
  core: z.object({
    title: z.string().describe('記憶のタイトル'),
    description: z.string().describe('詳細説明'),
    createdAt: z.string().describe('作成日時'),
    importance: z.enum(['low', 'medium', 'high', 'critical']).describe('重要度'),
  }),
  
  // タイプ別詳細データ（union型で管理）
  details: z.union([
    // 学習進捗
    z.object({
      type: z.literal('learning_progress'),
      subject: z.string().describe('科目'),
      achievement: z.string().describe('達成内容'),
      score: z.number().optional().describe('スコア'),
      improvement: z.number().optional().describe('改善度'),
    }),
    // 学習課題
    z.object({
      type: z.literal('learning_challenge'),
      category: z.string().describe('課題カテゴリ'),
      difficulty: z.enum(['easy', 'medium', 'hard']).describe('難易度'),
      resolved: z.boolean().describe('解決済みかどうか'),
    }),
    // 約束事
    z.object({
      type: z.literal('commitment'),
      deadline: z.string().describe('期限'),
      status: z.enum(['pending', 'in_progress', 'completed', 'overdue']).describe('ステータス'),
      priority: z.enum(['low', 'medium', 'high']).describe('優先度'),
    }),
    // 感情状態
    z.object({
      type: z.literal('emotional_state'),
      emotion: z.string().describe('感情'),
      intensity: z.number().min(1).max(5).describe('強度（1-5）'),
      trigger: z.string().optional().describe('トリガー'),
    }),
    // マイルストーン
    z.object({
      type: z.literal('milestone'),
      eventDate: z.string().describe('イベント日'),
      significance: z.enum(['minor', 'major', 'critical']).describe('重要度'),
      preparation: z.array(z.string()).describe('準備事項'),
    }),
  ]).describe('タイプ別詳細情報'),
  
  // 関連性とメタデータ
  metadata: z.object({
    tags: z.array(z.string()).describe('タグ'),
    relevance: z.number().min(0).max(1).describe('関連度'),
    accessCount: z.number().describe('アクセス回数'),
    lastAccessed: z.string().describe('最終アクセス日時'),
  }),
});

// 学習計画の構造化スキーマ
export const LessonPlanSchema = z.object({
  id: z.string().describe('計画ID'),
  title: z.string().describe('計画タイトル'),
  
  // 計画基本情報
  overview: z.object({
    objective: z.string().describe('学習目標'),
    duration: z.number().describe('予想所要時間（分）'),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).describe('難易度'),
    subject: z.string().describe('科目・分野'),
  }),
  
  // 学習ステップ
  steps: z.array(z.object({
    stepNumber: z.number().describe('ステップ番号'),
    title: z.string().describe('ステップタイトル'),
    description: z.string().describe('詳細説明'),
    estimatedTime: z.number().describe('予想時間（分）'),
    resources: z.array(z.string()).describe('必要リソース'),
    checkpoints: z.array(z.string()).describe('チェックポイント'),
  })).describe('学習ステップ'),
  
  // 評価基準
  assessment: z.object({
    criteria: z.array(z.string()).describe('評価基準'),
    successMetrics: z.array(z.string()).describe('成功指標'),
    reflectionQuestions: z.array(z.string()).describe('振り返り質問'),
  }),
  
  // カスタマイゼーション
  customization: z.object({
    adaptedFor: z.string().describe('適用対象者'),
    personalizedNotes: z.array(z.string()).describe('個人向けメモ'),
    alternatives: z.array(z.string()).describe('代替アプローチ'),
  }),
});

// 型エクスポート
export type ProfileAnalysis = z.infer<typeof ProfileAnalysisSchema>;
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
export type LessonPlan = z.infer<typeof LessonPlanSchema>;

// ------------------------------
// 追加: タスク分解・自己診断用スキーマ
// ------------------------------

// エージェント用の一般タスク計画（会話支援・ツール実行計画向け）
export const TaskPlanSchema = z.object({
  goal: z.string().describe('最終目的（ユーザー要求の要約）'),
  constraints: z.array(z.string()).describe('制約・遵守事項'),
  steps: z.array(z.object({
    id: z.string(),
    title: z.string(),
    action: z.string().describe('実行アクション概要（例: ツール呼び出し／プロンプト生成）'),
    inputs: z.array(z.string()).describe('必要入力'),
    successCriteria: z.array(z.string()).describe('完了判定基準'),
  })).min(1),
  risks: z.array(z.string()).default([]),
  timeBudgetMin: z.number().int().min(1).describe('想定時間(分)'),
});

export type TaskPlan = z.infer<typeof TaskPlanSchema>;

// 回答自己診断（LLM-as-a-judge）
export const AnswerEvaluationSchema = z.object({
  overall: z.number().min(0).max(1).describe('総合スコア'),
  scores: z.object({
    relevance: z.number().min(0).max(1),
    helpfulness: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    faithfulness: z.number().min(0).max(1),
  }),
  pass: z.boolean().describe('合格基準を満たすか'),
  issues: z.array(z.string()).describe('主要な問題点'),
  suggestions: z.array(z.string()).describe('改善提案'),
  revisedAnswer: z.string().optional().describe('（任意）改善済み回答'),
});

export type AnswerEvaluation = z.infer<typeof AnswerEvaluationSchema>;

// スキーマバリデーション関数
export const validateProfileAnalysis = (data: unknown): ProfileAnalysis => {
  return ProfileAnalysisSchema.parse(data);
};

export const validateMemoryEntry = (data: unknown): MemoryEntry => {
  return MemoryEntrySchema.parse(data);
};

export const validateLessonPlan = (data: unknown): LessonPlan => {
  return LessonPlanSchema.parse(data);
};

export const validateTaskPlan = (data: unknown): TaskPlan => {
  return TaskPlanSchema.parse(data);
};

export const validateAnswerEvaluation = (data: unknown): AnswerEvaluation => {
  return AnswerEvaluationSchema.parse(data);
};
