// 思考ログシステム - Mastraエージェントの思考プロセスを可視化

export interface ThinkingStep {
  id: string;
  timestamp: string;
  step: string;
  content: string;
  level: 'info' | 'debug' | 'warning' | 'success' | 'error';
  metadata?: Record<string, any>;
}

export interface ThinkingLog {
  sessionId: string;
  threadId: string;
  messageId: string;
  userId: string;
  startTime: string;
  endTime?: string;
  status: 'thinking' | 'completed' | 'error';
  steps: ThinkingStep[];
}

// 思考ログストレージ
class ThinkingLogStore {
  private logs: Map<string, ThinkingLog> = new Map();
  private currentMessageId: string | null = null; // 現在実行中のメッセージIDを追跡
  
  // 新しい思考セッション開始
  startThinking(sessionId: string, threadId: string, messageId: string, userId: string): ThinkingLog {
    // 古いログをクリーンアップ（30秒以上前のログを削除）
    const now = Date.now();
    this.logs.forEach((log, id) => {
      const logTime = new Date(log.startTime).getTime();
      if (now - logTime > 30000) { // 30秒以上前
        this.logs.delete(id);
        if (this.currentMessageId === id) {
          this.currentMessageId = null;
        }
      }
    });

    const log: ThinkingLog = {
      sessionId,
      threadId,
      messageId,
      userId,
      startTime: new Date().toISOString(),
      status: 'thinking',
      steps: []
    };

    this.logs.set(messageId, log);
    this.currentMessageId = messageId; // 現在のメッセージIDを設定
    console.log(`[ThinkingLog] 🤔 思考開始: ${messageId}`);
    return log;
  }
  
  // 思考ステップ追加
  addStep(messageId: string, step: string, content: string, level: ThinkingStep['level'] = 'info', metadata?: Record<string, any>) {
    const log = this.logs.get(messageId);
    if (!log) {
      console.warn(`[ThinkingLog] ⚠️ ログが見つかりません: ${messageId}`);
      return;
    }
    
    const thinkingStep: ThinkingStep = {
      id: `${messageId}_${log.steps.length + 1}`,
      timestamp: new Date().toISOString(),
      step,
      content,
      level,
      metadata
    };
    
    log.steps.push(thinkingStep);
    console.log(`[ThinkingLog] 📝 ステップ追加: ${step} - ${content}`);
  }
  
  // 思考完了
  completeThinking(messageId: string, status: 'completed' | 'error' = 'completed') {
    const log = this.logs.get(messageId);
    if (!log) return;

    log.endTime = new Date().toISOString();
    log.status = status;

    // 現在のメッセージIDをクリア（完了後5秒間は表示されるようにした）
    if (this.currentMessageId === messageId) {
      this.currentMessageId = null;
    }

    console.log(`[ThinkingLog] ✅ 思考完了: ${messageId} (${status})`);
  }
  
  // 現在実行中のメッセージIDを取得
  getCurrentMessageId(): string | null {
    return this.currentMessageId;
  }
  
  // 現在実行中のログにステップを追加（便利メソッド）
  addCurrentStep(step: string, content: string, level: ThinkingStep['level'] = 'info', metadata?: Record<string, any>) {
    if (this.currentMessageId) {
      this.addStep(this.currentMessageId, step, content, level, metadata);
    }
  }
  
  // 思考ログ取得
  getThinkingLog(messageId: string): ThinkingLog | null {
    return this.logs.get(messageId) || null;
  }
  
  // スレッドの全思考ログ取得
  getThreadThinkingLogs(threadId: string): ThinkingLog[] {
    return Array.from(this.logs.values())
      .filter(log => log.threadId === threadId)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }
  
  // 現在思考中のログ取得（コーチ声掛け生成も含む）
  getCurrentThinkingLogs(): ThinkingLog[] {
    console.log(`[ThinkingLog] getCurrentThinkingLogs called - currentMessageId: ${this.currentMessageId}, logs size: ${this.logs.size}`);

    // デバッグ: 全ログをリスト
    this.logs.forEach((log, id) => {
      console.log(`[ThinkingLog] - ${id}: status=${log.status}, steps=${log.steps.length}`);
    });

    // 現在のメッセージIDがあればそのログを返す（statusに関係なく）
    if (this.currentMessageId) {
      const currentLog = this.logs.get(this.currentMessageId);
      console.log(`[ThinkingLog] Current log found:`, currentLog ? `yes (${currentLog.steps.length} steps)` : 'no');
      if (currentLog) {
        return [currentLog];
      }
    }

    // 最近15秒以内に開始されたログを返す（thinking状態または最近完了したものも含む）
    const now = Date.now();
    const recentLogs = Array.from(this.logs.values())
      .filter(log => {
        const logTime = new Date(log.startTime).getTime();
        const isRecent = (now - logTime) < 15000; // 15秒以内
        const isCoachPrompt = log.messageId.startsWith('coach_prompt_');

        // thinking状態、coach_prompt、または最近完了したログを返す
        if (log.status === 'thinking') return isRecent;
        if (isCoachPrompt) return isRecent;

        // 完了後5秒以内なら表示継続
        if (log.status === 'completed' && log.endTime) {
          const endTime = new Date(log.endTime).getTime();
          return (now - endTime) < 5000; // 完了後5秒間は表示
        }

        return false;
      });

    console.log(`[ThinkingLog] Recent logs found: ${recentLogs.length}`);
    return recentLogs;
  }
}

// シングルトンインスタンス
export const thinkingLogStore = new ThinkingLogStore();

// 便利なヘルパー関数
export class ThinkingLogger {
  constructor(private messageId: string) {}
  
  step(step: string, content: string, level: ThinkingStep['level'] = 'info', metadata?: Record<string, any>) {
    thinkingLogStore.addStep(this.messageId, step, content, level, metadata);
  }
  
  info(step: string, content: string, metadata?: Record<string, any>) {
    this.step(step, content, 'info', metadata);
  }
  
  debug(step: string, content: string, metadata?: Record<string, any>) {
    this.step(step, content, 'debug', metadata);
  }
  
  success(step: string, content: string, metadata?: Record<string, any>) {
    this.step(step, content, 'success', metadata);
  }
  
  warning(step: string, content: string, metadata?: Record<string, any>) {
    this.step(step, content, 'warning', metadata);
  }
  
  error(step: string, content: string, metadata?: Record<string, any>) {
    this.step(step, content, 'error', metadata);
  }
  
  complete(status: 'completed' | 'error' = 'completed') {
    thinkingLogStore.completeThinking(this.messageId, status);
  }
}