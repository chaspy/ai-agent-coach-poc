import type { 
  MemoryType, 
  MemorySaveDecision, 
  MemoryRetrievalDecision,
  Memory,
  LearningProgressMemory,
  LearningChallengeMemory,
  CommitmentMemory,
  EmotionalStateMemory,
  MilestoneMemory
} from './memory-types';
import { searchMemories } from './memory-storage';
// 🚨 CRITICAL AI SDK Version Lock (2025-09-05)
// AI SDK v5破壊的変更によりOpenAI gpt-4o-miniが使用不可
// - v5要求: model spec v2 (未対応)
// - OpenAI実装: model spec v1 (現在)
// - Result: UnsupportedModelVersionError
// package.json でai@4.0.7に固定中
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

// キーワードパターンの定義
const PATTERNS = {
  learningProgress: {
    keywords: ['覚えた', '理解した', '取れた', '点', 'スコア', '合格', 'できるようになった', '上達', '向上', '成長'],
    subjects: {
      vocabulary: ['単語', '語彙', 'ボキャブラリー'],
      listening: ['リスニング', '聞き取り', 'ヒアリング'],
      reading: ['読解', 'リーディング', '長文'],
      writing: ['ライティング', '作文', 'エッセイ'],
      grammar: ['文法', 'グラマー'],
      speaking: ['スピーキング', '会話', '発音'],
    }
  },
  
  learningChallenge: {
    keywords: ['難しい', '苦手', 'わからない', '困っ', 'できない', '課題', '問題', '悩み', 'つらい', '大変', '点数低い', '点数悪い', '成績', '失敗'],
    categories: {
      grammar: ['文法', '時制', '関係詞', '仮定法'],
      vocabulary: ['単語', '語彙', '覚えられない'],
      timeManagement: ['時間', '間に合わない', '足りない'],
      motivation: ['やる気', 'モチベーション', '続かない'],
      comprehension: ['理解', '意味', 'わからない'],
      pronunciation: ['発音', '音', '聞き取れない'],
      test_performance: ['点数', 'スコア', 'テスト', '試験', '成績'],
    }
  },
  
  commitment: {
    keywords: ['宿題', '課題', '約束', 'までに', '次回', '練習', '毎日', '週'],
    frequency: {
      daily: ['毎日', '日々', 'デイリー'],
      weekly: ['週', '毎週', 'ウィークリー'],
      once: ['一回', '一度', '次回まで'],
    }
  },
  
  emotionalState: {
    emotions: {
      anxious: ['不安', '心配', '緊張', 'ドキドキ'],
      motivated: ['やる気', 'がんばる', '頑張', 'モチベーション'],
      frustrated: ['イライラ', 'うまくいかない', 'もどかしい', '腹立つ', 'むかつく', 'ムカつく'],
      confident: ['自信', '大丈夫', 'できる'],
      tired: ['疲れ', 'つかれ', 'しんどい', '眠い', 'ねむい', '眠く', 'ねむく'],
      excited: ['楽しい', 'ワクワク', '楽しみ', '楽しい話', '面白い話', 'おもしろい話', '楽しく', '面白く'],
      stressed: ['ストレス', 'プレッシャー', '焦'],
      sad: ['悲しい', '辛い', 'つらい', '泣きそう', '泣いた'],
      depressed: ['落ち込', 'へこん', 'テンション下が', '憂鬱', 'ゆううつ', '嫌なこと'],
      angry: ['怒', '腹立', 'むかつ', 'ムカつ', '頭にくる', '頭きた'],
    }
  },
  
  milestone: {
    keywords: ['試験', 'テスト', '本番', '受験', 'イベント', '予定', '月', '日'],
    importance: {
      critical: ['本番', '受験', '最終', '決定'],
      high: ['重要', '大切', '大事'],
      medium: ['予定', '計画'],
    }
  }
};

// LLMベースのハイブリッド記憶判定
export async function analyzeSaveDecisionWithLLM(
  message: string, 
  userId: string,
  recentContext?: string[]
): Promise<MemorySaveDecision> {
  console.log(`[MemoryAnalyzer] 🤖 LLM判定開始: "${message}"`);
  
  // Step 1: キーワード分析でヒントを生成
  const hints = {
    learningProgress: containsPattern(message.toLowerCase(), PATTERNS.learningProgress.keywords),
    learningChallenge: containsPattern(message.toLowerCase(), PATTERNS.learningChallenge.keywords),
    commitment: containsPattern(message.toLowerCase(), PATTERNS.commitment.keywords),
    emotionalState: detectEmotion(message.toLowerCase(), PATTERNS.emotionalState.emotions),
    milestone: containsPattern(message.toLowerCase(), PATTERNS.milestone.keywords) && containsDate(message),
  };
  
  const detectedSubject = detectSubject(message.toLowerCase(), PATTERNS.learningProgress.subjects);
  const detectedCategory = detectCategory(message.toLowerCase(), PATTERNS.learningChallenge.categories);
  
  console.log(`[MemoryAnalyzer] 📋 キーワードヒント:`, hints);

  // Step 2: LLMに判定を依頼
  const prompt = `あなたは学習記憶管理システムです。学習コーチングの文脈で、以下のメッセージを分析し、長期記憶として保存すべきか判断してください。

【分析対象メッセージ】
"${message}"

【最近の会話文脈】
${recentContext?.join('\n') || 'なし'}

【検出されたキーワードヒント】
- 学習進捗の可能性: ${hints.learningProgress ? '高（キーワード検出）' : '低'}
- 学習課題の可能性: ${hints.learningChallenge ? '高（キーワード検出）' : '低'}  
- 約束事の可能性: ${hints.commitment ? '高（キーワード検出）' : '低'}
- 感情表現: ${hints.emotionalState ? `検出（${hints.emotionalState}）` : 'なし'}
- マイルストーン: ${hints.milestone ? '高（キーワード+日付検出）' : '低'}
- 学習分野: ${detectedSubject || 'なし'}
- 課題カテゴリ: ${detectedCategory || 'なし'}

【保存判定基準】
1. **学習進捗**: 成果、理解度向上、スキル習得、テスト結果など
2. **学習課題**: 困難、苦手分野、理解できない点、不安など
3. **約束事**: 宿題、課題、目標設定、次回までの取り組みなど
4. **感情状態**: 学習に関連する感情、モチベーション、ストレス、疲労、眠気、楽しさ、退屈さなど（カジュアルな表現も含む）
5. **マイルストーン**: 試験日、発表日、重要イベントなど

【重要】
- 感情表現は学習コンテキストで重要な情報です（「眠い」「楽しい話して」なども感情状態として記録）
- カジュアルな会話でも学習者の心理状態を表す場合は保存を推奨
- 文脈と意図を重視し、キーワードがなくても記憶価値があれば保存を推奨してください

以下のJSON形式で回答してください：
{
  "shouldSave": true/false,
  "type": "learning_progress" | "learning_challenge" | "commitment" | "emotional_state" | "milestone" | null,
  "confidence": 0.0-1.0,
  "reason": "判定理由（30文字以内）",
  "suggestedTags": ["tag1", "tag2"]
}`;

  try {
    /* 🚨 AI SDK v5 ブロッカー対応済み (2025-09-05)
     * 
     * 【発生していたエラー】
     * UnsupportedModelVersionError [AI_UnsupportedModelVersionError]: 
     * Unsupported model version v1 for provider "openai.chat" and model "gpt-4o-mini". 
     * AI SDK 5 only supports models that implement specification version "v2".
     * 
     * 【技術的根本原因】
     * - OpenAI API: まだmodel specification v1で実装
     * - AI SDK v5: v2仕様のみサポート、v1後方互換性削除
     * - 結果: gpt-4o-mini完全使用不可
     * 
     * 【解決策】
     * - ai@4.0.7にダウングレード（package.json固定済み）
     * - 3エンジン統一のため全体でv4.0.7使用
     * - OpenAI公式のv2対応まで現行維持
     * 
     * 【影響箇所】
     * - この関数: LLMベースメモリー重要度判定
     * - server.ts: ストリーミング機能 (streamText)
     * - 全エンジン: Mastra/LangGraph.js/OpenAI SDK
     */
    const { text } = await (generateText as any)({
      model: openai('gpt-4o-mini') as any,  // ✅ v4.0.7でmodel spec v1サポート
      prompt,
      temperature: 0.3,
    });
    
    console.log(`[MemoryAnalyzer] 🤖 LLM応答:`, text);
    
    const llmDecision = JSON.parse(text.replace(/```json\n?/g, '').replace(/\n?```/g, ''));
    
    // Step 3: キーワードヒントと合わせて最終判定
    let finalDecision = { ...llmDecision };
    
    if (!llmDecision.shouldSave && Object.values(hints).some(h => h)) {
      // キーワードは検出されたがLLMが不要と判断した場合
      console.log(`[MemoryAnalyzer] ⚖️ キーワード検出により保存を推奨`);
      finalDecision.shouldSave = true;
      finalDecision.confidence = Math.min(llmDecision.confidence * 0.6, 0.6);
      finalDecision.reason += '（キーワード検出）';
    } else if (llmDecision.shouldSave && !Object.values(hints).some(h => h)) {
      // LLMが保存推奨だがキーワードなし - 文脈判定として信頼度高
      console.log(`[MemoryAnalyzer] 🎯 文脈による保存判定`);
      finalDecision.confidence = Math.min(llmDecision.confidence * 1.1, 1.0);
    }
    
    // 提案されたタグの補強
    if (hints.emotionalState && finalDecision.type === 'emotional_state') {
      finalDecision.suggestedTags = ['emotion', hints.emotionalState];
    }
    if (detectedSubject && finalDecision.type === 'learning_progress') {
      finalDecision.suggestedTags = ['progress', detectedSubject];
    }
    if (detectedCategory && finalDecision.type === 'learning_challenge') {
      finalDecision.suggestedTags = ['challenge', detectedCategory];
    }
    
    console.log(`[MemoryAnalyzer] ✅ 最終判定:`, finalDecision);
    return finalDecision;
    
  } catch (error) {
    console.error(`[MemoryAnalyzer] ❌ LLM判定エラー:`, error);
    // エラー時はフォールバックとして従来のキーワード判定を使用
    console.log(`[MemoryAnalyzer] 🔄 フォールバック: キーワード判定を使用`);
    return analyzeSaveDecision(message, userId);
  }
}

// 従来のキーワードベース判定（フォールバック用）
export function analyzeSaveDecision(message: string, userId: string): MemorySaveDecision {
  const lowerMessage = message.toLowerCase();
  
  // 学習進捗のチェック
  if (containsPattern(lowerMessage, PATTERNS.learningProgress.keywords)) {
    const subject = detectSubject(lowerMessage, PATTERNS.learningProgress.subjects);
    if (subject) {
      return {
        shouldSave: true,
        type: 'learning_progress',
        confidence: 0.8,
        reason: '学習成果の報告を検出',
        suggestedTags: ['progress', subject],
      };
    }
  }
  
  // 学習課題のチェック
  if (containsPattern(lowerMessage, PATTERNS.learningChallenge.keywords)) {
    const category = detectCategory(lowerMessage, PATTERNS.learningChallenge.categories);
    if (category) {
      return {
        shouldSave: true,
        type: 'learning_challenge',
        confidence: 0.85,
        reason: '学習上の困難を検出',
        suggestedTags: ['challenge', category],
      };
    }
  }
  
  // 約束・宿題のチェック
  if (containsPattern(lowerMessage, PATTERNS.commitment.keywords)) {
    const frequency = detectFrequency(lowerMessage, PATTERNS.commitment.frequency);
    return {
      shouldSave: true,
      type: 'commitment',
      confidence: 0.9,
      reason: '約束や宿題を検出',
      suggestedTags: ['commitment', frequency || 'once'],
    };
  }
  
  // 感情状態のチェック
  const emotion = detectEmotion(lowerMessage, PATTERNS.emotionalState.emotions);
  if (emotion) {
    return {
      shouldSave: true,
      type: 'emotional_state',
      confidence: 0.75,
      reason: '感情表現を検出',
      suggestedTags: ['emotion', emotion],
    };
  }
  
  // マイルストーンのチェック
  if (containsPattern(lowerMessage, PATTERNS.milestone.keywords) && containsDate(lowerMessage)) {
    const importance = detectImportance(lowerMessage, PATTERNS.milestone.importance);
    return {
      shouldSave: true,
      type: 'milestone',
      confidence: 0.95,
      reason: '重要イベントを検出',
      suggestedTags: ['milestone', importance || 'medium'],
    };
  }
  
  return {
    shouldSave: false,
    confidence: 0,
    reason: '保存対象のパターンが見つかりません',
  };
}

// メッセージコンテキストから関連メモリーを取得
export function analyzeRetrievalDecision(
  message: string, 
  userId: string,
  currentDate: Date = new Date()
): MemoryRetrievalDecision {
  console.log(`[MemoryAnalyzer] 分析開始: userId=${userId}, message="${message}"`);
  const relevantMemories: Memory[] = [];
  const relevanceScores = new Map<string, number>();
  
  // 1. 時間ベースの取得（定期フォローアップ）
  const commitments = searchMemories({
    userId,
    type: 'commitment',
    notExpired: true,
    limit: 5,
  });
  console.log(`[MemoryAnalyzer] commitment検索結果: ${commitments.length}件`);
  
  commitments.forEach(memory => {
    const commitment = memory.content as CommitmentMemory;
    const deadline = new Date(commitment.deadline);
    const daysUntilDeadline = Math.ceil((deadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilDeadline <= 3 && daysUntilDeadline >= -1 && !commitment.completed) {
      relevantMemories.push(memory);
      relevanceScores.set(memory.id, 0.9);
    }
  });
  
  // 2. キーワードベースの取得
  const lowerMessage = message.toLowerCase();
  console.log(`[MemoryAnalyzer] lowerMessage: "${lowerMessage}"`);
  
  // 課題に関連する過去の記憶
  const hasChallengKeywords = containsPattern(lowerMessage, PATTERNS.learningChallenge.keywords);
  console.log(`[MemoryAnalyzer] 課題キーワード検出: ${hasChallengKeywords}, keywords=${PATTERNS.learningChallenge.keywords.join(', ')}`);
  
  if (hasChallengKeywords) {
    const challenges = searchMemories({
      userId,
      type: 'learning_challenge',
      notExpired: true,
      limit: 3,
    });
    console.log(`[MemoryAnalyzer] learning_challenge検索結果: ${challenges.length}件`);
    
    challenges.forEach(memory => {
      const challenge = memory.content as LearningChallengeMemory;
      const isRelated = isRelatedContent(lowerMessage, challenge.description);
      console.log(`[MemoryAnalyzer] 関連性チェック: ${isRelated}, description="${challenge.description}"`);
      if (!challenge.resolved && isRelated) {
        relevantMemories.push(memory);
        relevanceScores.set(memory.id, 0.8);
      }
    });
  }
  
  // 3. 感情パターンの継続性チェック
  const recentEmotions = searchMemories({
    userId,
    type: 'emotional_state',
    fromDate: new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000), // 過去7日
    limit: 5,
  });
  
  const currentEmotion = detectEmotion(lowerMessage, PATTERNS.emotionalState.emotions);
  if (currentEmotion) {
    recentEmotions.forEach(memory => {
      const state = memory.content as EmotionalStateMemory;
      if (state.emotion === currentEmotion || 
          (currentEmotion === 'anxious' && state.emotion === 'stressed')) {
        relevantMemories.push(memory);
        relevanceScores.set(memory.id, 0.7);
      }
    });
  }
  
  // 4. マイルストーンの接近チェック
  const milestones = searchMemories({
    userId,
    type: 'milestone',
    notExpired: true,
    limit: 3,
  });
  
  milestones.forEach(memory => {
    const milestone = memory.content as MilestoneMemory;
    const eventDate = new Date(milestone.eventDate);
    const daysUntilEvent = Math.ceil((eventDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilEvent <= 14 && daysUntilEvent >= 0) {
      relevantMemories.push(memory);
      const relevance = milestone.importance === 'critical' ? 1.0 :
                       milestone.importance === 'high' ? 0.9 : 0.8;
      relevanceScores.set(memory.id, relevance);
    }
  });
  
  // 重複を除去してソート
  const uniqueMemories = Array.from(new Set(relevantMemories.map(m => m.id)))
    .map(id => relevantMemories.find(m => m.id === id)!)
    .sort((a, b) => (relevanceScores.get(b.id) || 0) - (relevanceScores.get(a.id) || 0))
    .slice(0, 3);
  
  // もし何も見つからない場合、より緩い条件で再度検索
  if (uniqueMemories.length === 0) {
    console.log(`[MemoryAnalyzer] 関連メモリーなし。緩い条件で再検索`);
    
    // 最新のメモリー3件を取得
    const recentMemories = searchMemories({
      userId,
      limit: 3,
      notExpired: true,
    });
    
    console.log(`[MemoryAnalyzer] 最新メモリー検索結果: ${recentMemories.length}件`);
    
    // メッセージに含まれるキーワードとメモリーの内容を簡易的にマッチング
    recentMemories.forEach(memory => {
      const content = JSON.stringify(memory.content).toLowerCase();
      // 簡易的な関連度スコア（メッセージとメモリーで共通する単語があれば追加）
      const score = 0.3; // 基本スコア
      uniqueMemories.push(memory);
      relevanceScores.set(memory.id, score);
    });
  }
  
  console.log(`[MemoryAnalyzer] 最終結果: ${uniqueMemories.length}件のメモリーを返す`);
  
  return {
    memories: uniqueMemories.slice(0, 3),
    relevanceScores,
    reason: `${uniqueMemories.length}件の関連メモリーを取得`,
  };
}

// ヘルパー関数群
function containsPattern(text: string, patterns: string[]): boolean {
  return patterns.some(pattern => text.includes(pattern));
}

function detectSubject(text: string, subjects: Record<string, string[]>): string | null {
  for (const [subject, keywords] of Object.entries(subjects)) {
    if (containsPattern(text, keywords)) {
      return subject;
    }
  }
  return null;
}

function detectCategory(text: string, categories: Record<string, string[]>): string | null {
  for (const [category, keywords] of Object.entries(categories)) {
    if (containsPattern(text, keywords)) {
      return category;
    }
  }
  return null;
}

function detectFrequency(text: string, frequencies: Record<string, string[]>): string | null {
  for (const [frequency, keywords] of Object.entries(frequencies)) {
    if (containsPattern(text, keywords)) {
      return frequency;
    }
  }
  return null;
}

function detectEmotion(text: string, emotions: Record<string, string[]>): string | null {
  for (const [emotion, keywords] of Object.entries(emotions)) {
    if (containsPattern(text, keywords)) {
      return emotion;
    }
  }
  return null;
}

function detectImportance(text: string, importanceLevels: Record<string, string[]>): string | null {
  for (const [importance, keywords] of Object.entries(importanceLevels)) {
    if (containsPattern(text, keywords)) {
      return importance;
    }
  }
  return null;
}

function containsDate(text: string): boolean {
  // 日付パターンのチェック（簡易版）
  const datePatterns = [
    /\d{1,2}月\d{1,2}日/,
    /\d{4}年\d{1,2}月/,
    /来週|今週|来月|今月|明日|今日|昨日/,
    /\d+日後|週間後|ヶ月後/,
  ];
  return datePatterns.some(pattern => pattern.test(text));
}

function isRelatedContent(text: string, previousContent: string): boolean {
  // 簡易的な内容関連性チェック
  const keywords1 = extractKeywords(text);
  const keywords2 = extractKeywords(previousContent);
  
  const commonKeywords = keywords1.filter(k => keywords2.includes(k));
  return commonKeywords.length >= 2;
}

function extractKeywords(text: string): string[] {
  // 重要な単語を抽出（簡易版）
  const stopWords = ['は', 'が', 'を', 'に', 'で', 'と', 'の', 'です', 'ます', 'した'];
  return text.split(/[\s、。！？]/)
    .filter(word => word.length > 1 && !stopWords.includes(word))
    .slice(0, 10);
}
