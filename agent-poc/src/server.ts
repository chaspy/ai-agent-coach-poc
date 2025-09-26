import express from 'express';
import cors from 'cors';
import { CONFIG } from './config';
import { logger } from './logger';
import { replyAgent } from './agent';
import { readProfile, writeProfile, readRecentHistory, writeHistory, ensureDataDirs } from './data';
import { searchMemories, getMemoryStats, deleteMemory } from './memory-storage';
import { analyzeStudyPatterns, generatePraiseVariations, generateStudySuggestions } from './memory-analyzer';
import { thinkingLogStore, ThinkingLogger } from './thinking-log';
import { saveStudyRecord, getStudyRecords, calculateStudyStats } from './study-record-storage';
import type { StudyContentType } from './study-record-types';
// 🚨 CRITICAL: AI SDK v5ブロッカー対応 (2025-09-05)
// ストリーミング機能でUnsupportedModelVersionError発生
// OpenAI gpt-4o-mini model spec v1 vs AI SDK v5要求 spec v2不整合
// 解決: ai@4.0.7ダウングレード（3エンジン統一）
import { streamText, generateObject, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { AskInput, CoachPromptInput, CoachPromptResponse, CoachPrompt, CoachMessageType } from './types';
import { TaskPlanSchema, AnswerEvaluationSchema } from './structured-schemas';

ensureDataDirs();

// 共通の計画生成関数
async function generateTaskPlan(
  role: string, 
  message: string, 
  thinkingLogger?: ThinkingLogger
): Promise<{ plan: any; planText: string }> {
  if (thinkingLogger) {
    thinkingLogger.info('計画生成開始', 'TaskPlanSchemaでタスク分解を実行');
  }
  
  try {
    const { object: plan } = await (generateObject as any)({
      model: openai(CONFIG.openaiModel) as any,
      schema: TaskPlanSchema,
      prompt: `次の要求に対し、会話エージェントが安全に実行するためのタスク分解を作成してください。\n\n【役割】${role}\n【要求】${message}\n【制約】返信は丁寧・簡潔、メモリ/プロフィールの活用、事実に忠実\n【時間予算】約5分`,
      temperature: 0.2,
    });
    
    const planText = JSON.stringify(plan, null, 2);
    
    if (thinkingLogger) {
      thinkingLogger.success('計画生成完了', `計画文字数: ${planText.length}`);
    }
    
    return { plan, planText };
  } catch (err: any) {
    if (thinkingLogger) {
      thinkingLogger.warning('計画生成失敗', err?.message || 'plan failed');
    }
    return { plan: null, planText: '' };
  }
}

// 回答評価と改善を行う共通関数
async function evaluateAndImproveAnswer(
  answer: string,
  message: string,
  role: string,
  thinkingLogger?: ThinkingLogger
): Promise<{ finalAnswer: string; evaluation: any }> {
  if (thinkingLogger) {
    thinkingLogger.info('自己診断開始', 'LLM-as-a-judgeで回答品質を評価中');
  }
  
  try {
    const { object: evaluation } = await (generateObject as any)({
      model: openai(CONFIG.openaiModel) as any,
      schema: AnswerEvaluationSchema,
      prompt: `【入力質問】${message}\n【生成回答】${answer}\n【役割】${role}\n\n上記の回答を評価し、改善提案を作成してください。`,
      temperature: 0.1,
    });
    
    if (thinkingLogger) {
      thinkingLogger.info('自己診断結果', `総合スコア: ${Math.round(evaluation.overall * 100)}/100, 関連性: ${evaluation.scores.relevance}, 有用性: ${evaluation.scores.helpfulness}`);
    }
    
    // スコアが閾値以下なら改善（デモ用に高めに設定して再修正を頻繁に）
    const PASS_THRESHOLD = 0.90;  // 90点以上でないと再修正（デモ用）
    let finalAnswer = answer;
    
    if (evaluation.overall < PASS_THRESHOLD && evaluation.suggestions && evaluation.suggestions.length > 0) {
      if (thinkingLogger) {
        thinkingLogger.info('再修正開始', `改善提案: ${evaluation.suggestions.join(', ')}`);
      }
      
      // 改善版を生成
      const { text: improvedAnswer } = await (generateText as any)({
        model: openai(CONFIG.openaiModel) as any,
        prompt: `【元の回答】${answer}\n【改善指示】${evaluation.suggestions.join('\n')}\n\n改善された回答を生成してください。`,
        temperature: 0.3,
      });
      
      finalAnswer = improvedAnswer;
      
      if (thinkingLogger) {
        thinkingLogger.success('再修正完了', '改善版の回答を生成しました');
      }
    }
    
    return { finalAnswer, evaluation };
  } catch (err: any) {
    if (thinkingLogger) {
      thinkingLogger.warning('評価失敗', err?.message || 'evaluation failed');
    }
    return { finalAnswer: answer, evaluation: null };
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/agent/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/agent/ask', async (req, res) => {
  const { threadId, role, message, profileIds, topK, debug } = req.body as AskInput;
  if (!threadId || !role || !message || !profileIds?.self || !profileIds?.peer) {
    return res.status(400).json({ error: 'threadId, role, message, profileIds.self, profileIds.peer は必須です' });
  }

  // ユーザーのメッセージを履歴に保存
  writeHistory(threadId, role, message);

  // 履歴情報の取得（これは従来通り）
  const history = readRecentHistory(threadId, 8);
  const historyContext = history.length 
    ? `【会話履歴 抜粋（新しい順 最大8件）】\n${history.map((h) => `- [${h.ts ?? ''} ${h.role ?? ''}] ${h.text}`).join('\n')}`
    : '';

  // プロフィール情報はProfileToolに委譲
  // AgentがgetRelevantProfileツールを自動呼び出しします

  try {
    // 思考ログセッション開始
    const messageId = `${threadId}_${Date.now()}`;
    const thinkingLog = thinkingLogStore.startThinking(threadId, threadId, messageId, profileIds.self);
    const thinkingLogger = new ThinkingLogger(messageId);
    
    thinkingLogger.info('メッセージ受信', `ユーザーメッセージを受信: "${message.substring(0, 50)}..."`);
    thinkingLogger.debug('コンテキスト準備', `役割: ${role}, セッション: ${threadId}`);

    // 0) Planner: タスク分解（共通関数を使用）
    const { planText } = await generateTaskPlan(role, message, thinkingLogger);

    // Agent向けのメッセージ構成（ツール呼び出し情報を含む）
    const userMessage = `【コンテキスト情報】
あなたの役割: ${role}
対象ユーザー: self=${profileIds.self}, peer=${profileIds.peer}
セッションID: ${threadId}

${historyContext}

【計画概要】
${planText ? planText : '（計画生成に失敗: ツールによる逐次推論で代替）'}

【🚨CRITICAL: 必須ツール実行指示🚨】
以下4つのツールをこの順番で必ず実行してください（スキップ禁止）：

0. ⚠️ 必須: planTaskツールで実行計画を簡潔に作成し要約

1. ⚠️ 必須: retrieveMemoryツールで過去の関連記憶を取得
   - userId: "${profileIds.self}"
   - message: ユーザーの新規メッセージ

2. ⚠️ 必須: getRelevantProfileツール（生徒プロフィール）
   - userId: "${profileIds.self}" (生徒のプロフィール)
   - context: メッセージ内容から適切なコンテキストを選択
   
3. ⚠️ 必須: getRelevantProfileツール（コーチプロフィール）
   - userId: "${profileIds.peer}" (コーチのプロフィール)  
   - context: メッセージ内容から適切なコンテキストを選択

4. ⚠️ 必須: saveMemoryツールで記録（すべてのメッセージに対して実行）
   - userId: "${profileIds.self}"
   - message: ユーザーの新規メッセージ
   - sessionId: "${threadId}"
   - 注意: 「重要でない」と思われるメッセージでも必ず実行してください

【タスク】
以下のメッセージに対して、記憶とプロフィール情報を基に、相手に配慮した返信を生成してください。

ユーザーからの新規メッセージ:
${message}

出力は純テキストのみ。`;

    thinkingLogger.info('Agent実行開始', 'ツールを順次実行し、返信を生成します');

    const result = await replyAgent.generate([
      { role: 'user', content: userMessage },
    ]);

    let text = result?.text ?? '';
    
    thinkingLogger.success('返信生成完了', `生成された返信: "${text.substring(0, 50)}..." (${text.length}文字)`);

    // 5) 自己診断 → 必要なら自動再修正
    const PASS = 0.75;
    const MAX_RETRIES = 1; // PoCでは1回だけ再修正
    let retries = 0;

    thinkingLogger.info('自己診断開始', 'AnswerEvaluationSchemaで採点');
    const evaluate = async (draft: string) => {
      const { object: ev } = await (generateObject as any)({
        model: openai(CONFIG.openaiModel) as any,
        schema: AnswerEvaluationSchema,
        prompt: `次のユーザーメッセージに対する回答を、関連性・有用性・文体適合・忠実性で採点し、必要なら改善案を出してください。\n\n【役割】${role}\n【ユーザーの要求】\n${message}\n\n【回答案】\n${draft}\n\n評価は0-1で厳格に。基準に満たない場合はpass=falseにし、改善提案を詳しく。`,
        temperature: 0.2,
      });
      return ev;
    };

    let ev = await evaluate(text);
    thinkingLogger.info('自己診断結果', `overall=${ev.overall.toFixed(2)}, pass=${ev.pass}`);

    while (!ev.pass && retries < MAX_RETRIES) {
      retries++;
      thinkingLogger.warning('再修正開始', `改善提案を反映して再生成（試行${retries}）`);
      const { text: refined } = await (generateText as any)({
        model: openai(CONFIG.openaiModel) as any,
        prompt: `あなたは上記の評価者が指摘した問題点を修正するアシスタントです。\n【ユーザーの要求】\n${message}\n\n【現在の回答】\n${text}\n\n【問題点】\n${ev.issues.join('\n')}\n\n【改善指示】\n${ev.suggestions.join('\n')}\n\n制約: 役割(${role})の口調/文体に合わせ、事実に忠実、簡潔で親身。\n出力は改善後の最終回答テキストのみ。余計な枕詞や見出しは禁止。`,
        temperature: 0.5,
      });
      text = refined;
      thinkingLogger.success('再修正完了', `新しい回答: "${text.substring(0, 50)}..."`);
      ev = await evaluate(text);
      thinkingLogger.info('再診断結果', `overall=${ev.overall.toFixed(2)}, pass=${ev.pass}`);
      if (!ev.pass) break;
    }
    thinkingLogger.complete('completed');

    // AIの返信を履歴に保存（相手の役割として）
    const replyRole = role === 'student' ? 'coach' : 'student';
    writeHistory(threadId, replyRole, text);

    if (debug) {
      const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      logger.info({ traceId, threadId, role, profileIds, usedHistory: history, evaluation: ev, plan: planText }, 'agent.debug');
      return res.json({ replies: [{ text, score: ev.overall ?? 1 }], eval: ev, plan: planText, traceId });
    }

    return res.type('text/plain').send(text);
  } catch (e: any) {
    // エラーの場合は思考ログにもエラーを記録
    const messageId = `${threadId}_${Date.now()}`;
    const existingLog = thinkingLogStore.getCurrentThinkingLogs().find(log => log.messageId.startsWith(threadId));
    if (existingLog) {
      const thinkingLogger = new ThinkingLogger(existingLog.messageId);
      thinkingLogger.error('Agent実行エラー', e?.message || 'Unknown error');
      thinkingLogger.complete('error');
    }
    
    logger.error({ err: e }, 'agent.error');
    return res.status(500).json({ error: 'agent failed', detail: e?.message });
  }
});

// ストリーミング対応エンドポイント
app.post('/agent/ask-stream', async (req, res) => {
  const { threadId, role, message, profileIds, topK, debug } = req.body as AskInput;
  if (!threadId || !role || !message || !profileIds?.self || !profileIds?.peer) {
    return res.status(400).json({ error: 'threadId, role, message, profileIds.self, profileIds.peer は必須です' });
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

    // 🚨 学習報告の自動検出と保存
    if (role === 'student') {
      const lowerMsg = message.toLowerCase();
      const partMatch = lowerMsg.match(/part\s*(\d)/);
      const timeMatch = lowerMsg.match(/(\d+)\s*分/);
      
      // 学習報告のキーワード検出
      const isStudyReport = (
        partMatch || 
        lowerMsg.includes('練習') || 
        lowerMsg.includes('勉強') ||
        lowerMsg.includes('やった') ||
        lowerMsg.includes('やりました') ||
        lowerMsg.includes('ディクテーション') ||
        lowerMsg.includes('シャドーイング') ||
        lowerMsg.includes('模試')
      );
      
      if (isStudyReport && timeMatch) {
        const partNumber = partMatch ? parseInt(partMatch[1]) : undefined;
        const durationMinutes = parseInt(timeMatch[1]);
        
        // contentTypeの推定
        let contentType: 'basics' | 'dictation' | 'shadowing' | 'practice' | 'vocabulary' | 'mock_test' = 'practice';
        if (lowerMsg.includes('ディクテーション')) contentType = 'dictation';
        else if (lowerMsg.includes('シャドーイング')) contentType = 'shadowing';
        else if (lowerMsg.includes('模試') || lowerMsg.includes('本番')) contentType = 'mock_test';
        else if (lowerMsg.includes('単語') || lowerMsg.includes('語彙')) contentType = 'vocabulary';
        else if (lowerMsg.includes('基礎') || lowerMsg.includes('講義')) contentType = 'basics';
        
        try {
          const today = new Date().toISOString().split('T')[0];
          const studyRecord = saveStudyRecord({
            userId: profileIds.self,
            date: today,
            contentType,
            partNumber: partNumber && partNumber >= 1 && partNumber <= 7 ? partNumber as (1|2|3|4|5|6|7) : undefined,
            durationMinutes,
            completed: true,
          });
          
          logger.info({ 
            recordId: studyRecord.id, 
            contentType, 
            partNumber, 
            durationMinutes 
          }, '🎯 学習記録を自動保存');
        } catch (error) {
          logger.error({ error }, '学習記録の自動保存に失敗');
        }
      }
    }

    // 履歴情報の取得
    const history = readRecentHistory(threadId, 8);
    const historyContext = history.length 
      ? `【会話履歴 抜粋（新しい順 最大8件）】\\n${history.map((h) => `- [${h.ts ?? ''} ${h.role ?? ''}] ${h.text}`).join('\\n')}`
      : '';

    // 思考ログセッション開始
    const messageId = `${threadId}_${Date.now()}`;
    const thinkingLog = thinkingLogStore.startThinking(threadId, threadId, messageId, profileIds.self);
    const thinkingLogger = new ThinkingLogger(messageId);
    
    thinkingLogger.info('ストリーミング処理開始', 'ストリーミング返信の生成を開始します');

    // AI処理フローの固定計画を送信（実際の処理ステップを表示）
    const aiProcessPlan = {
      goal: 'AI エージェント処理',
      steps: [
        { id: 'plan', title: '計画生成', action: 'タスク分解と実行計画の作成' },
        { id: 'tools', title: '情報収集', action: 'メモリ検索・プロフィール取得' },
        { id: 'generate', title: '返信生成', action: 'ストリーミング返信の生成' },
        { id: 'evaluate', title: '品質チェック', action: '自己診断と改善' }
      ],
      timeBudgetMin: 1
    };
    
    // AI処理計画をSSEで送信
    res.write('data: [PLAN_START]\n\n');
    res.write(`data: ${JSON.stringify({
      type: 'plan',
      data: aiProcessPlan,
      timestamp: new Date().toISOString()
    })}\n\n`);
    res.write('data: [PLAN_END]\n\n');
    
    // ステップ1: 計画生成完了を通知
    res.write('data: [STEP_COMPLETE:plan]\n\n');
    const { plan, planText } = await generateTaskPlan(role, message, thinkingLogger);

    // ステップ2: 情報収集（ツール実行）開始を通知
    res.write('data: [STEP_START:tools]\n\n');
    
    // Mastraエージェントでツール実行と情報収集（ストリーミングなし）
    const toolInstructions = `【ツール実行フェーズ】
あなたの役割: ${role}
対象ユーザー: self=${profileIds.self}, peer=${profileIds.peer}
セッションID: ${threadId}

${historyContext}

【計画概要】
${planText || '（計画生成に失敗: ツールによる逐次推論で代替）'}

【🚨CRITICAL: 必須ツール実行指示🚨】
以下のツールをこの順番で必ず実行してください（スキップ禁止）：

1. ⚠️ 必須: retrieveMemoryツールで過去の関連記憶を取得
   - userId: "${profileIds.self}"
   - message: ユーザーの新規メッセージ

2. ⚠️ 必須: getRelevantProfileツール（生徒プロフィール）
   - userId: "${profileIds.self}" (生徒のプロフィール)
   - context: メッセージ内容から適切なコンテキストを選択
   
3. ⚠️ 必須: getRelevantProfileツール（コーチプロフィール）
   - userId: "${profileIds.peer}" (コーチのプロフィール)  
   - context: メッセージ内容から適切なコンテキストを選択

4. ⚠️ 必須: saveMemoryツールで記録（すべてのメッセージに対して実行）
   - userId: "${profileIds.self}"
   - message: ユーザーの新規メッセージ
   - sessionId: "${threadId}"

ユーザーからの新規メッセージ:
${message}

ツール実行結果を簡潔にまとめて返してください（最終返信は別途生成されます）。`;

    thinkingLogger.info('ツール実行開始', 'Mastraエージェントでツールを実行中...');

    // Mastraエージェントでツール実行
    const toolResult = await replyAgent.generate([
      { role: 'user', content: toolInstructions },
    ]);

    thinkingLogger.success('ツール実行完了', 'ツール実行が完了、ストリーミング返信を開始します');
    
    // ステップ2完了、ステップ3開始
    res.write('data: [STEP_COMPLETE:tools]\n\n');
    res.write('data: [STEP_START:generate]\n\n');

    // 最終返信生成用のプロンプト
    const streamPrompt = `あなたは学習コーチングプラットフォームの返信支援AIです。
以下の情報を基に、ユーザーに対して適切な返信を生成してください。

【役割】
あなたの役割: ${role}
対象ユーザー: self=${profileIds.self}, peer=${profileIds.peer}

【会話履歴】
${historyContext}

【ツール実行結果】
${toolResult?.text || ''}

【ユーザーの新規メッセージ】
${message}

【重要指示】
- 役割に応じた口調と性格を反映してください
- 過去の記憶と文脈を考慮してください
- 温かく親身になって対応してください
- 出力は純テキストのみです

返信:`;

    // AI SDKでストリーミング実行
    thinkingLogger.info('ストリーミング開始', 'AI SDKでストリーミング返信を生成中...');
    
    /* 🚨 AI SDK v5互換性問題対応済み (2025-09-05 16:30 JST)
     * 
     * 【実際に発生していたエラー】
     * Error: listen EADDRINUSE: address already in use :::4120 (ポート競合)
     * ↓ 解決後
     * UnsupportedModelVersionError: AI SDK 5 only supports models that 
     * implement specification version "v2" (OpenAI model spec互換性問題)
     * 
     * 【技術的詳細】
     * - streamText() → model spec v1/v2チェック
     * - OpenAI API現在: gpt-4o-mini v1仕様
     * - AI SDK v5要求: v2仕様必須
     * - 後方互換性: 完全削除
     * 
     * 【修正アプローチ】
     * 1. ai@4.0.7ダウングレード (package.json)
     * 2. 3エンジン統一バージョン管理
     * 3. 将来のv2対応待ち
     * 
     * 【動作確認】
     * ✅ Mastra (port:4120): ストリーミング正常動作
     * ✅ LangGraph.js (port:4121): 統合テスト完了  
     * ✅ OpenAI SDK (port:4122): 互換性確認済み
     */
    const stream = await (streamText as any)({
      model: openai(CONFIG.openaiModel || 'gpt-4o-mini') as any,  // ✅ v4.0.7で安定動作
      prompt: streamPrompt,
      temperature: 0.8,
    });

    let fullText = '';
    for await (const textPart of stream.textStream) {
      fullText += textPart;
      res.write(textPart);
    }

    thinkingLogger.success('ストリーミング完了', `返信生成完了: "${fullText.substring(0, 50)}..." (${fullText.length}文字)`);
    
    // ステップ3完了、ステップ4開始
    res.write('data: [STEP_COMPLETE:generate]\n\n');
    res.write('data: [STEP_START:evaluate]\n\n');
    
    // ストリーミング完了後に自己診断を実行（B案: ハイブリッド方式）
    const { evaluation } = await evaluateAndImproveAnswer(fullText, message, role, thinkingLogger);
    
    // 評価結果をSSEで送信（特別なマーカーを使用）
    if (evaluation) {
      res.write('\n\n'); // 区切り
      res.write('data: [EVALUATION_START]\n\n');
      res.write(`data: ${JSON.stringify({
        type: 'evaluation',
        data: {
          overall: evaluation.overall,
          scores: evaluation.scores,
          pass: evaluation.pass,
          issues: evaluation.issues,
          suggestions: evaluation.suggestions,
          plan: planText ? JSON.parse(planText) : null
        },
        timestamp: new Date().toISOString()
      })}\n\n`);
      res.write('data: [EVALUATION_END]\n\n');
    }
    
    thinkingLogger.complete('completed');

    // ステップ4完了
    res.write('data: [STEP_COMPLETE:evaluate]\n\n');

    // AIの返信を履歴に保存（相手の役割として）
    const replyRole = role === 'student' ? 'coach' : 'student';
    writeHistory(threadId, replyRole, fullText);

    res.end();

  } catch (e: any) {
    // エラーの場合は思考ログにもエラーを記録
    const messageId = `${threadId}_${Date.now()}`;
    const existingLog = thinkingLogStore.getCurrentThinkingLogs().find(log => log.messageId.startsWith(threadId));
    if (existingLog) {
      const thinkingLogger = new ThinkingLogger(existingLog.messageId);
      thinkingLogger.error('ストリーミング実行エラー', e?.message || 'Unknown error');
      thinkingLogger.complete('error');
    }
    
    logger.error({ err: e }, 'agent.stream.error');
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

app.post('/agent/tools/ingest', (req, res) => {
  // 省略: PoC簡易版ではダミー。将来、プロフィール/履歴を保存して再ロードする。
  return res.json({ ok: true, note: 'Not implemented in PoC minimal.' });
});

// 現在思考中のログ取得エンドポイント（この順序が重要！）
app.get('/agent/thinking/current', (req, res) => {
  try {
    const currentThinkingLogs = thinkingLogStore.getCurrentThinkingLogs();
    logger.info({ logsCount: currentThinkingLogs.length }, 'Current thinking logs requested');
    res.json({
      currentThinkingLogs,
      debug: {
        count: currentThinkingLogs.length,
        currentMessageId: thinkingLogStore.getCurrentMessageId(),
        steps: currentThinkingLogs.map(log => log.steps.length)
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch current thinking logs');
    res.status(500).json({ error: 'Failed to fetch current thinking logs' });
  }
});

// スレッドの全思考ログ取得エンドポイント
app.get('/agent/thinking/thread/:threadId', (req, res) => {
  const { threadId } = req.params;
  
  try {
    const thinkingLogs = thinkingLogStore.getThreadThinkingLogs(threadId);
    res.json({ thinkingLogs });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch thread thinking logs');
    res.status(500).json({ error: 'Failed to fetch thread thinking logs' });
  }
});

// 思考ログ取得エンドポイント（より具体的なルートの後に配置）
app.get('/agent/thinking/:messageId', (req, res) => {
  const { messageId } = req.params;
  
  try {
    const thinkingLog = thinkingLogStore.getThinkingLog(messageId);
    
    if (!thinkingLog) {
      return res.status(404).json({ error: 'Thinking log not found' });
    }
    
    res.json(thinkingLog);
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch thinking log');
    res.status(500).json({ error: 'Failed to fetch thinking log' });
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

// メモリー削除エンドポイント
app.delete('/agent/memories/:userId/:memoryId', (req, res) => {
  const { userId, memoryId } = req.params;

  try {
    const success = deleteMemory(userId, memoryId);

    if (!success) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    logger.info({ userId, memoryId }, 'Memory deleted successfully');
    res.json({ success: true, message: 'Memory deleted successfully' });
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete memory');
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

// 学習記録保存エンドポイント
app.post('/agent/study-records', (req, res) => {
  const { userId, date, contentType, partNumber, durationMinutes, questionCount, correctCount, score, notes } = req.body;
  
  if (!userId || !date || !contentType || !durationMinutes) {
    return res.status(400).json({ error: 'userId, date, contentType, durationMinutes are required' });
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
    
    logger.info({ userId, recordId: record.id, contentType, durationMinutes }, 'Study record saved');
    return res.json(record);
  } catch (e: any) {
    logger.error({ err: e, userId }, 'Failed to save study record');
    return res.status(500).json({ error: e?.message || 'Failed to save study record' });
  }
});

// 学習記録取得エンドポイント
app.get('/agent/study-records/:userId', (req, res) => {
  const { userId } = req.params;
  const { fromDate, toDate, contentType, partNumber, limit } = req.query;
  
  try {
    const records = getStudyRecords(userId, {
      fromDate: fromDate as string,
      toDate: toDate as string,
      contentType: contentType as StudyContentType,
      partNumber: partNumber ? parseInt(partNumber as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    
    logger.info({ userId, count: records.length }, 'Study records retrieved');
    return res.json({ records });
  } catch (e: any) {
    logger.error({ err: e, userId }, 'Failed to fetch study records');
    return res.status(500).json({ error: e?.message || 'Failed to fetch study records' });
  }
});

// 学習統計取得エンドポイント
app.get('/agent/study-stats/:userId', (req, res) => {
  const { userId } = req.params;
  
  try {
    const stats = calculateStudyStats(userId);
    
    logger.info({ 
      userId, 
      totalMinutes: stats.totalStudyTimeMinutes,
      consecutiveDays: stats.consecutiveDays 
    }, 'Study stats calculated');
    
    return res.json(stats);
  } catch (e: any) {
    logger.error({ err: e, userId }, 'Failed to calculate study stats');
    return res.status(500).json({ error: e?.message || 'Failed to calculate study stats' });
  }
});

// コーチ声掛けメッセージ生成エンドポイント
app.post('/agent/coach-prompt', async (req, res) => {
  const { threadId, studentId, coachId, messageType } = req.body as CoachPromptInput;

  if (!threadId || !studentId || !coachId) {
    return res.status(400).json({ error: 'threadId, studentId, coachId は必須です' });
  }

  try {
    logger.info({ threadId, studentId, coachId }, 'コーチ声掛けメッセージ生成開始');

    // 思考ログセッション開始
    const messageId = `coach_prompt_${Date.now()}`;
    const sessionId = `session_${Date.now()}`;
    const thinkingLog = thinkingLogStore.startThinking(sessionId, threadId, messageId, coachId);
    const thinkingLogger = new ThinkingLogger(messageId);

    thinkingLogger.info('コーチ声掛け生成開始', '生徒の学習状況を分析して適切な声掛けを生成します');

    // 生徒のメモリーを取得
    thinkingLogger.debug('メモリー取得', `生徒ID: ${studentId} の学習記録を取得中`);
    const memories = searchMemories({
      userId: studentId,
      limit: 50,
      notExpired: true,
    });
    thinkingLogger.info('メモリー取得完了', `${memories.length}件の学習記録を取得`);

    // 学習統計を取得（新システム）
    thinkingLogger.debug('学習統計取得', `生徒ID: ${studentId} の学習統計を計算中`);
    const studyStats = calculateStudyStats(studentId);
    thinkingLogger.success('学習統計取得完了', `累計${studyStats.totalStudyTimeMinutes}分、連続${studyStats.consecutiveDays}日`);
    logger.debug({ studyStats }, '学習統計取得完了');

    // 学習パターンを分析
    thinkingLogger.debug('パターン分析開始', '連続学習日数、学習時間、タスク進捗を計算中');
    const pattern = await analyzeStudyPatterns(memories);
    thinkingLogger.success('学習パターン分析完了', `連続${pattern.consecutiveDays}日、総学習${Math.round(pattern.totalStudyHours)}時間`);
    logger.debug({ pattern }, '学習パターン分析完了');

    // 褒めメッセージのバリエーションを生成
    const praiseMessages = generatePraiseVariations(pattern);
    const studySuggestions = generateStudySuggestions(pattern);

    // コーチのプロフィールを取得
    const coachProfile = readProfile(coachId);
    const studentProfile = readProfile(studentId);

    // 会話履歴を取得（最新5件）
    const recentHistory = readRecentHistory(threadId, 5);
    const historyContext = recentHistory.length > 0
      ? recentHistory.map(h => `[${h.role}] ${h.text}`).join('\n')
      : '';

    // 3つの異なるアプローチでメッセージを生成
    thinkingLogger.info('メッセージ生成開始', '3つの異なるアプローチで声掛けメッセージを生成します');
    const suggestions: CoachPrompt[] = [];

    // 1. 学習提案メッセージ
    thinkingLogger.debug('学習提案生成', 'TOEIC対策に特化した今日の学習内容を提案');
    const taskSuggestionPrompt = `
【役割】あなたは${coachProfile?.name || 'コーチ'}です。
【生徒情報】${studentProfile?.name || '生徒'}さん
目標: ${studentProfile?.goals?.join(', ') || 'なし'}
弱点: ${studentProfile?.weaknesses?.join(', ') || 'なし'}

【最近の会話】
${historyContext}

【学習状況】
- 連続学習日数: ${studyStats.consecutiveDays}日
- 累計学習時間: ${Math.floor(studyStats.totalStudyTimeMinutes / 60)}時間${studyStats.totalStudyTimeMinutes % 60}分
- 今週の学習時間: ${studyStats.thisWeek.totalMinutes}分（${studyStats.thisWeek.sessions}セッション）
- Part別学習状況: ${studyStats.byPart.filter(p => p.totalMinutes > 0).map(p => `Part${p.partNumber}:${p.totalMinutes}分`).join(', ') || 'なし'}
- 学習内容: ${studyStats.byContentType.filter(c => c.totalMinutes > 0).map(c => `${c.contentType}:${c.totalMinutes}分`).join(', ') || 'なし'}
- 最近の学習科目: ${pattern.recentSubjects.join(', ') || 'なし'}

【指示】コーチから声掛けするメッセージです。まず自然な挨拶から始めて、生徒の調子を聞いてから、今日の学習提案につなげてください。

【制約】
- 150-200文字程度
- 必ず「こんにちは」「今日の調子はどうですか？」などの自然な挨拶から始める
- 生徒の状態を気遣ってから、TOEIC対策の学習提案を行う
- 質問を含める（例：「今日はどの時間帯に学習予定ですか？」）
- 優しく励ます口調
- 絵文字は使わない`;

    const { text: taskMessage } = await generateText({
      model: openai(CONFIG.openaiModel) as any,
      prompt: taskSuggestionPrompt,
      temperature: 0.7,
    });

    suggestions.push({
      id: `suggest_${Date.now()}`,
      type: 'daily_suggestion' as CoachMessageType,
      message: taskMessage,
      confidence: 0.85,
      reasoning: '学習パターンに基づいた今日の学習提案',
      thinkingLogId: messageId,
    } as CoachPrompt & { thinkingLogId?: string });

    // 2. 進捗レビューメッセージ
    thinkingLogger.debug('進捗レビュー生成', '試験日までの学習計画と進捗確認');
    const progressPrompt = `
【役割】あなたは${coachProfile?.name || 'コーチ'}です。
【生徒情報】${studentProfile?.name || '生徒'}さん
目標: TOEIC700点（9/30試験）
現在: 580点（リーディング得意、リスニング苦手）

【最近の会話】
${historyContext}

【進捗状況】
- 連続学習日数: ${studyStats.consecutiveDays}日
- 今週の学習: ${studyStats.thisWeek.totalMinutes}分（${studyStats.thisWeek.sessions}セッション）
- タスク完了率: ${pattern.totalTasks > 0 ? Math.round((pattern.completedTasks / pattern.totalTasks) * 100) : 0}%
- 克服した課題: ${pattern.challengesOvercome.join(', ') || 'なし'}
- Part別進捗: ${studyStats.byPart.filter(p => p.totalMinutes > 0).map(p => `Part${p.partNumber}:${p.totalMinutes}分${p.averageAccuracy ? `(正答率${Math.round(p.averageAccuracy * 100)}%)` : ''}`).join(', ') || 'なし'}

【指示】コーチから声掛けするメッセージです。まず挨拶と生徒の近況を聞いてから、TOEIC試験に向けた進捗確認につなげてください。

【制約】
- 150-200文字程度
- 「お疲れ様です」「最近どうですか？」など自然な挨拶から始める
- 生徒の最近の状況を聞いてから、進捗確認に移る
- 「リスニングの進捗はどうですか？」など具体的な質問を含める
- 絵文字は使わない`;

    const { text: progressMessage } = await generateText({
      model: openai(CONFIG.openaiModel) as any,
      prompt: progressPrompt,
      temperature: 0.7,
    });

    suggestions.push({
      id: `progress_${Date.now()}`,
      type: 'progress_review' as CoachMessageType,
      message: progressMessage,
      confidence: 0.80,
      reasoning: '進捗状況の確認と次のステップの提案',
      thinkingLogId: messageId,
    } as CoachPrompt & { thinkingLogId?: string });

    // 3. モチベーションメッセージ
    thinkingLogger.debug('モチベーション生成', '580点→700点達成への自信を高めるメッセージ');
    const motivationPrompt = `
【役割】あなたは${coachProfile?.name || 'コーチ'}です。
【生徒情報】${studentProfile?.name || '生徒'}さん
目標: TOEIC580点→700点（120点UP）

【最近の会話】
${historyContext}

【褒めポイント】
- 連続${studyStats.consecutiveDays}日も学習を継続している
- 累計${Math.floor(studyStats.totalStudyTimeMinutes / 60)}時間以上の学習時間を確保
- 今週は${studyStats.thisWeek.totalMinutes}分学習（${studyStats.thisWeek.sessions}セッション）
- 明確な目標設定ができている
${praiseMessages.slice(0, 1).join('\n')}

【指示】コーチから声掛けするメッセージです。まず自然な挨拶から始めて、生徒の様子を聞いてから、応援やモチベーションアップのメッセージにつなげてください。

【制約】
- 150-200文字程度
- 「こんにちは」「今日はどんな感じですか？」など自然な挨拶から始める
- 生徒の様子を聞いてから、励ましのメッセージに移る
- 「最近、手応えを感じることはありましたか？」など感想を聞く質問を含める
- 前向きで温かい口調
- 絵文字は使わない`;

    const { text: motivationMessage } = await generateText({
      model: openai(CONFIG.openaiModel) as any,
      prompt: motivationPrompt,
      temperature: 0.8,
    });

    suggestions.push({
      id: `motivate_${Date.now()}`,
      type: 'motivation_boost' as CoachMessageType,
      message: motivationMessage,
      confidence: 0.90,
      reasoning: '学習成果を褒めてモチベーション向上',
      thinkingLogId: messageId,
    } as CoachPrompt & { thinkingLogId?: string });

    thinkingLogger.success('メッセージ生成完了', '3つの声掛けメッセージを生成しました');
    // 思考ログを完了状態にしない（フロントエンドで表示できるように維持）
    // フロントエンドからの取得後、一定時間後に自動クリア
    setTimeout(() => {
      thinkingLogStore.completeThinking(messageId);
    }, 10000); // 10秒後に完了状態にする

    const response: CoachPromptResponse = {
      suggestions,
      thinkingLogId: messageId,
    } as CoachPromptResponse & { thinkingLogId?: string };

    logger.info({ suggestionsCount: suggestions.length }, 'コーチ声掛けメッセージ生成完了');
    res.json(response);

  } catch (error) {
    logger.error({ err: error }, 'コーチ声掛けメッセージ生成失敗');
    res.status(500).json({ error: 'メッセージ生成に失敗しました' });
  }
});

app.listen(CONFIG.port, () => {
  logger.info(`agent-poc listening on http://localhost:${CONFIG.port}`);
});
