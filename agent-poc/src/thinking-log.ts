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
    
    // 現在のメッセージIDをクリア
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
  
  // 現在思考中のログ取得
  getCurrentThinkingLogs(): ThinkingLog[] {
    return Array.from(this.logs.values())
      .filter(log => log.status === 'thinking');
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