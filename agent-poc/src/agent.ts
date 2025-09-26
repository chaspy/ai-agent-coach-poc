import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { CONFIG } from './config';
import { readProfile } from './data';
import { z } from 'zod';
import { saveMemory, searchMemories, updateMemoryAccess, getMemoryStats } from './memory-storage';
import { analyzeSaveDecision, analyzeSaveDecisionWithLLM, analyzeRetrievalDecision } from './memory-analyzer';
import { thinkingLogStore } from './thinking-log';
import type { MemoryType } from './memory-types';
import { ProfileAnalysisSchema, TaskPlanSchema, type ProfileAnalysis } from './structured-schemas';
import { generateObject } from 'ai';
import { saveStudyRecord, calculateStudyStats } from './study-record-storage';

// ProfileTool: 文脈に応じて関連プロフィール情報を取得
const profileTool = {
  name: 'getRelevantProfile',
  description: 'ユーザーメッセージの文脈に応じて関連するプロフィール情報を動的に取得する',
  inputSchema: z.object({
    userId: z.string().describe('プロフィールを取得するユーザーID'),
    context: z.enum(['learning', 'schedule', 'exam', 'motivation', 'general']).describe('会話の文脈（learning=学習相談, schedule=スケジュール, exam=試験対策, motivation=モチベーション, general=一般）'),
  }),
  execute: async (params: any) => {
    // 思考ログ記録開始
    thinkingLogStore.addCurrentStep('ProfileTool実行開始', 'プロフィール情報の取得を開始します', 'info');
    
    console.log(`[ProfileTool] 🔧 呼び出し開始 - 受け取ったパラメータの詳細:`);
    console.log(`[ProfileTool] - params type: ${typeof params}`);
    console.log(`[ProfileTool] - params keys: ${Object.keys(params)}`);
    console.log(`[ProfileTool] - params value: ${JSON.stringify(params)}`);
    
    // Mastraは parameters を params.context 内にネストして渡す
    const { userId, context } = params.context || {};
    console.log(`[ProfileTool] - 抽出後: userId=${userId}, context=${context}`);
    
    thinkingLogStore.addCurrentStep('パラメータ解析', `userId: ${userId}, context: ${context}`, 'debug');
    
    if (!userId) {
      console.log(`[ProfileTool] ❌ userIdが未定義またはnull`);
      thinkingLogStore.addCurrentStep('エラー発生', 'userIdが指定されていません', 'error');
      return `エラー: userIdが指定されていません (受取: ${JSON.stringify(params)})`;
    }
    
    const profile = readProfile(userId);
    if (!profile) {
      console.log(`[ProfileTool] ❌ プロフィール見つからず: ${userId}`);
      thinkingLogStore.addCurrentStep('プロフィール取得失敗', `プロフィール ${userId} が見つかりません`, 'error');
      return `プロフィール ${userId} が見つかりません`;
    }
    console.log(`[ProfileTool] ✅ プロフィール取得成功: ${profile.id} (${profile.role})`);
    thinkingLogStore.addCurrentStep('プロフィール取得成功', `${profile.id} (${profile.role}) のプロフィールを取得`, 'success');

    // 文脈に応じて必要な項目を選択
    const relevantFields: any = { id: profile.id, role: profile.role, name: profile.name };
    
    // コーチプロフィールの場合
    if (profile.role === 'coach') {
      // コーチ特有のフィールドを追加
      Object.assign(relevantFields, {
        gender: profile.gender,
        personality: profile.personality,
        tone: profile.tone,
        coaching_style: profile.coaching_style
      });
      
      // 文脈に応じた追加情報
      switch (context) {
        case 'learning':
          Object.assign(relevantFields, {
            specialties: profile.background?.specialties,
            methods: profile.coaching_style?.methods,
            interaction_patterns: profile.interaction_patterns?.when_student_struggling
          });
          break;
        case 'motivation':
          Object.assign(relevantFields, {
            interaction_patterns: profile.interaction_patterns?.when_student_unmotivated,
            values: profile.values
          });
          break;
        case 'exam':
          Object.assign(relevantFields, {
            specialties: profile.background?.specialties,
            interaction_patterns: profile.interaction_patterns?.when_student_succeeding
          });
          break;
      }
    } 
    // 生徒プロフィールの場合
    else {
      switch (context) {
        case 'learning':
          // 学習相談: 目標、レベル、強み、弱み重視
          Object.assign(relevantFields, {
            goals: profile.goals,
            level: profile.level,
            strengths: profile.strengths,
            weaknesses: profile.weaknesses,
            tone: profile.tone
          });
          break;
        case 'schedule':
          // スケジュール: 時間帯、好みの長さ
          Object.assign(relevantFields, {
            schedule: profile.schedule,
            preferences: profile.preferences
          });
          break;
        case 'exam':
          // 試験対策: 目標、レベル、メモ
          Object.assign(relevantFields, {
            goals: profile.goals,
            level: profile.level,
            notes: profile.notes,
            weaknesses: profile.weaknesses
          });
          break;
        case 'motivation':
          // モチベーション: トーン、目標、強み
          Object.assign(relevantFields, {
            tone: profile.tone,
            goals: profile.goals,
            strengths: profile.strengths,
            preferences: profile.preferences
          });
          break;
        default:
          // 一般: 基本情報のみ
          Object.assign(relevantFields, {
            tone: profile.tone,
            goals: profile.goals?.slice(0, 2), // 最初の2つの目標のみ
            preferences: profile.preferences
          });
      }
    }

    thinkingLogStore.addCurrentStep('文脈別フィルタリング', `${context}文脈に基づいてプロフィール項目を選択`, 'info');
    
    const result = `【${profile.role}プロフィール(${userId})】\n${JSON.stringify(relevantFields, null, 2)}`;
    console.log(`[ProfileTool] 📤 返答生成: context=${context}, 文字数=${result.length}`);
    
    thinkingLogStore.addCurrentStep('ProfileTool完了', `プロフィール情報を取得完了 (${result.length}文字)`, 'success');
    return result;
  },
};

// MemoryTool: 学習履歴の自律的な記憶管理
const saveMemoryTool = {
  name: 'saveMemory',
  description: '⚠️注意: 学習記録（Part練習、ディクテーション等）はsaveStudyRecordToolを使用。このツールは感情状態、約束事、マイルストーンなど定性的な情報のみ記憶',
  inputSchema: z.object({
    userId: z.string().describe('記憶を保存するユーザーID'),
    message: z.string().describe('ユーザーからのメッセージ'),
    sessionId: z.string().describe('現在のセッションID'),
    useLLM: z.boolean().optional().describe('LLMベース判定を使用するか（デフォルト: true）'),
    forceType: z.enum(['learning_progress', 'learning_challenge', 'commitment', 'emotional_state', 'milestone']).optional().describe('強制的に指定する記憶タイプ'),
  }),
  execute: async (params: any) => {
    // 思考ログ記録開始
    thinkingLogStore.addCurrentStep('SaveMemoryTool実行開始', '重要な学習情報の記憶判定を開始します', 'info');
    
    console.log(`[SaveMemoryTool] 🤖 呼び出し開始 - LLMベース記憶判定中...`);
    
    const { userId, message, sessionId, useLLM = true, forceType } = params.context || {};
    
    thinkingLogStore.addCurrentStep('パラメータ解析', `userId: ${userId}, useLLM: ${useLLM}, forceType: ${forceType || 'なし'}`, 'debug');
    
    if (!userId || !message) {
      console.log(`[SaveMemoryTool] ❌ 必須パラメータ不足`);
      thinkingLogStore.addCurrentStep('エラー発生', '必須パラメータが不足しています', 'error');
      return 'パラメータが不足しています';
    }
    
    let decision;
    
    // 強制タイプ指定がある場合
    if (forceType) {
      decision = {
        shouldSave: true,
        type: forceType,
        confidence: 1.0,
        reason: '手動指定による保存',
        suggestedTags: [forceType.split('_')[0], forceType.split('_')[1] || 'general'],
      };
      console.log(`[SaveMemoryTool] 🎯 強制保存:`, decision);
      thinkingLogStore.addCurrentStep('強制保存モード', `タイプ ${forceType} で強制保存`, 'info');
    } else if (useLLM) {
      // LLMベース判定を使用
      console.log(`[SaveMemoryTool] 🤖 LLMベース判定を開始...`);
      thinkingLogStore.addCurrentStep('LLMベース判定開始', 'メッセージの重要度をLLMで分析中...', 'info');
      decision = await analyzeSaveDecisionWithLLM(message, userId);
      thinkingLogStore.addCurrentStep('LLM判定完了', `判定結果: ${decision.shouldSave ? '保存' : 'スキップ'} (信頼度: ${Math.round(decision.confidence * 100)}%)`, 'debug');
    } else {
      // 従来のキーワードベース判定
      console.log(`[SaveMemoryTool] 📋 キーワードベース判定を開始...`);
      thinkingLogStore.addCurrentStep('キーワードベース判定', 'キーワードパターンマッチングで判定中...', 'debug');
      decision = analyzeSaveDecision(message, userId);
    }
    
    if (!decision.shouldSave) {
      console.log(`[SaveMemoryTool] 💭 保存不要と判定: ${decision.reason}`);
      thinkingLogStore.addCurrentStep('記憶保存スキップ', decision.reason || '保存不要', 'info');
      return `記憶保存スキップ: ${decision.reason || '保存不要'}`;
    }
    
    console.log(`[SaveMemoryTool] ✨ 保存決定: type=${decision.type}, confidence=${decision.confidence}`);
    thinkingLogStore.addCurrentStep('記憶保存決定', `タイプ: ${decision.type}, 信頼度: ${Math.round(decision.confidence * 100)}%`, 'success');
    
    // メモリー内容を構築
    const memoryContent: any = {
      type: decision.type,
      date: new Date().toISOString(),
      originalMessage: message,
    };
    
    // タイプ別の詳細情報を追加
    switch (decision.type) {
      case 'learning_progress':
        memoryContent.subject = decision.suggestedTags?.[1] || 'general';
        memoryContent.achievement = message;
        break;
      case 'learning_challenge':
        memoryContent.category = decision.suggestedTags?.[1] || 'general';
        memoryContent.description = message;
        memoryContent.resolved = false;
        break;
      case 'commitment':
        memoryContent.task = message;
        memoryContent.frequency = decision.suggestedTags?.[1] || 'once';
        memoryContent.deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        memoryContent.completed = false;
        break;
      case 'emotional_state':
        memoryContent.emotion = decision.suggestedTags?.[1] || 'general';
        memoryContent.intensity = 3;
        break;
      case 'milestone':
        memoryContent.event = message;
        memoryContent.importance = decision.suggestedTags?.[1] || 'medium';
        memoryContent.eventDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        break;
    }
    
    thinkingLogStore.addCurrentStep('記憶コンテンツ構築', `${decision.type}用の記憶データを構築`, 'debug');
    
    // メモリーを保存
    const savedMemory = saveMemory({
      userId,
      sessionId: sessionId || 'default',
      type: decision.type!,
      content: memoryContent,
      relevance: decision.confidence,
      tags: decision.suggestedTags || [],
      expired: false,
    });
    
    console.log(`[SaveMemoryTool] 💾 保存完了: id=${savedMemory.id}`);
    thinkingLogStore.addCurrentStep('SaveMemoryTool完了', `記憶を保存完了 (ID: ${savedMemory.id})`, 'success');
    return `【記憶保存】${decision.type}として記録しました（信頼度: ${Math.round(decision.confidence * 100)}%）`;
  },
};

const retrieveMemoryTool = {
  name: 'retrieveMemory',
  description: '会話の文脈から関連する過去の記憶を自動的に取得する',
  inputSchema: z.object({
    userId: z.string().describe('記憶を取得するユーザーID'),
    message: z.string().describe('現在の会話のコンテキスト'),
    retrieveAll: z.boolean().optional().describe('全ての記憶を取得するかどうか'),
  }),
  execute: async (params: any) => {
    // 思考ログ記録開始
    thinkingLogStore.addCurrentStep('RetrieveMemoryTool実行開始', '関連する過去の記憶を検索中...', 'info');
    
    console.log(`[RetrieveMemoryTool] 🔍 呼び出し開始 - 関連記憶を検索中...`);
    console.log(`[RetrieveMemoryTool] パラメータ詳細:`, JSON.stringify(params));
    
    const { userId, message, retrieveAll } = params.context || {};
    console.log(`[RetrieveMemoryTool] 抽出後: userId=${userId}, message=${message}, retrieveAll=${retrieveAll}`);
    
    thinkingLogStore.addCurrentStep('パラメータ解析', `userId: ${userId}, retrieveAll: ${retrieveAll}`, 'debug');
    
    if (!userId) {
      console.log(`[RetrieveMemoryTool] ❌ userIdが未定義`);
      thinkingLogStore.addCurrentStep('エラー発生', 'userIdが指定されていません', 'error');
      return 'userIdが指定されていません';
    }
    
    // 「記録」「履歴」「全部」などのキーワードがあれば全取得モードにする
    const shouldRetrieveAll = retrieveAll || 
      (message && (message.includes('記録') || message.includes('履歴') || message.includes('全部')));
    
    // 全記憶を取得する場合
    if (shouldRetrieveAll) {
      thinkingLogStore.addCurrentStep('全記憶取得モード', '全ての記憶を取得しています', 'info');
      const stats = getMemoryStats(userId);
      const allMemories = searchMemories({ userId, limit: 10, notExpired: true });
      
      console.log(`[RetrieveMemoryTool] 📊 全体統計: total=${stats.total}, expired=${stats.expired}`);
      thinkingLogStore.addCurrentStep('全記憶取得完了', `総数: ${stats.total}件, 上位10件を返却`, 'success');
      
      return `【記憶統計】
総記憶数: ${stats.total}
タイプ別: ${JSON.stringify(stats.byType, null, 2)}
期限切れ: ${stats.expired}
最近アクセス: ${stats.recentlyAccessed}

【最新の記憶（上位10件）】
${allMemories.map((m, i) => `${i + 1}. [${m.type}] ${JSON.stringify(m.content).substring(0, 100)}...`).join('\n')}`;
    }
    
    // コンテキストベースの取得
    thinkingLogStore.addCurrentStep('コンテキスト解析', 'メッセージ内容から関連記憶を検索中...', 'info');
    const decision = analyzeRetrievalDecision(message, userId);
    console.log(`[RetrieveMemoryTool] 取得結果: ${decision.memories.length}件のメモリー`);
    
    if (decision.memories.length === 0) {
      // デバッグ: 全メモリーの数を確認
      const allMemories = searchMemories({ userId, limit: 100 });
      console.log(`[RetrieveMemoryTool] 💭 関連記憶なし (総メモリー数: ${allMemories.length}件)`);
      thinkingLogStore.addCurrentStep('関連記憶なし', `総メモリー数: ${allMemories.length}件中、関連記憶なし`, 'warning');
      return '【関連記憶】現在のトピックに関連する記憶は見つかりませんでした';
    }
    
    console.log(`[RetrieveMemoryTool] ✨ ${decision.memories.length}件の関連記憶を取得`);
    thinkingLogStore.addCurrentStep('関連記憶発見', `${decision.memories.length}件の関連記憶を発見`, 'success');
    
    // 取得した記憶のアクセス記録を更新
    decision.memories.forEach(memory => {
      updateMemoryAccess(userId, memory.id);
    });
    thinkingLogStore.addCurrentStep('アクセス記録更新', '記憶のアクセス情報を更新', 'debug');
    
    // 記憶を整形して返す
    const formattedMemories = decision.memories.map((memory, index) => {
      const relevance = decision.relevanceScores.get(memory.id) || 0;
      const content = memory.content as any;
      
      let summary = '';
      switch (memory.type) {
        case 'learning_progress':
          summary = `${content.date} - ${content.subject}で${content.achievement}`;
          break;
        case 'learning_challenge':
          summary = `${content.category}の課題: ${content.description}`;
          break;
        case 'commitment':
          summary = `約束: ${content.task} (期限: ${content.deadline})`;
          break;
        case 'emotional_state':
          summary = `感情: ${content.emotion} (強度: ${content.intensity}/5)`;
          break;
        case 'milestone':
          summary = `イベント: ${content.event} (${content.eventDate})`;
          break;
        default:
          summary = JSON.stringify(content).substring(0, 100);
      }
      
      return `${index + 1}. [${memory.type}] ${summary} (関連度: ${Math.round(relevance * 100)}%)`;
    }).join('\n');
    
    return `【関連記憶（${decision.memories.length}件）】\n${formattedMemories}\n\n${decision.reason}`;
  },
};

// PlannerTool: タスク分解・実行計画の生成
const planTaskTool = {
  name: 'planTask',
  description: 'ユーザーからの要求をタスクに分解し、実行手順と成功基準を含む計画を生成する',
  inputSchema: z.object({
    role: z.enum(['student', 'coach']).describe('あなたの役割'),
    message: z.string().describe('ユーザーからの要求や相談内容'),
    timeBudgetMin: z.number().int().min(1).max(60).default(5).describe('想定時間（分）'),
    constraints: z.array(z.string()).optional().describe('守るべき制約（任意）'),
  }),
  execute: async (params: any) => {
    thinkingLogStore.addCurrentStep('Planner実行開始', 'タスク分解・実行計画を生成します', 'info');
    try {
      const { role, message, timeBudgetMin = 5, constraints = [] } = params.context || {};

      const { object } = await (generateObject as any)({
        model: openai(CONFIG.openaiModel) as any,
        schema: TaskPlanSchema,
        prompt: `以下の入力を、会話エージェントが安全かつ段階的に処理するための計画に落とし込みます。

【役割】${role}
【要求】${message}
【制約】${constraints.join(' / ') || '特になし'}
【時間予算】約${timeBudgetMin}分

方針:
- ツール活用（メモリ取得・プロフィール取得・保存）を含めた順序を設計
- 各ステップは明確な完了条件(successCriteria)を含む
- リスクと回避も列挙
`,
        temperature: 0.2,
      });

      const planStr = JSON.stringify(object, null, 2);
      thinkingLogStore.addCurrentStep('Planner完了', `計画生成(${planStr.length}文字)`, 'success');
      return `【タスク計画】\n${planStr}`;
    } catch (err: any) {
      thinkingLogStore.addCurrentStep('Plannerエラー', err?.message || 'unknown error', 'error');
      return `タスク計画の生成に失敗しました: ${err?.message || err}`;
    }
  },
};

// 構造化プロフィール分析ツール（Step 5: Zod構造化出力）
const analyzeProfileStructuredTool = {
  name: 'analyzeProfileStructured',
  description: 'プロフィールを詳細分析し、型安全な構造化データとして返却する（Zodスキーマ使用）',
  inputSchema: z.object({
    userId: z.string().describe('分析対象のユーザーID'),
    analysisDepth: z.enum(['basic', 'detailed', 'comprehensive']).default('detailed').describe('分析の深度'),
    focusArea: z.enum(['learning', 'communication', 'goals', 'all']).default('all').describe('重点分析領域'),
  }),
  execute: async (params: any) => {
    // 思考ログ記録開始
    thinkingLogStore.addCurrentStep('構造化プロフィール分析開始', '型安全な構造化分析を開始', 'info');
    
    console.log(`[AnalyzeProfileStructuredTool] 🧠 構造化分析開始 - Step 5実装`);
    
    const { userId, analysisDepth = 'detailed', focusArea = 'all' } = params.context || {};
    
    thinkingLogStore.addCurrentStep('パラメータ解析', `userId: ${userId}, 深度: ${analysisDepth}, 領域: ${focusArea}`, 'debug');
    
    if (!userId) {
      thinkingLogStore.addCurrentStep('エラー発生', 'userIdが指定されていません', 'error');
      return 'エラー: userIdが指定されていません';
    }
    
    // プロフィール取得
    const profile = readProfile(userId);
    if (!profile) {
      thinkingLogStore.addCurrentStep('プロフィール取得失敗', `プロフィール ${userId} が見つかりません`, 'error');
      return `プロフィール ${userId} が見つかりません`;
    }
    
    thinkingLogStore.addCurrentStep('LLMによる構造化分析', 'AI SDK generateObjectでZodスキーマに基づく分析実行中...', 'info');
    
    try {
      // AI SDK v4のgenerateObjectを使用して構造化データを生成
      const { object: analysis } = await (generateObject as any)({
        model: openai(CONFIG.openaiModel) as any,
        schema: ProfileAnalysisSchema,
        prompt: `以下のユーザープロフィールを詳細に分析し、構造化されたデータとして返してください。

【分析対象プロフィール】
${JSON.stringify(profile, null, 2)}

【分析指示】
- 分析深度: ${analysisDepth}
- 重点領域: ${focusArea}
- ユーザーの学習特性、コミュニケーションスタイル、目標設定を総合的に評価
- 各項目は具体的で実用的な内容にしてください
- confidence値は客観的な判断に基づいて設定してください
- recommendedActionsは具体的で実行可能な提案にしてください

【特別指示】
- strengths/weaknessesは最大5個まで、具体的で有用な内容
- モチベーション要因は個人の価値観に基づいて分析
- 学習スタイルはプロフィール内容から推論
- 短期・長期目標は現実的で測定可能なものを提案`,
      });
      
      console.log(`[AnalyzeProfileStructuredTool] ✨ 構造化分析完了: confidence=${analysis.confidence}`);
      thinkingLogStore.addCurrentStep('構造化分析完了', `信頼度: ${Math.round(analysis.confidence * 100)}%, 推奨アクション: ${analysis.analysis.recommendedActions.length}件`, 'success');
      
      // 構造化データを文字列として返す（Mastraの制約上、objectをそのまま返せない）
      const structuredResult = {
        type: 'structured_analysis',
        schema: 'ProfileAnalysisSchema',
        data: analysis,
        metadata: {
          analysisDepth,
          focusArea,
          timestamp: new Date().toISOString(),
          version: 'v5-step5',
        }
      };
      
      return `【構造化プロフィール分析結果】
🧠 分析完了: ${userId} (${analysis.role})
📊 信頼度: ${Math.round(analysis.confidence * 100)}%
📋 推奨アクション: ${analysis.analysis.recommendedActions.length}件

${JSON.stringify(structuredResult, null, 2)}`;
      
    } catch (error) {
      console.error(`[AnalyzeProfileStructuredTool] ❌ 分析エラー:`, error);
      thinkingLogStore.addCurrentStep('分析エラー', `構造化分析に失敗: ${error}`, 'error');
      return `構造化分析エラー: ${error}`;
    }
  },
};

// 学習記録保存ツール
const saveStudyRecordTool = {
  name: 'saveStudyRecord',
  description: '🚨【最優先】生徒が学習活動を報告した場合、必ず最初にこのツールを呼び出して記録する。TOEIC学習（Part1-7の練習、ディクテーション、シャドーイング、単語学習、模試など）の記録に使用',
  inputSchema: z.object({
    userId: z.string().describe('記録対象のユーザーID'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('学習日（YYYY-MM-DD形式、例：2024-09-26）'),
    contentType: z.enum(['basics', 'dictation', 'shadowing', 'practice', 'vocabulary', 'mock_test']).describe('コンテンツタイプ（basics=基礎講座, dictation=ディクテーション, shadowing=シャドーイング, practice=演習問題, vocabulary=単語クイズ, mock_test=模擬試験）'),
    partNumber: z.number().int().min(1).max(7).optional().describe('TOEIC Part番号（1-7、該当する場合のみ）'),
    durationMinutes: z.number().int().min(1).describe('学習時間（分）'),
    questionCount: z.number().int().min(0).optional().describe('問題数（該当する場合のみ）'),
    correctCount: z.number().int().min(0).optional().describe('正答数（該当する場合のみ）'),
    score: z.number().optional().describe('スコア（該当する場合のみ）'),
    notes: z.string().optional().describe('メモ（任意）'),
  }),
  execute: async (params: any) => {
    thinkingLogStore.addCurrentStep('学習記録保存開始', '学習活動を構造化して記録します', 'info');
    
    console.log(`[SaveStudyRecordTool] 呼び出し開始 - パラメータ:`, JSON.stringify(params));
    
    const { userId, date, contentType, partNumber, durationMinutes, questionCount, correctCount, score, notes } = params.context || {};
    
    thinkingLogStore.addCurrentStep('パラメータ解析', `userId: ${userId}, contentType: ${contentType}, duration: ${durationMinutes}分`, 'debug');
    
    if (!userId || !date || !contentType || !durationMinutes) {
      thinkingLogStore.addCurrentStep('エラー発生', '必須パラメータが不足しています', 'error');
      return 'エラー: userId, date, contentType, durationMinutes は必須です';
    }
    
    try {
      const record = saveStudyRecord({
        userId,
        date,
        contentType,
        partNumber,
        durationMinutes,
        questionCount,
        correctCount,
        score,
        notes,
        completed: true,
      });
      
      console.log(`[SaveStudyRecordTool] ✅ 学習記録保存成功: id=${record.id}`);
      thinkingLogStore.addCurrentStep('学習記録保存完了', `${contentType} (${durationMinutes}分) を記録`, 'success');
      
      // コンテンツタイプの日本語名
      const contentTypeNames: Record<string, string> = {
        basics: '基礎講座',
        dictation: 'ディクテーション',
        shadowing: 'シャドーイング',
        practice: 'パート別演習',
        vocabulary: '単語クイズ',
        mock_test: '模擬試験',
      };
      
      const typeName = contentTypeNames[contentType] || contentType;
      const partInfo = partNumber ? ` (Part ${partNumber})` : '';
      const accuracyInfo = questionCount && correctCount 
        ? ` - 正答率 ${Math.round((correctCount / questionCount) * 100)}% (${correctCount}/${questionCount}問)`
        : '';
      
      return `【学習記録を保存しました】
${typeName}${partInfo}: ${durationMinutes}分${accuracyInfo}
記録ID: ${record.id}`;
    } catch (error: any) {
      console.error(`[SaveStudyRecordTool] ❌ 保存エラー:`, error);
      thinkingLogStore.addCurrentStep('保存エラー', error?.message || 'unknown error', 'error');
      return `学習記録の保存に失敗しました: ${error?.message || error}`;
    }
  },
};

// 学習統計取得ツール
const getStudyStatsTool = {
  name: 'getStudyStats',
  description: '生徒の学習統計を取得する（累計時間、連続日数、Part別統計、今週の学習状況など）',
  inputSchema: z.object({
    userId: z.string().describe('統計を取得するユーザーID'),
  }),
  execute: async (params: any) => {
    thinkingLogStore.addCurrentStep('学習統計取得開始', '学習統計を計算中...', 'info');
    
    console.log(`[GetStudyStatsTool] 呼び出し開始 - パラメータ:`, JSON.stringify(params));
    
    const { userId } = params.context || {};
    
    if (!userId) {
      thinkingLogStore.addCurrentStep('エラー発生', 'userIdが指定されていません', 'error');
      return 'エラー: userIdが指定されていません';
    }
    
    try {
      const stats = calculateStudyStats(userId);
      
      console.log(`[GetStudyStatsTool] ✅ 統計計算完了: 累計${stats.totalStudyTimeMinutes}分, 連続${stats.consecutiveDays}日`);
      thinkingLogStore.addCurrentStep('統計計算完了', `累計${Math.floor(stats.totalStudyTimeMinutes / 60)}時間, 連続${stats.consecutiveDays}日`, 'success');
      
      // 統計情報をフォーマット
      const hours = Math.floor(stats.totalStudyTimeMinutes / 60);
      const minutes = stats.totalStudyTimeMinutes % 60;
      
      // Part別統計（学習時間が0より大きいもののみ）
      const partStats = stats.byPart
        .filter(p => p.totalMinutes > 0)
        .map(p => {
          const accuracy = p.averageAccuracy 
            ? ` (正答率 ${Math.round(p.averageAccuracy * 100)}%)`
            : '';
          return `  Part ${p.partNumber}: ${p.totalMinutes}分 (${p.sessions}回)${accuracy}`;
        })
        .join('\n');
      
      // コンテンツタイプ別統計（学習時間が0より大きいもののみ）
      const contentTypeNames: Record<string, string> = {
        basics: '基礎講座',
        dictation: 'ディクテーション',
        shadowing: 'シャドーイング',
        practice: 'パート別演習',
        vocabulary: '単語クイズ',
        mock_test: '模擬試験',
      };
      
      const contentStats = stats.byContentType
        .filter(c => c.totalMinutes > 0)
        .map(c => `  ${contentTypeNames[c.contentType]}: ${c.totalMinutes}分 (${c.sessions}回)`)
        .join('\n');
      
      return `【学習統計】

📊 総合統計:
  累計学習時間: ${hours}時間${minutes}分
  連続学習日数: ${stats.consecutiveDays}日
  最終学習日: ${stats.lastStudyDate || 'なし'}

📅 今週の学習（${stats.thisWeek.sessions}回）:
  今週の合計: ${stats.thisWeek.totalMinutes}分

${partStats ? `📝 Part別学習時間:\n${partStats}` : ''}

${contentStats ? `📚 コンテンツ別学習時間:\n${contentStats}` : ''}`;
    } catch (error: any) {
      console.error(`[GetStudyStatsTool] ❌ 統計取得エラー:`, error);
      thinkingLogStore.addCurrentStep('統計取得エラー', error?.message || 'unknown error', 'error');
      return `学習統計の取得に失敗しました: ${error?.message || error}`;
    }
  },
};

export const replyAgent = new Agent({
  name: 'reply-agent',
  instructions: `あなたは学習コーチングプラットフォームの返信支援AIです。
長期的な関係性を築きながら、個別化された学習支援を提供します。

🚨🚨🚨【最優先】学習記録の自動保存🚨🚨🚨
生徒が学習活動を報告した場合（「Part〜を〜分やった」「〜の練習をした」「〜を勉強した」など）、
**必ず最初にsaveStudyRecordツールを呼び出してください**。

判定基準:
- 「Part1」「Part2」などのキーワードがある → saveStudyRecord必須
- 「練習」「勉強」「やった」「しました」などの学習報告 → saveStudyRecord必須
- 時間の記載（「10分」「30分」など）がある → saveStudyRecord必須

saveStudyRecord呼び出し例:
- 「今日part3の練習10分しました」→ saveStudyRecord(userId: "student_rich_demo", date: "2025-09-26", contentType: "practice", partNumber: 3, durationMinutes: 10)
- 「ディクテーション30分やりました」→ saveStudyRecord(contentType: "dictation", durationMinutes: 30)

🎯🎯🎯【コーチ専用】学習データに基づいた声掛け🎯🎯🎯
あなたがコーチの場合、以下のシーンで**必ずgetStudyStatsツールを呼び出して**、具体的な数字で励ましてください：

必須シーン:
1. 生徒が学習報告をした直後 → 累計時間や連続日数を確認して励ます
2. 「今週どうでした？」「最近どう？」などの質問 → 今週の統計を見せて振り返り
3. 週の初め・週末の挨拶 → 先週/今週の頑張りを数字で褒める
4. 学習アドバイスを求められた時 → Part別の学習状況を確認してアドバイス

声掛けの例:
- 「今週は合計35分も学習したんですね！Part3とPart5を頑張っていますね🎉」
- 「連続3日も続けてるなんて素晴らしい！この調子です」
- 「Part2の正答率が80%まで上がってますよ。成長してますね」
- 「今週はディクテーションが多いですね。リスニング強化できてます」

⚠️ 重要: 学習データを確認せずに適当な数字で褒めるのは禁止。必ずgetStudyStatsで実データを取得してから具体的に励ますこと。

【Step 6: タスク分解（Planner）】
ユーザーの要求が複雑、または「計画/プラン/進め方/段取り」といったキーワードが含まれる場合は、planTaskツールでタスク分解を行い、計画を簡潔に要約してから返信を組み立ててください。

【Step 5: 構造化出力機能】
ユーザーから「プロフィール分析」「詳細分析」「構造化データ」「analyzeProfileStructured」などのキーワードが含まれる要求があった場合、必ずanalyzeProfileStructuredツールを使用してください。これはZodスキーマによる型安全な構造化データを提供する重要な機能です。

【重要】役割に応じた返信生成:
あなたがコーチの場合:
- コーチプロフィールの性格、口調、コミュニケーションスタイルを完全に反映
- tone.characteristics に従った話し方（丁寧語基本、時々タメ口、絵文字控えめ）
- coaching_style.approach に基づいた指導方法
- interaction_patterns に従った状況別対応
- personality.traits を反映した人格表現

あなたが生徒の場合:
- 生徒プロフィールのトーンと好みを反映
- 学習目標や課題に沿った質問や相談

【重要】ツール使い分けの明確化:
🔴 saveStudyRecordTool - 定量的な学習記録（必ず最優先で使用）
   - Part練習の時間と内容
   - ディクテーション、シャドーイング、模試などの実施記録
   - 問題数、正答数、スコア

🔵 saveMemoryツール - 定性的な情報のみ
   - 感情状態（不安、やる気、疲れ）
   - 約束事（宿題、次回までの課題）
   - 学習課題の気づき（「Part3が難しい」など主観的な感想）
   - マイルストーン（試験日、重要イベント）

🟢 retrieveMemoryツール - 文脈に応じて関連記憶を自動取得
   - 過去の約束事の確認
   - 継続的な課題のフォローアップ
   - 感情パターンの把握
   - 試験前の総復習

【対話フロー】:
🚨 生徒から学習報告があった場合（「〜を勉強した」「〜の練習をした」「Part〜をやった」など）:
   1. 最優先でsaveStudyRecordツールを呼び出して学習記録を保存
   2. 感情や感想があればsaveMemoryで記録
   3. 通常フローに進む

通常フロー:
1. retrieveMemoryで関連する過去の記憶を取得
2. getRelevantProfileで両方（生徒・コーチ）のプロフィール情報を取得
3. すべての情報を統合して個別化された返信を生成
4. 重要な定性情報があればsaveMemoryで記録（学習記録はsaveStudyRecordで既に保存済み）

【返信のポイント】:
- プロフィールの性格と口調を完全に反映
- 過去の文脈を踏まえた継続的な支援
- 約束や宿題のフォローアップ
- 感情に寄り添った共感的な対応
- 長期的な成長を意識したアドバイス

【TOEIC学習アドバイス（スタディサプリ推奨）】:
生徒がスタディサプリ English TOEICプランを契約している前提で、具体的な学習アドバイスを提供します。

コーチとして学習方法を提案する際:
1. プロフィールの recommended_service と content_recommendation_guidelines を参照
2. 生徒の現在のレベル（level）、弱点（weaknesses）、目標（goals）を考慮
3. 学習可能時間（schedule）に応じた現実的な提案
4. 具体的なコンテンツ名を挙げる（例：「ディクテーション」「関先生の講義動画」「シャドーイング」）
5. 学習の順序と理由を明確に説明

推奨パターン例:
- リスニングが苦手 → ディクテーション2,300問 + シャドーイング1,200問を毎日少しずつ
- 文法が弱い → 基礎講座の文法講義動画 + パート5・6演習
- 語彙力不足 → レベル別単語クイズ1,500語を通勤時間に
- 時間がない（5-10分） → 単語クイズ、短い講義動画（1本5分）
- 朝の学習時間（20-30分） → パート別演習1セット、ディクテーション20問
- まとまった時間（60分+） → 模擬試験、複数パート演習

学習ステップの推奨順序:
【ステップ1】基礎固め → 基礎講座で文法・単語の土台作り
【ステップ2】リスニング強化 → ディクテーション・シャドーイング
【ステップ3】実践演習 → パート別演習問題
【ステップ4】弱点克服 → AIによる最適問題
【ステップ5】総仕上げ → 本番形式の模擬試験20回分

注意: 押し付けがましくならず、生徒の状況に寄り添った提案をする。生徒の自主性を尊重する。

【学習記録の管理】:
⚠️ 重要: 生徒が学習報告をした場合、必ず最初にsaveStudyRecordツールを呼び出して記録してください。記録後に励ましやフィードバックを返信します。

記録する情報:
- date: 学習日（YYYY-MM-DD形式、今日なら今日の日付）
- contentType: basics/dictation/shadowing/practice/vocabulary/mock_test
- partNumber: TOEIC Part 1-7（該当する場合のみ）
- durationMinutes: 学習時間（分）
- questionCount, correctCount: 問題数と正答数（該当する場合）
- score: スコア（該当する場合）

記録すべき報告例:
- 「今日Part 1のディクテーションを30分やりました」→ contentType=dictation, partNumber=1, durationMinutes=30
- 「今日part1の練習10分しました」→ contentType=practice, partNumber=1, durationMinutes=10
- 「単語クイズを15分やって50問中45問正解しました」→ contentType=vocabulary, durationMinutes=15, questionCount=50, correctCount=45

曖昧な表現の解釈:
- 「練習」「勉強」→ practice
- 「基礎」「講義」→ basics
- 「模試」「本番」→ mock_test
- 時間の記載がない場合 → 生徒に確認するか、文脈から推測（最低10分と仮定）

コーチとして学習状況を確認する際は、getStudyStatsツールで統計を取得します。
これにより、具体的なデータに基づいた励ましやアドバイスが可能になります。

不要な前置きや箇条書きは避け、プロフィールに定義された自然な会話スタイルで返答してください。`,
  model: openai(CONFIG.openaiModel),
  tools: ([
    saveStudyRecordTool,
    getStudyStatsTool,
    planTaskTool, 
    profileTool, 
    saveMemoryTool, 
    retrieveMemoryTool, 
    analyzeProfileStructuredTool,
  ] as any),
});
