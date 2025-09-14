import express from 'express';
import cors from 'cors';
import { Agent, run, setDefaultOpenAIKey, tool } from '@openai/agents';
import { z } from 'zod';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { CONFIG } from './config';
import { ensureDataDirs, readProfile, writeProfile, readRecentHistory, writeHistory } from './data';
import { logger } from './logger';
import { saveMemory, searchMemories, updateMemoryAccess, getMemoryStats } from './memory-storage';
import { analyzeSaveDecision, analyzeSaveDecisionWithLLM, analyzeRetrievalDecision } from './memory-analyzer';
import type { MemoryType } from './memory-types';
import { ProfileAnalysisSchema, type ProfileAnalysis } from './structured-schemas';
import { generateObject } from 'ai';

// ProfileTool: OpenAI Agents SDK用の関数ツール（正しい形式）
const getRelevantProfileTool = tool({
  name: 'getRelevantProfile',
  description: 'ユーザーメッセージの文脈に応じて関連するプロフィール情報を動的に取得する',
  parameters: z.object({
    userId: z.string().describe('プロフィールを取得するユーザーID'),
    context: z.enum(['learning', 'schedule', 'exam', 'motivation', 'general']).describe('会話の文脈（learning=学習相談, schedule=スケジュール, exam=試験対策, motivation=モチベーション, general=一般）'),
  }),
  execute: async (input: { userId: string; context: 'learning' | 'schedule' | 'exam' | 'motivation' | 'general' }) => {
    const { userId, context } = input;
    const profile = readProfile(userId);
    
    if (!profile) {
      return `プロフィール ${userId} が見つかりません`;
    }

    // 文脈に応じて必要な項目を選択
    const relevantFields: any = { id: profile.id, role: profile.role };
    
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

    return `【${profile.role}プロフィール(${userId})】\n${JSON.stringify(relevantFields, null, 2)}`;
  },
});

// SaveMemoryTool: OpenAI Agents SDK用の関数ツール
const saveMemoryTool = tool({
  name: 'saveMemory',
  description: 'ユーザーの発言から重要な学習情報をLLMベースで判断して記憶する',
  parameters: z.object({
    userId: z.string().describe('記憶を保存するユーザーID'),
    message: z.string().describe('ユーザーからのメッセージ'),
    sessionId: z.string().describe('現在のセッションID'),
    useLLM: z.boolean().nullable().optional().describe('LLMベース判定を使用するか（デフォルト: true）'),
    forceType: z.enum(['learning_progress', 'learning_challenge', 'commitment', 'emotional_state', 'milestone']).nullable().optional().describe('強制的に指定する記憶タイプ'),
  }),
  execute: async (input: { userId: string; message: string; sessionId: string; useLLM?: boolean; forceType?: string }) => {
    const { userId, message, sessionId, useLLM = true, forceType } = input;
    console.log(`[SaveMemoryTool] 🤖 呼び出し開始 - LLMベース記憶判定中...`);
    
    if (!userId || !message) {
      console.log(`[SaveMemoryTool] ❌ 必須パラメータ不足`);
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
    } else if (useLLM) {
      // LLMベース判定を使用
      console.log(`[SaveMemoryTool] 🤖 LLMベース判定を開始...`);
      decision = await analyzeSaveDecisionWithLLM(message, userId);
    } else {
      // 従来のキーワードベース判定
      console.log(`[SaveMemoryTool] 📋 キーワードベース判定を開始...`);
      decision = analyzeSaveDecision(message, userId);
    }
    
    if (!decision.shouldSave) {
      console.log(`[SaveMemoryTool] 💭 保存不要と判定: ${decision.reason}`);
      return `記憶保存スキップ: ${decision.reason}`;
    }
    
    console.log(`[SaveMemoryTool] ✨ 保存決定: type=${decision.type}, confidence=${decision.confidence}`);
    
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
    return `【記憶保存】${decision.type}として記録しました（信頼度: ${Math.round(decision.confidence * 100)}%）`;
  },
});

// RetrieveMemoryTool: OpenAI Agents SDK用の関数ツール
const retrieveMemoryTool = tool({
  name: 'retrieveMemory',
  description: '会話の文脈から関連する過去の記憶を自動的に取得する',
  parameters: z.object({
    userId: z.string().describe('記憶を取得するユーザーID'),
    message: z.string().describe('現在の会話のコンテキスト'),
    retrieveAll: z.boolean().nullable().optional().describe('全ての記憶を取得するかどうか'),
  }),
  execute: async (input: { userId: string; message: string; retrieveAll?: boolean }) => {
    const { userId, message, retrieveAll } = input;
    console.log(`[RetrieveMemoryTool] 🔍 呼び出し開始 - 関連記憶を検索中...`);
    
    if (!userId) {
      console.log(`[RetrieveMemoryTool] ❌ userIdが未定義`);
      return 'userIdが指定されていません';
    }
    
    // 「記録」「履歴」「全部」などのキーワードがあれば全取得モードにする
    const shouldRetrieveAll = retrieveAll || 
      (message && (message.includes('記録') || message.includes('履歴') || message.includes('全部')));
    
    // 全記憶を取得する場合
    if (shouldRetrieveAll) {
      const stats = getMemoryStats(userId);
      const allMemories = searchMemories({ userId, limit: 10, notExpired: true });
      
      console.log(`[RetrieveMemoryTool] 📊 全体統計: total=${stats.total}, expired=${stats.expired}`);
      
      return `【記憶統計】
総記憶数: ${stats.total}
タイプ別: ${JSON.stringify(stats.byType, null, 2)}
期限切れ: ${stats.expired}
最近アクセス: ${stats.recentlyAccessed}

【最新の記憶（上位10件）】
${allMemories.map((m, i) => `${i + 1}. [${m.type}] ${JSON.stringify(m.content).substring(0, 100)}...`).join('\n')}`;
    }
    
    // コンテキストベースの取得
    const decision = analyzeRetrievalDecision(message, userId);
    console.log(`[RetrieveMemoryTool] 取得結果: ${decision.memories.length}件のメモリー`);
    
    if (decision.memories.length === 0) {
      // デバッグ: 全メモリーの数を確認
      const allMemories = searchMemories({ userId, limit: 100 });
      console.log(`[RetrieveMemoryTool] 💭 関連記憶なし (総メモリー数: ${allMemories.length}件)`);
      return '【関連記憶】現在のトピックに関連する記憶は見つかりませんでした';
    }
    
    console.log(`[RetrieveMemoryTool] ✨ ${decision.memories.length}件の関連記憶を取得`);
    
    // 取得した記憶のアクセス記録を更新
    decision.memories.forEach(memory => {
      updateMemoryAccess(userId, memory.id);
    });
    
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
});

// 構造化プロフィール分析ツール（Step 5: OpenAI SDK用）
const analyzeProfileStructuredTool = tool({
  name: 'analyzeProfileStructured',
  description: 'プロフィールを詳細分析し、型安全な構造化データとして返却する（Zodスキーマ使用）',
  parameters: z.object({
    userId: z.string().describe('分析対象のユーザーID'),
    analysisDepth: z.enum(['basic', 'detailed', 'comprehensive']).default('detailed').describe('分析の深度'),
    focusArea: z.enum(['learning', 'communication', 'goals', 'all']).default('all').describe('重点分析領域'),
  }),
  execute: async (input: {
    userId: string;
    analysisDepth?: 'basic' | 'detailed' | 'comprehensive';
    focusArea?: 'learning' | 'communication' | 'goals' | 'all';
  }) => {
    const { userId, analysisDepth = 'detailed', focusArea = 'all' } = input;
    
    console.log(`[AnalyzeProfileStructuredTool-OA] 🧠 構造化分析開始 - Step 5実装`);
    
    if (!userId) {
      return 'エラー: userIdが指定されていません';
    }
    
    // プロフィール取得
    const profile = readProfile(userId);
    if (!profile) {
      return `プロフィール ${userId} が見つかりません`;
    }
    
    try {
      // AI SDK v4のgenerateObjectを使用して構造化データを生成
      const { object: analysis } = await generateObject({
        model: openai(CONFIG.model, { baseURL: CONFIG.openaiBaseUrl }),
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
      
      console.log(`[AnalyzeProfileStructuredTool-OA] ✨ 構造化分析完了: confidence=${analysis.confidence}`);
      
      // 構造化データを文字列として返す（OpenAI SDKの制約上、objectをそのまま返せない）
      const structuredResult = {
        type: 'structured_analysis',
        schema: 'ProfileAnalysisSchema',
        framework: 'OpenAI_SDK',
        data: analysis,
        metadata: {
          analysisDepth,
          focusArea,
          timestamp: new Date().toISOString(),
          version: 'v5-step5-openai-sdk',
        }
      };
      
      return `【構造化プロフィール分析結果 - OpenAI SDK】
🧠 分析完了: ${userId} (${analysis.role})
📊 信頼度: ${Math.round(analysis.confidence * 100)}%
📋 推奨アクション: ${analysis.analysis.recommendedActions.length}件

${JSON.stringify(structuredResult, null, 2)}`;
      
    } catch (error) {
      console.error(`[AnalyzeProfileStructuredTool-OA] ❌ 分析エラー:`, error);
      return `構造化分析エラー: ${error}`;
    }
  },
});

ensureDataDirs();
if (process.env.OPENAI_API_KEY) setDefaultOpenAIKey(process.env.OPENAI_API_KEY);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/agent/healthz', (_req, res) => res.json({ ok: true }));

app.post('/agent/ask', async (req, res) => {
  const { threadId, role, message, profileIds, debug } = req.body as any;
  if (!threadId || !role || !message || !profileIds?.self || !profileIds?.peer) {
    return res.status(400).json({ error: 'threadId, role, message, profileIds.self, profileIds.peer は必須' });
  }

  // ユーザーのメッセージを履歴に保存
  writeHistory(threadId, role, message);

  // 履歴情報の取得
  const history = readRecentHistory(threadId, 8);
  const historyContext = history.length 
    ? `【会話履歴 抜粋（新しい順 最大8件）】\n${history.map((h: any) => `- [${h.ts ?? ''} ${h.role ?? ''}] ${h.text}`).join('\n')}`
    : '';

  try {
    const agent = new Agent({
      name: 'reply-agent-oa',
      instructions: `あなたは学習コーチングプラットフォームの返信支援AIです。
長期的な関係性を築きながら、個別化された学習支援を提供します。

【Step 5: 構造化出力機能】
ユーザーから「プロフィール分析」「詳細分析」「構造化データ」「analyzeProfileStructured」などのキーワードが含まれる要求があった場合、必ずanalyzeProfileStructuredツールを使用してください。これはZodスキーマによる型安全な構造化データを提供する重要な機能です。

【重要】記憶管理の自律的な運用:
1. retrieveMemoryツール - 文脈に応じて関連記憶を自動取得
   - 過去の約束事の確認
   - 継続的な課題のフォローアップ
   - 感情パターンの把握

2. getRelevantProfileツール - 適切なプロフィール情報を取得
   - 文脈に応じた必要項目の選択

3. saveMemoryツール - ユーザーのメッセージから自動的に重要情報を記憶
   - 学習進捗（点数、理解した内容）
   - 学習課題（苦手分野、困っていること）
   - 約束事（宿題、次回までの課題）
   - 感情状態（不安、やる気、疲れ）
   - マイルストーン（試験日、重要イベント）

【返信のポイント】:
- 過去の文脈を踏まえた継続的な支援
- 約束や宿題のフォローアップ
- 感情に寄り添った共感的な対応
- 長期的な成長を意識したアドバイス

不要な前置きや箇条書きは避け、自然な会話として返答してください。`,
      tools: [getRelevantProfileTool, saveMemoryTool, retrieveMemoryTool, analyzeProfileStructuredTool],
    });

    const userMessage = `【コンテキスト情報】
あなたの役割: ${role}
対象ユーザー: self=${profileIds.self}, peer=${profileIds.peer}
セッションID: ${threadId}

${historyContext}

【重要指示】
必ず以下の順番でツールを使用してください：
1. retrieveMemoryツールで過去の関連記憶を取得
   - userId: "${profileIds.self}"
   - message: ユーザーの新規メッセージ

2. getRelevantProfileツールでプロフィール情報を取得
   - userId: "${profileIds.self}" (自分のプロフィール)
   - context: メッセージ内容から適切なコンテキストを選択

3. 重要な情報があればsaveMemoryツールで記録
   - userId: "${profileIds.self}"
   - message: ユーザーの新規メッセージ
   - sessionId: "${threadId}"

【タスク】
以下のメッセージに対して、記憶とプロフィール情報を基に、相手に配慮した返信を生成してください。

ユーザーからの新規メッセージ:
${message}

出力は純テキストのみ。`;

    const result = await run(agent, userMessage);
    const text = (result as any)?.finalOutput ?? '';

    // AIの返信を履歴に保存（相手の役割として）
    const replyRole = role === 'student' ? 'coach' : 'student';
    writeHistory(threadId, replyRole, text);

    if (debug) {
      const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      logger.info({ traceId, threadId, role, profileIds, usedHistory: history }, 'agent-oa.debug');
      return res.json({ replies: [{ text, score: 1 }], traceId });
    }
    return res.type('text/plain').send(text);
  } catch (e: any) {
    logger.error({ err: e }, 'agent-oa.error');
    return res.status(500).json({ error: 'agent-oa failed', detail: e?.message });
  }
});

// ストリーミング対応エンドポイント（OpenAI SDK版）
app.post('/agent/ask-stream', async (req, res) => {
  const { threadId, role, message, profileIds, debug } = req.body as any;
  if (!threadId || !role || !message || !profileIds?.self || !profileIds?.peer) {
    return res.status(400).json({ error: 'threadId, role, message, profileIds.self, profileIds.peer は必須' });
  }

  try {
    // Server-Sent Events (SSE) のヘッダー設定
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    });

    // ユーザーのメッセージを履歴に保存
    writeHistory(threadId, role, message);

    // 履歴情報の取得
    const history = readRecentHistory(threadId, 8);
    const historyContext = history.length 
      ? `【会話履歴 抜粋（新しい順 最大8件）】\\n${history.map((h: any) => `- [${h.ts ?? ''} ${h.role ?? ''}] ${h.text}`).join('\\n')}`
      : '';

    // OpenAI Agents SDKでツール実行と情報収集（ストリーミングなし）
    const toolInstructions = `【ツール実行フェーズ】
あなたの役割: ${role}
対象ユーザー: self=${profileIds.self}, peer=${profileIds.peer}
セッションID: ${threadId}

${historyContext}

【重要指示】
必ず以下の順番でツールを使用してください：
1. retrieveMemoryツールで過去の関連記憶を取得
   - userId: "${profileIds.self}"
   - message: ユーザーの新規メッセージ

2. getRelevantProfileツールでプロフィール情報を取得
   - userId: "${profileIds.self}" (自分のプロフィール)
   - context: メッセージ内容から適切なコンテキストを選択

3. 重要な情報があればsaveMemoryツールで記録
   - userId: "${profileIds.self}"
   - message: ユーザーの新規メッセージ
   - sessionId: "${threadId}"

ユーザーからの新規メッセージ:
${message}

ツール実行結果を簡潔にまとめて返してください（最終返信は別途生成されます）。`;

    // OpenAI Agents SDKでツール実行
    const agent = new Agent({
      name: 'tool-executor-oa',
      instructions: `あなたは学習コーチングプラットフォームのツール実行支援AIです。指示されたツールを順次実行し、結果を簡潔にまとめて返してください。`,
      tools: [getRelevantProfileTool, saveMemoryTool, retrieveMemoryTool],
    });

    const toolResult = await run(agent, toolInstructions);
    const toolResults = (toolResult as any)?.finalOutput ?? '';

    // 最終返信生成用のプロンプト
    const streamPrompt = `あなたは学習コーチングプラットフォームの返信支援AIです。
以下の情報を基に、ユーザーに対して適切な返信を生成してください。

【役割】
あなたの役割: ${role}
対象ユーザー: self=${profileIds.self}, peer=${profileIds.peer}

【会話履歴】
${historyContext}

【ツール実行結果】
${toolResults}

【ユーザーの新規メッセージ】
${message}

【重要指示】
- 役割に応じた口調と性格を反映してください
- 過去の記憶と文脈を考慮してください
- 温かく親身になって対応してください
- 出力は純テキストのみです

返信:`;

    // AI SDKでストリーミング実行
    const stream = await streamText({
      model: openai(process.env.OPENAI_MODEL || 'gpt-4o-mini'),
      prompt: streamPrompt,
      temperature: 0.8,
    });

    let fullText = '';
    for await (const textPart of stream.textStream) {
      fullText += textPart;
      res.write(textPart);
    }

    // AIの返信を履歴に保存（相手の役割として）
    const replyRole = role === 'student' ? 'coach' : 'student';
    writeHistory(threadId, replyRole, fullText);

    res.end();

  } catch (e: any) {
    logger.error({ err: e }, 'agent-oa.stream.error');
    res.write(`エラーが発生しました: ${e?.message}`);
    res.end();
  }
});

app.get('/agent/history/:threadId', (req, res) => {
  const { threadId } = req.params;
  const history = readRecentHistory(threadId, 100);
  return res.json({ history });
});

app.get('/agent/profile/:id', (req, res) => {
  const { id } = req.params;
  const profile = readProfile(id);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  return res.json(profile);
});

app.post('/agent/profile/:id', (req, res) => {
  const { id } = req.params;
  const profile = req.body;
  
  // バリデーション
  if (!profile || typeof profile !== 'object') {
    return res.status(400).json({ error: 'Invalid profile data' });
  }
  
  if (!profile.name || !profile.role) {
    return res.status(400).json({ error: 'Name and role are required' });
  }
  
  try {
    // IDが一致していることを確認
    const profileWithId = { ...profile, id };
    writeProfile(id, profileWithId);
    return res.json({ ok: true, profile: profileWithId });
  } catch (e: any) {
    logger.error({ err: e, id, profile }, 'profile-save.error');
    return res.status(500).json({ error: e?.message });
  }
});

// メモリー取得エンドポイント
app.get('/agent/memories/:userId', (req, res) => {
  const { userId } = req.params;
  const { limit = '20', type } = req.query;
  
  try {
    const memories = searchMemories({
      userId,
      type: type as any,
      limit: Number(limit),
      notExpired: true,
    });
    
    const stats = getMemoryStats(userId);
    
    res.json({
      memories,
      stats,
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch memories');
    res.status(500).json({ error: 'Failed to fetch memories' });
  }
});

app.listen(CONFIG.port, () => logger.info(`agent-poc-oa listening on http://localhost:${CONFIG.port}`));

