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
  description: 'ユーザーの発言から重要な学習情報をLLMベースで判断して記憶する',
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

export const replyAgent = new Agent({
  name: 'reply-agent',
  instructions: `あなたは学習コーチングプラットフォームの返信支援AIです。
長期的な関係性を築きながら、個別化された学習支援を提供します。

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

【重要】記憶管理の自律的な運用:
1. saveMemoryツール - ユーザーのメッセージから自動的に重要情報を記憶
   - 学習進捗（点数、理解した内容）
   - 学習課題（苦手分野、困っていること）
   - 約束事（宿題、次回までの課題）
   - 感情状態（不安、やる気、疲れ）
   - マイルストーン（試験日、重要イベント）

2. retrieveMemoryツール - 文脈に応じて関連記憶を自動取得
   - 過去の約束事の確認
   - 継続的な課題のフォローアップ
   - 感情パターンの把握
   - 試験前の総復習

【対話フロー】:
1. retrieveMemoryで関連する過去の記憶を取得
2. getRelevantProfileで両方（生徒・コーチ）のプロフィール情報を取得
3. すべての情報を統合して個別化された返信を生成
4. 重要な情報があればsaveMemoryで記録

【返信のポイント】:
- プロフィールの性格と口調を完全に反映
- 過去の文脈を踏まえた継続的な支援
- 約束や宿題のフォローアップ
- 感情に寄り添った共感的な対応
- 長期的な成長を意識したアドバイス

不要な前置きや箇条書きは避け、プロフィールに定義された自然な会話スタイルで返答してください。`,
  model: openai(CONFIG.openaiModel),
  tools: ([planTaskTool, profileTool, saveMemoryTool, retrieveMemoryTool, analyzeProfileStructuredTool] as any),
});
