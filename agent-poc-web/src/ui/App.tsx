import React, { useEffect, useState, useRef } from 'react';

// CSSアニメーション定義
const pulseAnimation = `
  @keyframes pulse {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
`;

// スタイルをheadに注入
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = pulseAnimation;
  document.head.appendChild(style);
}

type Role = 'student' | 'coach';

type HistoryEntry = {
  role: string;
  ts: string;
  text: string;
};

type Memory = {
  id: string;
  userId: string;
  sessionId: string;
  type: 'learning_progress' | 'learning_challenge' | 'commitment' | 'emotional_state' | 'milestone';
  content: any;
  timestamp: string;
  relevance: number;
  accessed: number;
  lastAccessed?: string;
  tags: string[];
  expired: boolean;
};

type StudyRecord = {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  contentType: 'basics' | 'dictation' | 'shadowing' | 'practice' | 'vocabulary' | 'mock_test';
  partNumber?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  durationMinutes: number;
  questionCount?: number;
  correctCount?: number;
  score?: number;
  notes?: string;
  completed: boolean;
};

type StudyStats = {
  userId: string;
  totalStudyTimeMinutes: number;
  consecutiveDays: number;
  lastStudyDate?: string;
  byPart: Array<{
    partNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    totalMinutes: number;
    sessions: number;
    averageAccuracy?: number;
  }>;
  byContentType: Array<{
    contentType: string;
    totalMinutes: number;
    sessions: number;
  }>;
  thisWeek: {
    totalMinutes: number;
    sessions: number;
    byDay: Array<{
      date: string;
      minutes: number;
    }>;
  };
};

type ThinkingStep = {
  id: string;
  timestamp: string;
  step: string;
  content: string;
  level: 'info' | 'debug' | 'warning' | 'success' | 'error';
  metadata?: Record<string, any>;
};

type ThinkingLog = {
  sessionId: string;
  threadId: string;
  messageId: string;
  userId: string;
  startTime: string;
  endTime?: string;
  status: 'thinking' | 'completed' | 'error';
  steps: ThinkingStep[];
};

// Step 5: 構造化データ型定義
type StructuredAnalysis = {
  userId: string;
  role: 'student' | 'coach';
  learningCharacteristics: {
    level: 'beginner' | 'intermediate' | 'advanced';
    strengths: string[];
    weaknesses: string[];
    preferredLearningStyle: 'visual' | 'auditory' | 'kinesthetic' | 'mixed';
    motivationFactors: string[];
  };
  communicationStyle: {
    tone: 'formal' | 'casual' | 'friendly' | 'professional';
    preferredInteraction: 'supportive' | 'challenging' | 'balanced';
    responseStyle: 'detailed' | 'concise' | 'encouraging' | 'analytical';
  };
  goalsAndPlanning: {
    shortTermGoals: string[];
    longTermGoals: string[];
    priorities: string[];
    availabilityHours: number;
  };
  analysis: {
    confidence: number;
    lastUpdated: string;
    recommendedActions: string[];
    riskFactors: string[];
  };
};

type Profile = {
  id: string;
  role: string;
  tone?: string;
  goals?: string[];
  level?: string;
  strengths?: string[];
  weaknesses?: string[];
  learningStyle?: {
    preferredMethods?: string[];
    concentration?: string;
    environment?: string;
    tools?: string[];
  };
  pastExperience?: string[];
  schedule?: any;
  examSpecific?: {
    targetDate?: string;
    previousResults?: any;
    studyStrategy?: string[];
    anxietyPoints?: string[];
  };
  motivation?: {
    reasons?: string[];
    dreamAfterGoal?: string;
    pastFailures?: string[];
    encouragementStyle?: string;
    rewardSystem?: string;
  };
  preferences?: {
    length?: string;
    formality?: string;
    emoji?: boolean;
    language?: string;
    feedbackStyle?: string;
  };
  currentChallenges?: string[];
  notes?: string[];
  // Legacy fields for backward compatibility
  name?: string;
  age?: number;
  grade?: string;
  subject?: string;
  specialty?: string[];
  style?: any;
  guardrails?: string[];
};

// コーチ声掛け機能の型定義
type CoachMessageType =
  | 'daily_suggestion'
  | 'progress_review'
  | 'motivation_boost'
  | 'celebration'
  | 'gentle_reminder'
  | 'challenge_support';

type CoachPrompt = {
  id: string;
  type: CoachMessageType;
  message: string;
  confidence: number;
  reasoning: string;
};

const defaultThread = 'thread_demo';

export function App() {
  const [threadId, setThreadId] = useState(defaultThread);
  const [studentId, setStudentId] = useState('student_rich_demo'); // デフォルトをリッチ版に
  const [coachId, setCoachId] = useState('coach_rich_demo'); // デフォルトをリッチ版に
  const [studentMessage, setStudentMessage] = useState('');
  const [coachMessage, setCoachMessage] = useState('');
  const [engine, setEngine] = useState<'mastra' | 'langgraph' | 'openai'>('mastra');
  const [debug, setDebug] = useState(false);
  const [showPlanEval, setShowPlanEval] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [studentProfile, setStudentProfile] = useState<Profile | null>(null);
  const [coachProfile, setCoachProfile] = useState<Profile | null>(null);
  const [editingStudent, setEditingStudent] = useState(false);
  const [editingCoach, setEditingCoach] = useState(false);
  const [editingStudentProfile, setEditingStudentProfile] = useState<Profile | null>(null);
  const [editingCoachProfile, setEditingCoachProfile] = useState<Profile | null>(null);
  const [lastPrompt, setLastPrompt] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryStats, setMemoryStats] = useState<any>(null);
  const [showMemories, setShowMemories] = useState(true);
  const [currentThinking, setCurrentThinking] = useState<ThinkingLog | null>(null);
  const [thinkingLogs, setThinkingLogs] = useState<Map<string, ThinkingLog>>(new Map());
  const [showThinkingPopup, setShowThinkingPopup] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false); // 全会話履歴を表示するかどうか
  const [replyMeta, setReplyMeta] = useState<Map<string, { plan?: any; eval?: any; traceId?: string }>>(new Map());
  const [expandedMeta, setExpandedMeta] = useState<Set<string>>(new Set());
  
  // 会話エリアの自動スクロール用ref
  const chatAreaRef = useRef<HTMLDivElement>(null);
  
  // ストリーミング関連の状態
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingRole, setStreamingRole] = useState<'student' | 'coach' | null>(null);
  const [enableStreaming, setEnableStreaming] = useState(true); // 🚀 デフォルトON
  
  // タスク計画の可視化用状態
  const [currentPlan, setCurrentPlan] = useState<any>(null);
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());
  
  // ストリーミング完了時の評価データ
  const [lastEvaluation, setLastEvaluation] = useState<any>(null);
  
  // Step 5: 構造化データ関連の状態
  const [structuredData, setStructuredData] = useState<Map<string, StructuredAnalysis>>(new Map());

  // コーチ声掛け機能の状態
  const [coachPrompts, setCoachPrompts] = useState<CoachPrompt[]>([]);
  const [showPromptSelector, setShowPromptSelector] = useState(false);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState<number | null>(null);
  const [editedPrompt, setEditedPrompt] = useState<string>('');
  const [loadingPrompts, setLoadingPrompts] = useState(false);

  // 学習記録関連の状態
  const [studyRecords, setStudyRecords] = useState<StudyRecord[]>([]);
  const [studyStats, setStudyStats] = useState<StudyStats | null>(null);
  const [showStudyDashboard, setShowStudyDashboard] = useState(false);

  // currentPlanの変化を監視
  useEffect(() => {
    console.log('🔄 currentPlan changed:', currentPlan);
    if (currentPlan) {
      console.log('📊 Plan details:', {
        goal: currentPlan.goal,
        stepsCount: currentPlan.steps?.length,
        steps: currentPlan.steps,
        timeBudget: currentPlan.timeBudgetMin
      });
    }
  }, [currentPlan]);
  
  // completedTasksの変化を監視
  useEffect(() => {
    console.log('✅ completedTasks changed:', {
      size: completedTasks.size,
      items: Array.from(completedTasks),
      currentPlanSteps: currentPlan?.steps?.map((s: any) => s.id)
    });
  }, [completedTasks, currentPlan]);
  
  // ストリーミングテキストに基づいてタスクを進行は削除（サーバーからの通知で管理）

  // Step 5: 構造化データ検出・解析関数
  const extractStructuredData = (message: string): StructuredAnalysis | null => {
    try {
      // メッセージから構造化分析結果を検索
      const structuredPattern = /【構造化プロフィール分析結果.*】[\s\S]*?(\{[\s\S]*?"type":\s*"structured_analysis"[\s\S]*?\})/m;
      const match = message.match(structuredPattern);
      
      if (match && match[1]) {
        const jsonData = JSON.parse(match[1]);
        if (jsonData.type === 'structured_analysis' && jsonData.data) {
          return jsonData.data as StructuredAnalysis;
        }
      }
      return null;
    } catch (error) {
      console.error('構造化データ解析エラー:', error);
      return null;
    }
  };

  // Step 5: 構造化データコンポーネント
  const renderStructuredAnalysis = (analysis: StructuredAnalysis, messageId: string) => {
    return (
      <div className="structured-analysis" style={{ 
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: '12px', 
        padding: '16px', 
        margin: '8px 0',
        color: 'white',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
      }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 'bold' }}>
          🧠 構造化プロフィール分析 - {analysis.userId}
        </h3>
        
        <div style={{ display: 'grid', gap: '12px', fontSize: '13px' }}>
          {/* 学習特性 */}
          <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '14px' }}>📚 学習特性</h4>
            <p><strong>レベル:</strong> {analysis.learningCharacteristics.level}</p>
            <p><strong>学習スタイル:</strong> {analysis.learningCharacteristics.preferredLearningStyle}</p>
            <p><strong>強み:</strong> {analysis.learningCharacteristics.strengths.join(', ')}</p>
            <p><strong>改善点:</strong> {analysis.learningCharacteristics.weaknesses.join(', ')}</p>
          </div>
          
          {/* 目標・計画 */}
          <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '14px' }}>🎯 目標・計画</h4>
            <p><strong>短期目標:</strong> {analysis.goalsAndPlanning.shortTermGoals.join(', ')}</p>
            <p><strong>長期目標:</strong> {analysis.goalsAndPlanning.longTermGoals.join(', ')}</p>
            <p><strong>学習時間:</strong> {analysis.goalsAndPlanning.availabilityHours}時間/日</p>
          </div>
          
          {/* 分析情報 */}
          <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '14px' }}>📊 分析情報</h4>
            <p><strong>信頼度:</strong> {Math.round(analysis.analysis.confidence * 100)}%</p>
            <p><strong>推奨アクション:</strong> {analysis.analysis.recommendedActions.slice(0, 2).join(', ')}</p>
            {analysis.analysis.riskFactors.length > 0 && (
              <p><strong>注意点:</strong> {analysis.analysis.riskFactors.slice(0, 2).join(', ')}</p>
            )}
          </div>
        </div>
        
        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.8 }}>
          最終更新: {new Date(analysis.analysis.lastUpdated).toLocaleString('ja-JP')}
        </div>
      </div>
    );
  };

  const fetchHistory = async () => {
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      const res = await fetch(`${base}/history/${threadId}`);
      if (res.ok) {
        const data = await res.json();
        const historyData = data.history || [];
        setHistory(historyData);
        
        // Step 5: 構造化データの検出・保存
        const newStructuredData = new Map(structuredData);
        historyData.forEach((entry: HistoryEntry, index: number) => {
          const messageId = `${entry.ts}-${index}`;
          const analysisData = extractStructuredData(entry.text);
          if (analysisData) {
            console.log('構造化データ検出:', messageId, analysisData);
            newStructuredData.set(messageId, analysisData);
          }
        });
        setStructuredData(newStructuredData);
        
        // 新しい履歴を取得した時は、表示を最新10件に戻す
        if (historyData.length > 0) {
          setShowAllHistory(false);
        }
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const fetchMemories = async (userId: string) => {
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      const res = await fetch(`${base}/memories/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
        setMemoryStats(data.stats || null);
      }
    } catch (err) {
      console.error('Failed to fetch memories:', err);
    }
  };

  const fetchStudyStats = async (userId: string) => {
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      const url = `${base}/study-stats/${userId}`;
      console.log('📊 Fetching study stats:', url);
      const res = await fetch(url);
      console.log('📊 Response status:', res.status);
      if (res.ok) {
        const data = await res.json();
        console.log('📊 Study stats received:', data);
        setStudyStats(data);
      } else {
        console.error('📊 Failed to fetch study stats, status:', res.status);
      }
    } catch (err) {
      console.error('Failed to fetch study stats:', err);
    }
  };

  const deleteMemoryItem = async (memoryId: string) => {
    if (!confirm('このメモリーを削除してもよろしいですか？')) {
      return;
    }

    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      const response = await fetch(
        `${base}/memories/${studentId}/${memoryId}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete memory');
      }

      // メモリーリストから削除
      setMemories(prev => prev.filter(m => m.id !== memoryId));

      // 統計情報を再取得
      fetchMemories(studentId);
    } catch (err) {
      console.error('Failed to delete memory:', err);
      setError('メモリーの削除に失敗しました');
    }
  };

  const fetchThinkingLog = async (messageId: string) => {
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      // バックエンドのポートはエンジンごとに異なる
      const port = engine === 'mastra' ? '4120' : engine === 'langgraph' ? '4121' : '4122';
      const backendUrl = `http://localhost:${port}${base}/thinking/${messageId}`;
      console.log('🧠 Fetching thinking log from:', backendUrl);
      const res = await fetch(backendUrl);
      if (res.ok) {
        const thinkingLog = await res.json();
        setThinkingLogs(prev => new Map(prev).set(messageId, thinkingLog));
        return thinkingLog;
      } else {
        console.error('Failed to fetch thinking log:', res.status, res.statusText);
      }
    } catch (err) {
      console.error('Failed to fetch thinking log:', err);
    }
    return null;
  };

  const fetchCurrentThinking = async () => {
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      const port = engine === 'mastra' ? '4120' : engine === 'langgraph' ? '4121' : '4122';
      const backendUrl = `http://localhost:${port}${base}/thinking/current`;
      console.log('🧠 Fetching current thinking from:', backendUrl, { threadId, engine });
      const res = await fetch(backendUrl);
      console.log('🧠 Thinking response status:', res.status);
      if (res.ok) {
        const data = await res.json();
        console.log('🧠 Thinking data received:', data);
        console.log('🧠 Debug info:', data.debug);
        const currentLogs = data.currentThinkingLogs || [];
        console.log('🧠 Current logs count:', currentLogs.length);
        if (currentLogs.length > 0) {
          // 現在のスレッドに関連する思考ログを探す
          console.log('🧠 Looking for threadId:', threadId);
          console.log('🧠 Available logs threadIds:', currentLogs.map((log: any) => log.threadId));
          const relevantLog = currentLogs.find((log: ThinkingLog) => log.threadId === threadId);
          console.log('🧠 Relevant log found:', relevantLog ? 'yes' : 'no', relevantLog);

          // もし一致するものがない場合は最初のログを使用（声掛け生成の場合）
          const logToUse = relevantLog || currentLogs[0];
          console.log('🧠 Setting currentThinking to:', logToUse);
          setCurrentThinking(logToUse);
        } else {
          console.log('🧠 No current thinking logs');
          setCurrentThinking(null);
        }
      } else {
        console.log('🧠 Thinking API error:', res.status, res.statusText);
      }
    } catch (err) {
      console.error('Failed to fetch current thinking:', err);
    }
  };

  const fetchProfile = async (id: string, type: 'student' | 'coach') => {
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      const res = await fetch(`${base}/profile/${id}`);
      if (res.ok) {
        const profile = await res.json();
        if (type === 'student') {
          setStudentProfile(profile);
        } else {
          setCoachProfile(profile);
        }
      } else if (res.status === 404) {
        console.warn(`Profile ${id} not found (404). No profile loaded.`);
        if (type === 'student') {
          setStudentProfile(null);
        } else {
          setCoachProfile(null);
        }
      }
    } catch (err) {
      console.error(`Failed to fetch ${type} profile:`, err);
      if (type === 'student') {
        setStudentProfile(null);
      } else {
        setCoachProfile(null);
      }
    }
  };

  const startEditProfile = (type: 'student' | 'coach') => {
    if (type === 'student') {
      if (studentProfile) {
        setEditingStudentProfile(studentProfile);
        setEditingStudent(true);
      } else {
        console.warn('No student profile available for editing');
      }
    } else {
      if (coachProfile) {
        setEditingCoachProfile(coachProfile);
        setEditingCoach(true);
      } else {
        console.warn('No coach profile available for editing');
      }
    }
  };

  const saveProfile = async (id: string, profile: Profile | null) => {
    if (!profile) {
      console.error('Profile is null or undefined');
      return;
    }
    
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      const res = await fetch(`${base}/profile/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(profile)
      });
      if (res.ok) {
        if (profile.role === 'student') {
          setEditingStudent(false);
          setStudentProfile(profile);
          setEditingStudentProfile(null);
        } else {
          setEditingCoach(false);
          setCoachProfile(profile);
          setEditingCoachProfile(null);
        }
      } else {
        console.error('Failed to save profile:', await res.text());
      }
    } catch (err) {
      console.error('Failed to save profile:', err);
    }
  };

  useEffect(() => {
    fetchHistory();
    // エンジン変更時は思考ログをクリア
    if (engine !== 'mastra') {
      setThinkingLogs(new Map());
      return;
    }
    
    // Mastraエンジンの場合は思考ログも取得
    setTimeout(async () => {
      try {
        const base = '/agent';
        const res = await fetch(`${base}/thinking/thread/${threadId}`);
        if (res.ok) {
          const data = await res.json();
          const logs = data.thinkingLogs || [];
          const newThinkingLogs = new Map<string, ThinkingLog>();
          logs.forEach((log: ThinkingLog) => {
            newThinkingLogs.set(log.messageId, log);
          });
          setThinkingLogs(newThinkingLogs);
        }
      } catch (err) {
        console.error('Failed to fetch thread thinking logs on load:', err);
      }
    }, 500);
  }, [threadId, engine]);

  useEffect(() => {
    fetchProfile(studentId, 'student');
  }, [studentId, engine]);

  useEffect(() => {
    fetchProfile(coachId, 'coach');
  }, [coachId, engine]);

  // 生徒ID変更時に専用のスレッドIDを自動設定
  useEffect(() => {
    setThreadId(`thread_${studentId}`);
  }, [studentId]);

  // コンポーネントマウント時とstudentId変更時にメモリーを取得
  useEffect(() => {
    if (showMemories) {
      fetchMemories(studentId);
    }
  }, [studentId, showMemories]);

  // コンポーネントマウント時とstudentId変更時に学習統計を取得
  useEffect(() => {
    if (showStudyDashboard) {
      fetchStudyStats(studentId);
    }
  }, [studentId, showStudyDashboard]);

  // 思考ログのポーリング（loading中、streaming中、またはloadingPrompts中）
  useEffect(() => {
    let interval: NodeJS.Timeout;
    // ローディング中、ストリーミング中、または声掛け生成中（Mastraエンジンのみ）は0.5秒ごとに思考状況をチェック
    if ((loading || streaming || loadingPrompts) && engine === 'mastra') {
      console.log('🧠 Starting thinking log polling due to:', { loading, streaming, loadingPrompts, engine });
      // 即座に一度取得
      fetchCurrentThinking();
      // その後定期的に取得
      interval = setInterval(() => {
        fetchCurrentThinking();
      }, 500); // 0.5秒間隔でポーリング
    }

    return () => {
      if (interval) {
        console.log('🧠 Stopping thinking log polling');
        clearInterval(interval);
      }
    };
  }, [loading, streaming, loadingPrompts, threadId, engine]);

  // 思考ログが完了したら自動的に非表示にする
  useEffect(() => {
    if (currentThinking?.status === 'completed') {
      console.log('🧠 Thinking completed, will auto-hide in 2 seconds');
      const timer = setTimeout(() => {
        console.log('🧠 Auto-hiding completed thinking log');
        setCurrentThinking(null);
      }, 2000); // 2秒後に非表示
      
      return () => clearTimeout(timer);
    }
  }, [currentThinking?.status]);

  // 自動スクロール機能
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [history, streamingText, currentThinking]); // 履歴、ストリーミングテキスト、思考ログの変更時にスクロール

  const buildPrompt = (role: Role, message: string) => {
    const self = role === 'student' ? studentProfile : coachProfile;
    const peer = role === 'student' ? coachProfile : studentProfile;
    
    const sysParts: string[] = [];
    if (self) sysParts.push(`【自分のプロフィール(${self.id})】\n${JSON.stringify(self, null, 2)}`);
    if (peer) sysParts.push(`【相手のプロフィール(${peer.id})】\n${JSON.stringify(peer, null, 2)}`);
    if (history.length) {
      sysParts.push(`【会話履歴 抜粋（新しい順 最大8件）】\n${history.slice(-8).map((h) => `- [${h.ts ?? ''} ${h.role ?? ''}] ${h.text}`).join('\n')}`);
    }
    
    const system = sysParts.join('\n\n');
    const userPrompt = `あなたの役割: ${role}\n\nユーザーからの新規メッセージ:\n${message}\n\n出力は純テキストのみ。`;
    
    return `=== SYSTEM PROMPT ===\n${system}\n\n=== USER PROMPT ===\n${userPrompt}`;
  };

  const sendMessage = async (role: Role, message: string) => {
    if (!message.trim()) return;
    
    // プロンプトを構築して保存
    const fullPrompt = buildPrompt(role, message);
    setLastPrompt(fullPrompt);
    
    // 新しいメッセージ送信時に古い思考ログをクリア
    console.log('🧠 Clearing currentThinking due to new message send (non-streaming)');
    setCurrentThinking(null);
    
    // 🚀 送信したメッセージを即座に履歴に追加（UX改善）
    const userMessage: HistoryEntry = {
      role,
      text: message,
      ts: new Date().toISOString()
    };
    console.log('📝 Adding user message to history immediately:', userMessage);
    setHistory(prev => [...prev, userMessage]);
    
    setLoading(true);
    setError('');
    
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      const res = await fetch(`${base}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          threadId,
          role,
          message,
          profileIds: { 
            self: role === 'student' ? studentId : coachId, 
            peer: role === 'student' ? coachId : studentId 
          },
          debug,
        }),
      });
      
      if (!res.ok) throw new Error(await res.text());

      // デバッグONのとき、評価と計画を取得（Mastraのみ）
      let meta: { eval?: any; plan?: any; traceId?: string } | null = null;
      if (debug && base === '/agent') {
        try {
          const data = await res.json();
          meta = { eval: data?.eval, plan: data?.plan, traceId: data?.traceId };
        } catch (_) {
          // ignore JSON parse failure
        }
      }

      // 送信後に履歴を再取得
      await fetchHistory();
      // 直近のAI返信にメタを紐づけ
      if (meta) {
        const base2 = base;
        try {
          const res2 = await fetch(`${base2}/history/${threadId}`);
          if (res2.ok) {
            const data2 = await res2.json();
            const historyData = data2.history || [];
            if (historyData.length > 0) {
              const last = historyData[historyData.length - 1];
              const key = last.ts ? String(last.ts) : `${Date.now()}`;
              setReplyMeta(prev => new Map(prev).set(key, meta!));
            }
          }
        } catch {}
      }
      
      // 思考ログも取得（Mastraエンジンの場合のみ）
      if (engine === 'mastra') {
        // スレッドの全思考ログを取得し、最新のものを取得
        setTimeout(async () => {
          try {
            const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
            const res = await fetch(`${base}/thinking/thread/${threadId}`);
            if (res.ok) {
              const data = await res.json();
              const logs = data.thinkingLogs || [];
              // 最新のログを思考ログMapに追加（既存のログを保持）
              setThinkingLogs(prev => {
                const newMap = new Map(prev);
                logs.forEach((log: ThinkingLog) => {
                  newMap.set(log.messageId, log);
                });
                return newMap;
              });
            }
          } catch (err) {
            console.error('Failed to fetch thread thinking logs:', err);
          }
        }, 1000);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
      
      // 🚀 思考ログを即座にクリア（UX改善）
      console.log('🧠 Clearing thinking log after non-streaming completion');
      setCurrentThinking(null);
    }
  };

  const toggleMetaExpand = (key: string) => {
    setExpandedMeta(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ストリーミング送信関数
  const sendMessageStreaming = async (role: Role, message: string) => {
    if (!message.trim()) return;
    
    console.log('🚀 Starting streaming for role:', role);
    // 新しいメッセージ送信時に古い思考ログをクリア
    console.log('🧠 Clearing currentThinking due to new message send (streaming)');
    setCurrentThinking(null);
    
    // 🚀 送信したメッセージを即座に履歴に追加（UX改善）
    const userMessage: HistoryEntry = {
      role,
      text: message,
      ts: new Date().toISOString()
    };
    console.log('📝 Adding user message to history immediately:', userMessage);
    setHistory(prev => [...prev, userMessage]);
    
    setStreaming(true);
    setStreamingText('');
    setStreamingRole(role === 'student' ? 'coach' : 'student'); // 返信する役割
    console.log('🎯 Streaming state:', { streaming: true, streamingRole: role === 'student' ? 'coach' : 'student' });
    setError('');
    setLastEvaluation(null); // 前回の評価をクリア
    
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      const response = await fetch(`${base}/ask-stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          threadId,
          role,
          message,
          profileIds: { 
            self: role === 'student' ? studentId : coachId, 
            peer: role === 'student' ? coachId : studentId 
          },
        }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      // メッセージは既にボタンクリック時にクリア済み

      // ストリーミングレスポンスを読み取り
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body reader');

      const decoder = new TextDecoder();
      let accumulatedText = '';
      let evaluationData: any = null;
      let planData: any = null;
      let isCapturingEvaluation = false;
      let isCapturingPlan = false;
      let captureBuffer = '';
      let streamBuffer = ''; // SSEチャンクのバッファ

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        console.log('📨 Raw chunk received:', chunk);
        
        // SSEチャンクをバッファに追加
        streamBuffer += chunk;
        
        // 完全なメッセージを処理
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || ''; // 未完成の行を保持
        
        for (const line of lines) {
          console.log('📄 Processing line:', line);
          
          // 計画データの処理
          if (line.includes('[PLAN_START]')) {
            console.log('🎯 [PLAN_START] detected');
            isCapturingPlan = true;
            captureBuffer = '';
            continue;
          }
        
          if (isCapturingPlan) {
            if (line.includes('[PLAN_END]')) {
              console.log('🎯 [PLAN_END] detected');
              console.log('📦 Capture buffer:', captureBuffer);
              isCapturingPlan = false;
              // 計画データをパース
              try {
                // captureBufferからJSONデータを抽出
                if (captureBuffer.startsWith('data: ')) {
                  const jsonStr = captureBuffer.substring(6).trim();
                  console.log('🔗 JSON string to parse:', jsonStr);
                  planData = JSON.parse(jsonStr);
                  console.log('📋 Plan data received:', planData);
                  console.log('🔥 Setting currentPlan with:', planData.data);
                  console.log('🔍 Plan structure:', {
                    hasGoal: !!planData.data?.goal,
                    hasSteps: !!planData.data?.steps,
                    stepsCount: planData.data?.steps?.length || 0,
                    timeBudget: planData.data?.timeBudgetMin
                  });
                  setCurrentPlan(planData.data);
                  setCompletedTasks(new Set()); // タスク完了状態をリセット
                  
                  // 計画データを即座にlastEvaluationにも保存（下部パネル表示用）
                  setLastEvaluation({ plan: planData.data });
                  console.log('✅ Plan set successfully, should display task list panel');
                  
                  // AI処理フローの固定ステップであるため、
                  // サーバーからのステップ完了通知で進行管理
                  
                  // 現在の状態を確認
                  setTimeout(() => {
                    console.log('🔍 After 100ms - currentPlan exists?', !!planData.data);
                  }, 100);
                } else {
                  console.error('❌ Invalid capture buffer format:', captureBuffer);
                }
              } catch (e) {
                console.error('❌ Failed to parse plan data:', e);
                console.error('❌ Buffer content:', captureBuffer);
              }
              continue;
            }
            // SSEフォーマットのデータ行をキャプチャ
            if (line.startsWith('data: ')) {
              console.log('📝 Capturing plan data line:', line);
              captureBuffer = line; // 最新のデータ行を保持
            }
            continue;
          }
        
          // 評価データの処理
          if (line.includes('[EVALUATION_START]')) {
            isCapturingEvaluation = true;
            captureBuffer = '';
            continue;
          }
        
          if (isCapturingEvaluation) {
            if (line.includes('[EVALUATION_END]')) {
              isCapturingEvaluation = false;
              // 評価データをパース
              try {
                if (captureBuffer.startsWith('data: ')) {
                  const jsonStr = captureBuffer.substring(6).trim();
                  evaluationData = JSON.parse(jsonStr);
                  console.log('📊 Evaluation data received:', evaluationData);
                  
                  // 評価データをlastEvaluationに保存（下部パネル表示用）
                  setLastEvaluation(prev => ({
                    ...prev,
                    ...evaluationData.data
                  }));
                }
              } catch (e) {
                console.error('Failed to parse evaluation data:', e);
              }
              continue;
            }
            // SSEフォーマットのデータ行をキャプチャ
            if (line.startsWith('data: ')) {
              captureBuffer = line; // 最新のデータ行を保持
            }
            continue;
          }
        
          // ステップ完了通知の処理
          if (line.includes('[STEP_COMPLETE:') || line.includes('[STEP_START:')) {
            console.log('📌 Processing step notification line:', line);
            
            // data: プレフィックスを除去
            const content = line.startsWith('data: ') ? line.substring(6) : line;
            const stepMatch = content.match(/\[STEP_(COMPLETE|START):([^\]]+)\]/);
            
            if (stepMatch) {
              const [, action, stepId] = stepMatch;
              console.log(`🎯 Step ${action.toLowerCase()}: ${stepId}`);
              console.log('🔍 Current plan state:', {
                hasPlan: !!currentPlan,
                steps: currentPlan?.steps?.map((s: any) => s.id),
                completedTasks: Array.from(completedTasks)
              });
              
              if (action === 'COMPLETE') {
                // ステップを完了としてマーク
                // currentPlanがまだない場合でも、後で適用できるように保存
                setCompletedTasks(prev => {
                  const newSet = new Set(prev);
                  newSet.add(stepId);
                  console.log(`✅ Step marked as completed: ${stepId} (total: ${newSet.size})`);
                  return newSet;
                });
              }
            } else {
              console.log('⚠️ No step match found in line:', content);
            }
            continue;
          }
          
          // 通常のテキストストリーミング
          if (!line.includes('[PLAN') && !line.includes('[EVALUATION') && !line.includes('[STEP_') && line.trim()) {
            // SSEフォーマットのデータを処理
            if (line.startsWith('data: ')) {
              const content = line.substring(6);
              if (content && !content.startsWith('{')) { // JSONではないテキスト
                accumulatedText += content;
                console.log('📝 Streaming text:', content);
                console.log('💬 Total text length:', accumulatedText.length);
                setStreamingText(accumulatedText);
              }
            }
          }
        }
      }

      // ストリーミング完了後に履歴を再取得
      await fetchHistory();
      
      // 評価データがあれば保存（B案: ハイブリッド方式）
      if (evaluationData && evaluationData.type === 'evaluation') {
        // ストリーミング返信用の仮のタイムスタンプを作成
        const replyTimestamp = new Date().toISOString();
        
        // 履歴に追加される返信と同じタイムスタンプをキーとして使用
        setReplyMeta(prev => {
          const newMap = new Map(prev);
          newMap.set(replyTimestamp, { 
            plan: evaluationData.data.plan,
            eval: evaluationData.data
          });
          return newMap;
        });
        
        // 最新の会話履歴エントリーに評価データを紐付ける
        setTimeout(() => {
          // 履歴から最新のコーチメッセージを探す
          fetchHistory().then(() => {
            // 評価データを最新のコーチメッセージに再マッピング
            setHistory(prevHistory => {
              if (prevHistory.length > 0) {
                const lastCoachEntry = [...prevHistory].reverse().find(h => h.role === 'coach');
                if (lastCoachEntry && lastCoachEntry.ts) {
                  setReplyMeta(prev => {
                    const newMap = new Map(prev);
                    // 実際のタイムスタンプで再保存
                    newMap.set(String(lastCoachEntry.ts), { 
                      plan: evaluationData.data.plan,
                      eval: evaluationData.data
                    });
                    // 仮のタイムスタンプは削除
                    newMap.delete(replyTimestamp);
                    return newMap;
                  });
                }
              }
              return prevHistory;
            });
          });
        }, 500);
        
        // 評価パネルを自動的に展開（デモ用）
        if (debug) {
          setExpandedMeta(prev => {
            const newSet = new Set(prev);
            newSet.add(replyTimestamp);
            return newSet;
          });
          
          // 🎯 デモ用: トースト通知風のフィードバック
          const score = Math.round(evaluationData.data.overall * 100);
          const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
          const scoreEmoji = score >= 80 ? '🎉' : score >= 60 ? '💭' : '🔄';
          
          // 一時的な視覚的フィードバック（実際のトースト実装は省略）
          console.log(`${scoreEmoji} 品質評価完了: ${score}/100点`, {
            color: scoreColor,
            badge: '自己診断'
          });
        }
        
        console.log('✅ Evaluation data saved for streaming message');
        console.log('📊 評価サマリー:', {
          総合スコア: `${Math.round(evaluationData.data.overall * 100)}/100`,
          関連性: evaluationData.data.scores?.relevance,
          有用性: evaluationData.data.scores?.helpfulness,
          文体: evaluationData.data.scores?.style,
          忠実性: evaluationData.data.scores?.faithfulness,
          合格: evaluationData.data.pass ? '✅' : '❌'
        });
      }
      
      // 思考ログも取得（Mastraエンジンの場合のみ）
      if (engine === 'mastra') {
        // スレッドの全思考ログを取得し、最新のものを取得
        setTimeout(async () => {
          try {
            const res = await fetch(`${base}/thinking/thread/${threadId}`);
            if (res.ok) {
              const data = await res.json();
              const logs = data.thinkingLogs || [];
              // 最新のログを思考ログMapに追加（既存のログを保持）
              setThinkingLogs(prev => {
                const newMap = new Map(prev);
                logs.forEach((log: ThinkingLog) => {
                  newMap.set(log.messageId, log);
                });
                return newMap;
              });
              
              // タスク実行状況をトラッキング（計画がある場合）
              if (currentPlan && logs.length > 0) {
                const latestLog = logs[logs.length - 1];
                if (latestLog.steps) {
                  // 完了したツールを検出してタスクを更新
                  const completedToolNames = new Set<string>();
                  latestLog.steps.forEach((step: any) => {
                    if (step.step.includes('完了') || step.level === 'success') {
                      // RetrieveMemoryTool完了、ProfileTool完了などを検出
                      if (step.step.includes('RetrieveMemoryTool')) {
                        completedToolNames.add('memory');
                      } else if (step.step.includes('ProfileTool')) {
                        completedToolNames.add('profile');
                      } else if (step.step.includes('SaveMemoryTool')) {
                        completedToolNames.add('save');
                      }
                    }
                  });
                  
                  // タスクステップと完了状況を照合
                  setCompletedTasks(prev => {
                    const newSet = new Set(prev);
                    currentPlan.steps?.forEach((step: any, index: number) => {
                      // タスクタイトルやアクションから判定
                      if (step.title.includes('記憶') && completedToolNames.has('memory')) {
                        newSet.add(step.id);
                      } else if (step.title.includes('プロフィール') && completedToolNames.has('profile')) {
                        newSet.add(step.id);
                      } else if (step.title.includes('保存') && completedToolNames.has('save')) {
                        newSet.add(step.id);
                      }
                      // インデックスベースでも判定（順番に実行される場合）
                      if (index < completedToolNames.size) {
                        newSet.add(step.id);
                      }
                    });
                    return newSet;
                  });
                }
              }
            }
          } catch (err) {
            console.error('Failed to fetch thread thinking logs:', err);
          }
        }, 1000);
      }

    } catch (err: any) {
      console.error('❌ Streaming error:', err);
      setError(err?.message ?? String(err));
    } finally {
      console.log('🏁 Streaming finished');
      setStreaming(false);
      setStreamingText('');
      setStreamingRole(null);
      // タスク表示もリセット（デモ用に長めに保持）
      console.log('⏱️ Scheduling currentPlan reset in 30 seconds');
      setTimeout(() => {
        console.log('🔄 Resetting currentPlan after 30 seconds');
        setCurrentPlan(null);
        setCompletedTasks(new Set());
        // lastEvaluationは残す（下部パネルは継続表示）
      }, 30000); // 30秒後にリセット（デモ用に長く）
      
      // 🚀 思考ログを即座にクリア（UX改善）
      console.log('🧠 Clearing thinking log after streaming completion');
      setCurrentThinking(null);
    }
  };

  const handleStudentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const messageToSend = studentMessage; // 送信前にメッセージを保存
    console.log('🚀 Submit:', { enableStreaming, engine, message: messageToSend });
    
    // 🚀 即座にメッセージフィールドをクリア（UX改善）
    setStudentMessage('');
    console.log('🧹 Immediate clear: Student message field cleared on click');
    
    if (enableStreaming && (engine === 'mastra' || engine === 'langgraph' || engine === 'openai')) {
      console.log('✅ Using streaming mode');
      sendMessageStreaming('student', messageToSend);
    } else {
      console.log('📝 Using normal mode');
      sendMessage('student', messageToSend);
    }
  };

  const handleCoachSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const messageToSend = coachMessage; // 送信前にメッセージを保存
    console.log('🚀 Coach Submit:', { enableStreaming, engine, message: messageToSend });

    // 🚀 即座にメッセージフィールドをクリア（UX改善）
    setCoachMessage('');
    console.log('🧹 Immediate clear: Coach message field cleared on click');

    if (enableStreaming && (engine === 'mastra' || engine === 'langgraph' || engine === 'openai')) {
      console.log('✅ Using streaming mode');
      sendMessageStreaming('coach', messageToSend);
    } else {
      console.log('📝 Using normal mode');
      sendMessage('coach', messageToSend);
    }
  };

  // コーチから声掛け機能
  const handleCoachPrompt = async () => {
    setLoadingPrompts(true);
    setError('');
    setCurrentThinking(null); // 古い思考ログをクリア

    try {
      const response = await fetch(`http://localhost:${engine === 'mastra' ? '4120' : engine === 'langgraph' ? '4121' : '4122'}/agent/coach-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          studentId,
          coachId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to generate prompts: ${response.statusText}`);
      }

      const data = await response.json();

      // 思考ログIDがあれば取得して保存し、currentThinkingにセット
      if (data.thinkingLogId) {
        const thinkingLog = await fetchThinkingLog(data.thinkingLogId);
        if (thinkingLog) {
          console.log('🧠 Coach prompt thinking log fetched:', thinkingLog);
          // 生成完了後でも思考ログを表示
          setCurrentThinking(thinkingLog);
        }
      }

      // 思考ログIDがあれば、各プロンプトに付与
      const promptsWithThinkingLog = (data.suggestions || []).map((prompt: any) => ({
        ...prompt,
        thinkingLogId: prompt.thinkingLogId || data.thinkingLogId
      }));

      setCoachPrompts(promptsWithThinkingLog);
      setShowPromptSelector(true);
      setSelectedPromptIndex(null);
      setEditedPrompt('');
    } catch (err) {
      console.error('Failed to generate coach prompts:', err);
      setError('コーチ声掛けメッセージの生成に失敗しました');
    } finally {
      setLoadingPrompts(false);
    }
  };

  const handleSelectPrompt = (index: number) => {
    setSelectedPromptIndex(index);
    setEditedPrompt(coachPrompts[index].message);
  };

  const handleSendSelectedPrompt = async () => {
    if (selectedPromptIndex === null || !editedPrompt.trim()) return;

    // コーチからのメッセージを履歴に追加（自動返信なし）
    const timestamp = new Date().toISOString();
    const coachMessage: HistoryEntry = {
      role: 'coach',
      ts: timestamp,
      text: editedPrompt
    };
    setHistory(prev => [...prev, coachMessage]);

    // 履歴をサーバーに保存
    writeHistory(threadId, 'coach', editedPrompt);

    // 思考ログIDを保存（もしあれば）
    const selectedPrompt = coachPrompts[selectedPromptIndex];
    if (selectedPrompt && (selectedPrompt as any).thinkingLogId) {
      const thinkingLogId = (selectedPrompt as any).thinkingLogId;
      // 思考ログを取得して、タイムスタンプと紐付けて保存
      const thinkingLog = await fetchThinkingLog(thinkingLogId);
      if (thinkingLog) {
        // 思考ログのstartTimeをメッセージのタイムスタンプで上書き
        // これにより、履歴表示時にタイムスタンプベースでマッチングできる
        const updatedLog = {
          ...thinkingLog,
          startTime: timestamp,
          threadId: threadId
        };
        setThinkingLogs(prev => {
          const newMap = new Map(prev);
          // タイムスタンプベースのキーで保存
          newMap.set(`coach-prompt-${timestamp}`, updatedLog);
          return newMap;
        });
      }
    }

    // モーダルを閉じてリセット
    setShowPromptSelector(false);
    setCoachPrompts([]);
    setSelectedPromptIndex(null);
    setEditedPrompt('');
  };

  // 履歴をサーバーに保存する関数
  const writeHistory = async (threadId: string, role: string, text: string) => {
    try {
      const base = engine === 'mastra' ? '/agent' : engine === 'langgraph' ? '/agent-lg' : '/agent-oa';
      await fetch(`${base}/history/${threadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, text })
      });
    } catch (err) {
      console.error('Failed to write history:', err);
    }
  };

  return (
    <>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
          }
        `}
      </style>
      <div style={{ 
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        margin: '0 auto',
        maxWidth: 1200,
        padding: '20px',
        minHeight: '100vh'
      }}>
      {/* ヘッダー */}
      <div style={{
        background: 'white',
        borderRadius: 16,
        padding: '24px 32px',
        marginBottom: 16,
        boxShadow: '0 10px 30px rgba(0,0,0,0.1)'
      }}>
        <h1 style={{
          margin: 0,
          fontSize: '2rem',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          display: 'inline-block'
        }}>
          🎯 AI Agent PoC
        </h1>
        <p style={{
          margin: '8px 0 0 0',
          color: '#6b7280',
          fontSize: '1.1rem'
        }}>
          生徒・コーチ会話シミュレータ
        </p>
      </div>

      {/* スレッドID表示 - ヘッダー直下 */}
      <div style={{
        background: 'white',
        borderRadius: 16,
        padding: '12px 20px',
        marginBottom: 24,
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          <span style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: '#6b7280'
          }}>
            📋 スレッドID ({studentId}専用):
          </span>
          <span style={{
            fontSize: '0.875rem',
            fontFamily: 'monospace',
            color: '#374151',
            background: '#f3f4f6',
            padding: '4px 8px',
            borderRadius: 4
          }}>
            {threadId}
          </span>
        </div>
      </div>

      {/* 設定パネル - 最上部に移動 */}
      <div style={{
        background: 'white',
        borderRadius: 16,
        padding: 24,
        marginBottom: 24,
        boxShadow: '0 10px 30px rgba(0,0,0,0.1)'
      }}>
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: '1fr 0.8fr 1fr 1fr 0.8fr 0.8fr',
          gap: 16,
          alignItems: 'end'
        }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#374151',
              marginBottom: 8
            }}>
              ⚙️ エンジン
            </label>
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value as 'mastra' | 'langgraph' | 'openai')}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: '1rem',
                background: 'white',
                cursor: 'pointer'
              }}
            >
              <option value="mastra">Mastra (TS)</option>
              <option value="langgraph">LangGraph.js</option>
              <option value="openai">OpenAI Agents SDK</option>
            </select>
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#374151',
              marginBottom: 8
            }}>
              ⚡ ストリーミング
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: 'white',
              height: '43px' // selectと同じ高さに調整
            }}>
              <input
                type="checkbox"
                id="streaming-toggle"
                checked={enableStreaming}
                onChange={(e) => setEnableStreaming(e.target.checked)}
                disabled={engine !== 'mastra' && engine !== 'langgraph' && engine !== 'openai'}
                style={{
                  cursor: (engine === 'mastra' || engine === 'langgraph' || engine === 'openai') ? 'pointer' : 'not-allowed',
                  opacity: (engine === 'mastra' || engine === 'langgraph' || engine === 'openai') ? 1 : 0.5
                }}
              />
              <label 
                htmlFor="streaming-toggle" 
                style={{
                  fontSize: '0.875rem',
                  cursor: (engine === 'mastra' || engine === 'langgraph' || engine === 'openai') ? 'pointer' : 'not-allowed',
                  opacity: (engine === 'mastra' || engine === 'langgraph' || engine === 'openai') ? 1 : 0.5,
                  color: (engine === 'mastra' || engine === 'langgraph' || engine === 'openai') ? '#374151' : '#9ca3af'
                }}
              >
                {enableStreaming && (engine === 'mastra' || engine === 'langgraph' || engine === 'openai') ? 'ON' : 'OFF'}
              </label>
            </div>
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#374151',
              marginBottom: 8
            }}>
              👤 生徒プロフィール
            </label>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: '1rem',
                background: 'white',
                cursor: 'pointer'
              }}
            >
              <option value="student_rich_demo">student_rich_demo (リッチ・推奨)</option>
              <option value="student_001">student_001 (シンプル)</option>
            </select>
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#374151',
              marginBottom: 8
            }}>
              👩‍🏫 コーチプロフィール
            </label>
            <select
              value={coachId}
              onChange={(e) => setCoachId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: '1rem',
                background: 'white',
                cursor: 'pointer'
              }}
            >
              <option value="coach_rich_demo">coach_rich_demo (リッチ・推奨)</option>
              <option value="coach_001">coach_001 (シンプル)</option>
            </select>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px',
            background: debug ? '#fef2f2' : '#f9fafb',
            borderRadius: 8,
            border: `2px solid ${debug ? '#ef4444' : '#e5e7eb'}`,
            cursor: 'pointer'
          }}
          onClick={() => setDebug(!debug)}
          >
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              userSelect: 'none'
            }}>
              <input 
                type="checkbox" 
                checked={debug} 
                onChange={(e) => setDebug(e.target.checked)}
                style={{
                  width: 18,
                  height: 18,
                  cursor: 'pointer'
                }}
              /> 
              <span style={{
                fontWeight: 600,
                color: debug ? '#dc2626' : '#6b7280'
              }}>
                🐛 Debug
              </span>
            </label>
          </div>

          <button
            onClick={() => setShowPrompt(!showPrompt)}
            style={{
              padding: '10px',
              background: showPrompt ? '#4338ca' : '#e5e7eb',
              color: showPrompt ? 'white' : '#6b7280',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.875rem'
            }}
          >
          {showPrompt ? '📝 プロンプト表示中' : '👁️ プロンプト表示'}
          </button>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px',
            background: showPlanEval ? '#ecfeff' : '#f9fafb',
            borderRadius: 8,
            border: `2px solid ${showPlanEval ? '#06b6d4' : '#e5e7eb'}`,
            cursor: 'pointer',
            marginTop: 10
          }}
          onClick={() => setShowPlanEval(!showPlanEval)}
          >
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              userSelect: 'none'
            }}>
              <input 
                type="checkbox" 
                checked={showPlanEval} 
                onChange={(e) => setShowPlanEval(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              /> 
              <span style={{ fontWeight: 600, color: showPlanEval ? '#0e7490' : '#6b7280' }}>
                🧭 計画/評価パネル
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* プロフィール編集エリア */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* 生徒プロフィール */}
        <div style={{
          background: 'white',
          borderRadius: 16,
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            padding: '16px 20px',
            color: 'white',
            fontWeight: 600,
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>👤 生徒プロフィール ({studentId})</span>
            <button
              onClick={() => editingStudent ? saveProfile(studentId, editingStudentProfile) : startEditProfile('student')}
              style={{
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
                padding: '6px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              {editingStudent ? '💾 保存' : '✏️ 編集'}
            </button>
          </div>
          <div style={{ padding: 20, maxHeight: 300, overflowY: 'auto' }}>
            {editingStudent && editingStudentProfile ? (
              <textarea
                value={JSON.stringify(editingStudentProfile, null, 2)}
                onChange={(e) => {
                  try {
                    setEditingStudentProfile(JSON.parse(e.target.value));
                  } catch {}
                }}
                style={{
                  width: '100%',
                  height: 250,
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  padding: 8,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6
                }}
              />
            ) : (
              <pre style={{
                margin: 0,
                fontSize: '0.875rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                color: studentProfile ? '#374151' : '#ef4444'
              }}>
                {studentProfile ? JSON.stringify(studentProfile, null, 2) : `❌ プロフィール "${studentId}" の読み込みに失敗しました\n\n考えられる原因:\n- ファイルパスの問題\n- サーバー接続エラー\n- ファイルが存在しない\n\nサーバーログを確認してください。`}
              </pre>
            )}
          </div>
        </div>

        {/* コーチプロフィール */}
        <div style={{
          background: 'white',
          borderRadius: 16,
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            padding: '16px 20px',
            color: 'white',
            fontWeight: 600,
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>🎓 コーチプロフィール ({coachId})</span>
            <button
              onClick={() => editingCoach ? saveProfile(coachId, editingCoachProfile) : startEditProfile('coach')}
              style={{
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
                padding: '6px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              {editingCoach ? '💾 保存' : '✏️ 編集'}
            </button>
          </div>
          <div style={{ padding: 20, maxHeight: 300, overflowY: 'auto' }}>
            {editingCoach && editingCoachProfile ? (
              <textarea
                value={JSON.stringify(editingCoachProfile, null, 2)}
                onChange={(e) => {
                  try {
                    setEditingCoachProfile(JSON.parse(e.target.value));
                  } catch {}
                }}
                style={{
                  width: '100%',
                  height: 250,
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  padding: 8,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6
                }}
              />
            ) : (
              <pre style={{
                margin: 0,
                fontSize: '0.875rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                color: coachProfile ? '#374151' : '#ef4444'
              }}>
                {coachProfile ? JSON.stringify(coachProfile, null, 2) : `❌ プロフィール "${coachId}" の読み込みに失敗しました\n\n考えられる原因:\n- ファイルパスの問題\n- サーバー接続エラー\n- ファイルが存在しない\n\nサーバーログを確認してください。`}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* プロンプト表示エリア */}
      {showPrompt && lastPrompt && (
        <div style={{
          background: '#1f2937',
          color: '#10b981',
          borderRadius: 16,
          padding: 20,
          marginBottom: 24,
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          fontFamily: 'monospace',
          fontSize: '0.875rem',
          whiteSpace: 'pre-wrap',
          maxHeight: 400,
          overflowY: 'auto'
        }}>
          <div style={{ color: '#fbbf24', marginBottom: 12, fontWeight: 600 }}>
            📋 最後に送信されたプロンプト:
          </div>
          {lastPrompt}
        </div>
      )}

      {/* 学習記録ダッシュボード */}
      <div style={{
        background: 'white',
        borderRadius: 16,
        boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
        marginBottom: 24,
        overflow: 'hidden'
      }}>
        <div 
          onClick={() => {
            if (!showStudyDashboard) {
              fetchStudyStats(studentId);
            }
            setShowStudyDashboard(!showStudyDashboard);
          }}
          style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            padding: '16px 20px',
            color: 'white',
            fontWeight: 600,
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <span style={{ fontSize: '0.95rem' }}>📊 学習記録ダッシュボード</span>
          <span style={{ 
            fontSize: '1.2rem',
            transition: 'transform 0.2s ease'
          }}>
            {showStudyDashboard ? '▼' : '▶'}
          </span>
        </div>
        {showStudyDashboard && !studyStats && (
          <div style={{
            textAlign: 'center',
            color: '#6b7280',
            padding: 40,
            fontSize: '0.9rem'
          }}>
            データを読み込み中...
          </div>
        )}
        {showStudyDashboard && studyStats && (
          <div style={{ padding: 20 }}>
            {/* 全体統計 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 16,
              marginBottom: 24
            }}>
              <div style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                borderRadius: 12,
                padding: 16,
                color: 'white'
              }}>
                <div style={{ fontSize: '0.85rem', marginBottom: 8, opacity: 0.9 }}>累計学習時間</div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                  {Math.floor(studyStats.totalStudyTimeMinutes / 60)}
                  <span style={{ fontSize: '1rem' }}>時間</span>
                  {studyStats.totalStudyTimeMinutes % 60}
                  <span style={{ fontSize: '1rem' }}>分</span>
                </div>
              </div>
              <div style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                borderRadius: 12,
                padding: 16,
                color: 'white'
              }}>
                <div style={{ fontSize: '0.85rem', marginBottom: 8, opacity: 0.9 }}>連続学習日数</div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                  {studyStats.consecutiveDays}
                  <span style={{ fontSize: '1rem' }}>日</span>
                </div>
              </div>
              <div style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                borderRadius: 12,
                padding: 16,
                color: 'white'
              }}>
                <div style={{ fontSize: '0.85rem', marginBottom: 8, opacity: 0.9 }}>今週の学習時間</div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                  {Math.floor(studyStats.thisWeek.totalMinutes / 60)}
                  <span style={{ fontSize: '1rem' }}>時間</span>
                  {studyStats.thisWeek.totalMinutes % 60}
                  <span style={{ fontSize: '1rem' }}>分</span>
                </div>
              </div>
            </div>

            {/* Part別統計 */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{
                fontSize: '1.1rem',
                fontWeight: 600,
                marginBottom: 16,
                color: '#374151'
              }}>📚 Part別学習状況</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {studyStats.byPart.map((part) => (
                  <div key={part.partNumber} style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: 12
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 8
                    }}>
                      <span style={{ fontWeight: 600, color: '#374151' }}>Part {part.partNumber}</span>
                      <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem', color: '#6b7280' }}>
                        <span>
                          {Math.floor(part.totalMinutes / 60)}時間{part.totalMinutes % 60}分
                        </span>
                        <span>{part.sessions}セッション</span>
                        {part.averageAccuracy !== undefined && (
                          <span style={{ color: '#10b981', fontWeight: 600 }}>
                            正答率 {Math.round(part.averageAccuracy * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{
                      background: '#f3f4f6',
                      height: 8,
                      borderRadius: 4,
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                        height: '100%',
                        width: `${Math.min(100, (part.totalMinutes / studyStats.totalStudyTimeMinutes) * 100)}%`,
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* コンテンツタイプ別統計 */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{
                fontSize: '1.1rem',
                fontWeight: 600,
                marginBottom: 16,
                color: '#374151'
              }}>🎯 学習コンテンツ別</h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12
              }}>
                {studyStats.byContentType.map((content) => {
                  const labels: Record<string, string> = {
                    basics: '基礎講義',
                    dictation: 'ディクテーション',
                    shadowing: 'シャドーイング',
                    practice: '実戦問題',
                    vocabulary: '単語学習',
                    mock_test: '模試'
                  };
                  return (
                    <div key={content.contentType} style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      padding: 12,
                      textAlign: 'center'
                    }}>
                      <div style={{
                        fontSize: '0.85rem',
                        color: '#6b7280',
                        marginBottom: 4
                      }}>
                        {labels[content.contentType] || content.contentType}
                      </div>
                      <div style={{
                        fontSize: '1.3rem',
                        fontWeight: 'bold',
                        color: '#374151'
                      }}>
                        {Math.floor(content.totalMinutes / 60)}:{String(content.totalMinutes % 60).padStart(2, '0')}
                      </div>
                      <div style={{
                        fontSize: '0.75rem',
                        color: '#9ca3af'
                      }}>
                        {content.sessions}回
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 今週の日別グラフ */}
            <div>
              <h3 style={{
                fontSize: '1.1rem',
                fontWeight: 600,
                marginBottom: 16,
                color: '#374151'
              }}>📅 今週の学習記録</h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: 8
              }}>
                {studyStats.thisWeek.byDay.map((day) => {
                  const date = new Date(day.date);
                  const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
                  const maxMinutes = Math.max(...studyStats.thisWeek.byDay.map(d => d.minutes));
                  const height = maxMinutes > 0 ? (day.minutes / maxMinutes) * 100 : 0;
                  
                  return (
                    <div key={day.date} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center'
                    }}>
                      <div style={{
                        fontSize: '0.75rem',
                        color: '#6b7280',
                        marginBottom: 4
                      }}>
                        {dayOfWeek}
                      </div>
                      <div style={{
                        width: '100%',
                        height: 100,
                        background: '#f3f4f6',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'flex-end',
                        position: 'relative'
                      }}>
                        <div style={{
                          width: '100%',
                          height: `${height}%`,
                          background: 'linear-gradient(180deg, #10b981 0%, #059669 100%)',
                          borderRadius: 4,
                          transition: 'height 0.3s ease'
                        }} />
                      </div>
                      <div style={{
                        fontSize: '0.7rem',
                        color: '#374151',
                        marginTop: 4,
                        fontWeight: 600
                      }}>
                        {day.minutes}分
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {showStudyDashboard && studyStats && studyStats.totalStudyTimeMinutes === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#9ca3af',
            padding: 40,
            fontSize: '0.9rem'
          }}>
            まだ学習記録がありません
          </div>
        )}
      </div>

      {/* 会話履歴とメモリーエリア - 横並び7:3の比率 */}
      <div style={{ 
        display: 'grid',
        gridTemplateColumns: '7fr 3fr',
        gap: 20,
        marginBottom: 24
      }}>
        {/* 会話履歴エリア（左側 70%） */}
        <div style={{ 
          background: 'white',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ 
            marginTop: 0,
            marginBottom: 16,
            fontSize: '1.25rem',
            fontWeight: 600,
            color: '#1f2937',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            💬 会話履歴
          </h3>
          <div 
            ref={chatAreaRef}
            style={{
              background: '#f9fafb',
              borderRadius: 12,
              padding: 16,
              maxHeight: 400, // 固定高さから最大高さに変更
              overflowY: 'auto',
              border: '1px solid #e5e7eb'
            }}>
            {history.length === 0 ? (
              <div style={{ 
                color: '#9ca3af',
                textAlign: 'center',
                padding: '80px 40px',
                fontSize: '1rem'
              }}>
                <div style={{ fontSize: '3rem', marginBottom: 16 }}>💭</div>
                まだ会話がありません
              </div>
            ) : (
              <>
                {/* 古い会話を読み取るボタン */}
                {!showAllHistory && history.length > 10 && (
                  <div style={{ 
                    textAlign: 'center', 
                    marginBottom: 16 
                  }}>
                    <button
                      onClick={() => setShowAllHistory(true)}
                      style={{
                        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                        color: 'white',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                      onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                    >
                      📜 前の会話を読み取る ({history.length - 10}件)
                    </button>
                  </div>
                )}
                
                {/* 表示する会話履歴 */}
                {(showAllHistory ? history : history.slice(-10)).map((entry, idx) => {
                  // エントリーに対応する思考ログを検索
                  // タイムスタンプを基に最も近い思考ログを探す
                  let matchingLogId: string | null = null;
                  let matchingLog: ThinkingLog | null = null;
                  
                  if (entry.role === 'coach' && entry.ts) {
                    const entryTime = new Date(entry.ts).getTime();
                    let bestMatch: { id: string; log: ThinkingLog; timeDiff: number } | null = null;
                    
                    thinkingLogs.forEach((log, logId) => {
                      if (log.threadId === threadId) {
                        const logTime = new Date(log.startTime).getTime();
                        const timeDiff = Math.abs(entryTime - logTime);
                        
                        // 5分以内の差であれば候補とする
                        if (timeDiff <= 5 * 60 * 1000) {
                          if (!bestMatch || timeDiff < bestMatch.timeDiff) {
                            bestMatch = { id: logId, log, timeDiff };
                          }
                        }
                      }
                    });
                    
                    if (bestMatch) {
                      matchingLogId = bestMatch.id;
                      matchingLog = bestMatch.log;
                    }
                  }
                  
                  const hasThinkingLog = matchingLogId !== null;
                  
                  return (
                    <div 
                      key={idx} 
                      style={{ 
                        marginBottom: 16,
                        display: 'flex',
                        justifyContent: entry.role === 'student' ? 'flex-start' : 'flex-end'
                      }}
                    >
                      <div style={{ 
                        maxWidth: '70%',
                        background: entry.role === 'student'
                          ? 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)'
                          : 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)',
                        padding: 16,
                        borderRadius: 12,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        position: 'relative'
                      }}>
                        <div style={{ 
                          fontWeight: 600,
                          color: entry.role === 'student' ? '#4338ca' : '#059669',
                          marginBottom: 8,
                          fontSize: '0.875rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}>
                          {entry.role === 'student' ? '👤 生徒' : '🎓 コーチ'}
                          {entry.ts && (
                            <span style={{ 
                              fontWeight: 400,
                              fontSize: '0.75rem',
                              color: '#6b7280',
                              marginLeft: 'auto'
                            }}>
                              {new Date(entry.ts).toLocaleString('ja-JP')}
                            </span>
                          )}
                          {/* 思考ログアイコン（コーチのメッセージかつMastraエンジンの場合のみ） */}
                          {entry.role === 'coach' && engine === 'mastra' && hasThinkingLog && matchingLogId && (
                            <button
                              onClick={() => setShowThinkingPopup(matchingLogId)}
                              style={{
                                background: 'rgba(255,255,255,0.8)',
                                border: '1px solid rgba(0,0,0,0.1)',
                                borderRadius: 4,
                                padding: '2px 4px',
                                fontSize: '0.7rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2
                              }}
                              title={`思考ログを表示 (${matchingLog?.steps.length || 0} ステップ)`}
                            >
                              🧠
                            </button>
                          )}
                        </div>
                        <div style={{ 
                          whiteSpace: 'pre-wrap',
                          color: '#1f2937',
                          lineHeight: 1.6
                        }}>
                        {entry.text}
                        </div>
                        {/* 計画/評価メタ（Mastra + Debug時に取得可能） */}
                        {(() => {
                          if (!showPlanEval || engine !== 'mastra' || !debug) return null;
                          if (!entry.ts) return null;
                          const key = String(entry.ts);
                          const meta = replyMeta.get(key);
                          if (!meta || entry.role !== 'coach') return null; // 返信側のみ
                          const plan = (() => { try { return meta.plan ? JSON.parse(meta.plan) : null; } catch { return null; } })();
                          const evalRes = meta.eval || null;
                          const expanded = expandedMeta.has(key);
                          return (
                            <div style={{ marginTop: 8 }}>
                              <button
                                onClick={() => toggleMetaExpand(key)}
                                style={{
                                  background: '#ecfeff', color: '#0e7490', border: '1px solid #06b6d4',
                                  borderRadius: 8, padding: '6px 10px', fontSize: '0.8rem', cursor: 'pointer'
                                }}
                              >
                                {expanded ? '🔽 閉じる: 計画と評価' : '🔼 開く: 計画と評価'}
                              </button>
                              {expanded && (
                                <div style={{ marginTop: 8, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                                  {plan && (
                                    <div style={{ marginBottom: 10 }}>
                                      <div style={{ fontWeight: 600, marginBottom: 6 }}>🧭 計画概要</div>
                                      <div style={{ fontSize: '0.9rem', color: '#374151' }}>
                                        <div><strong>目的:</strong> {plan.goal || '(不明)'}</div>
                                        <div><strong>時間:</strong> {typeof plan.timeBudgetMin === 'number' ? `${plan.timeBudgetMin}分` : '-'}</div>
                                        <div><strong>ステップ:</strong> {Array.isArray(plan.steps) ? plan.steps.slice(0,3).map((s:any)=>s.title).join(' / ') : '-'}</div>
                                      </div>
                                    </div>
                                  )}
                                  {evalRes && (
                                    <div>
                                      <div style={{ fontWeight: 600, marginBottom: 6 }}>✅ 自己診断</div>
                                      <div style={{ fontSize: '0.9rem', color: '#374151' }}>
                                        <div><strong>総合:</strong> {Math.round((evalRes.overall ?? 0) * 100)}% {evalRes.pass ? '（合格）' : '（要改善）'}</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 6 }}>
                                          <div>関連: {Math.round((evalRes.scores?.relevance ?? 0)*100)}%</div>
                                          <div>有用: {Math.round((evalRes.scores?.helpfulness ?? 0)*100)}%</div>
                                          <div>文体: {Math.round((evalRes.scores?.style ?? 0)*100)}%</div>
                                          <div>忠実: {Math.round((evalRes.scores?.faithfulness ?? 0)*100)}%</div>
                                        </div>
                                        {Array.isArray(evalRes.issues) && evalRes.issues.length > 0 && (
                                          <div style={{ marginTop: 6 }}>
                                            <div style={{ fontWeight: 600 }}>課題</div>
                                            <ul style={{ margin: '4px 0 0 18px' }}>
                                              {evalRes.issues.slice(0,3).map((i:string, j:number)=>(<li key={j}>{i}</li>))}
                                            </ul>
                                          </div>
                                        )}
                                        {Array.isArray(evalRes.suggestions) && evalRes.suggestions.length > 0 && (
                                          <div style={{ marginTop: 6 }}>
                                            <div style={{ fontWeight: 600 }}>改善提案</div>
                                            <ul style={{ margin: '4px 0 0 18px' }}>
                                              {evalRes.suggestions.slice(0,3).map((s:string, j:number)=>(<li key={j}>{s}</li>))}
                                            </ul>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        
                        {/* Step 5: 構造化データ表示 */}
                        {(() => {
                          const messageId = `${entry.ts}-${idx}`;
                          const analysisData = structuredData.get(messageId);
                          if (analysisData) {
                            return renderStructuredAnalysis(analysisData, messageId);
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  );
                })}
                
                {/* タスク進行状況パネル - 思考ログの上にコンパクトに表示 */}
                {currentPlan && (streaming || completedTasks.size > 0) && (
                  <div style={{
                    marginBottom: 12,
                    display: 'flex',
                    justifyContent: 'flex-end'
                  }}>
                    <div style={{
                      maxWidth: '70%',
                      background: 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)',
                      padding: 12,
                      borderRadius: 8,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                      border: '1px solid #a5b4fc'
                    }}>
                      <div style={{
                        fontWeight: 600,
                        color: '#312e81',
                        marginBottom: 6,
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        📋 実行ステップ
                        <span style={{
                          fontSize: '0.65rem',
                          color: '#6b7280',
                          marginLeft: 'auto'
                        }}>
                          ({currentPlan.steps?.filter((s: any) => completedTasks.has(s.id)).length || 0}/{currentPlan.steps?.length || 0})
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {currentPlan.steps?.map((step: any, index: number) => {
                          const isCompleted = completedTasks.has(step.id);
                          // アクティブなステップは、完了したステップの次
                          const completedCount = currentPlan.steps.slice(0, index).filter((s: any) => completedTasks.has(s.id)).length;
                          const isActive = completedCount === index && !isCompleted;
                          
                          return (
                            <div 
                              key={step.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '3px 6px',
                                background: isActive ? '#fef3c7' : 'transparent',
                                borderRadius: 4,
                                fontSize: '0.7rem',
                                color: isCompleted ? '#9ca3af' : '#4b5563',
                                textDecoration: isCompleted ? 'line-through' : 'none'
                              }}
                            >
                              <div style={{
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                border: '1.5px solid #6366f1',
                                background: isCompleted ? '#6366f1' : 'transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.5rem',
                                color: isCompleted ? 'white' : '#6366f1',
                                flexShrink: 0
                              }}>
                                {isCompleted ? '✓' : isActive ? '●' : ''}
                              </div>
                              <div style={{ flex: 1 }}>
                                {step.title}
                              </div>
                              {isActive && (
                                <div style={{
                                  width: 6,
                                  height: 6,
                                  background: '#f59e0b',
                                  borderRadius: '50%',
                                  animation: 'pulse 1.5s infinite',
                                  flexShrink: 0
                                }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* リアルタイム思考状況表示 - ローディング中または最近完了した思考ログを表示 */}
                {(() => {
                  console.log('🧠 Thinking display check:', {
                    currentThinking: !!currentThinking,
                    loadingPrompts,
                    engine,
                    isMastra: engine === 'mastra',
                    shouldShow: (currentThinking || loadingPrompts) && (engine === 'mastra'),
                    currentThinkingSteps: currentThinking?.steps?.length || 0
                  });
                  return (currentThinking || loadingPrompts) && (engine === 'mastra');
                })() && (
                  <div style={{
                    marginBottom: 16,
                    display: 'flex',
                    justifyContent: 'flex-end'
                  }}>
                    <div style={{
                      maxWidth: '70%',
                      background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                      padding: 16,
                      borderRadius: 12,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      border: '2px dashed #f59e0b'
                    }}>
                      <div style={{
                        fontWeight: 600,
                        color: '#92400e',
                        marginBottom: 8,
                        fontSize: '0.875rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        {loading ? '🤔 コーチ (思考中...)' : loadingPrompts ? '💭 声掛けメッセージ生成中...' : '🧠 コーチ (思考完了)'}
                        {(loading || loadingPrompts) && (
                          <div style={{
                            width: 16,
                            height: 16,
                            border: '2px solid #f59e0b',
                            borderTop: '2px solid transparent',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                          }} />
                        )}
                      </div>
                      <div style={{
                        color: '#78350f',
                        fontSize: '0.8rem',
                        fontStyle: 'italic'
                      }}>
                        {(() => {
                          console.log('🎯 Current thinking steps:', currentThinking?.steps);
                          if (currentThinking?.steps?.length > 0) {
                            const lastStep = currentThinking.steps[currentThinking.steps.length - 1];
                            return `${lastStep.step}: ${lastStep.content}`;
                          }
                          return loadingPrompts
                            ? '声掛けメッセージを生成中...'
                            : '思考を開始しています...';
                        })()}
                      </div>
                      <div style={{
                        marginTop: 4,
                        fontSize: '0.7rem',
                        color: '#a16207'
                      }}>
                        {loadingPrompts
                          ? `処理中... (${currentThinking?.steps?.length || 0} ステップ)`
                          : loading
                            ? `処理中... (${currentThinking?.steps?.length || 0} ステップ完了)`
                            : `思考完了 (${currentThinking?.steps?.length || 0} ステップ)`
                        }
                      </div>
                    </div>
                  </div>
                )}

                {/* ストリーミングテキスト表示 */}
                {streaming && streamingText && streamingRole && (
                  <div style={{
                    marginBottom: 16,
                    display: 'flex',
                    justifyContent: streamingRole === 'student' ? 'flex-start' : 'flex-end'
                  }}>
                    <div style={{
                      maxWidth: '70%',
                      background: streamingRole === 'student' 
                        ? 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)'
                        : 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                      padding: 16,
                      borderRadius: 12,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      border: streamingRole === 'student' 
                        ? '2px dashed #3b82f6' 
                        : '2px dashed #10b981',
                      position: 'relative'
                    }}>
                      <div style={{
                        fontWeight: 600,
                        color: streamingRole === 'student' ? '#1e40af' : '#047857',
                        marginBottom: 8,
                        fontSize: '0.875rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        {streamingRole === 'student' ? '👤 生徒' : '👩‍🏫 コーチ'} (リアルタイム生成中...)
                        <div style={{
                          width: 16,
                          height: 16,
                          border: `2px solid ${streamingRole === 'student' ? '#3b82f6' : '#10b981'}`,
                          borderTop: '2px solid transparent',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                      </div>
                      <div style={{
                        color: streamingRole === 'student' ? '#1e3a8a' : '#064e3b',
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap'
                      }}>
                        {streamingText}
                        <span style={{
                          display: 'inline-block',
                          width: 2,
                          height: 16,
                          backgroundColor: streamingRole === 'student' ? '#3b82f6' : '#10b981',
                          marginLeft: 2,
                          animation: 'blink 1s infinite'
                        }} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          
          {/* 計画・評価パネル（ストリーミング中または完了後に表示） */}
          {lastEvaluation && (streaming || showPlanEval) && debug && (
            <div style={{
              marginTop: 16,
              padding: 16,
              background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
              borderRadius: 12,
              color: 'white',
              boxShadow: '0 4px 12px rgba(251, 191, 36, 0.3)'
            }}>
              <h4 style={{
                fontSize: '1rem',
                fontWeight: 600,
                marginBottom: 12,
                marginTop: 0
              }}>
                📊 AI自己診断レポート
              </h4>
              
              {/* 計画セクション */}
              {lastEvaluation.plan && (
                <div style={{
                  marginBottom: 12,
                  padding: 12,
                  background: 'rgba(255, 255, 255, 0.2)',
                  borderRadius: 8
                }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 8 }}>
                    🧭 実行計画
                  </div>
                  <div style={{ fontSize: '0.85rem' }}>
                    <div>目標: {lastEvaluation.plan.goal}</div>
                    <div>ステップ数: {lastEvaluation.plan.steps?.length || 0}</div>
                    <div>予想時間: {lastEvaluation.plan.timeBudgetMin}分</div>
                  </div>
                </div>
              )}
              
              {/* 評価セクション */}
              {lastEvaluation.overall !== undefined && (
                <div style={{
                  padding: 12,
                  background: 'rgba(255, 255, 255, 0.2)',
                  borderRadius: 8
                }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 8 }}>
                    ✅ 品質評価
                  </div>
                  <div style={{ fontSize: '0.85rem' }}>
                    <div style={{
                      fontSize: '1.2rem',
                      fontWeight: 700,
                      marginBottom: 8,
                      color: lastEvaluation.overall >= 0.9 ? '#10b981' : 
                             lastEvaluation.overall >= 0.75 ? '#fbbf24' : '#ef4444'
                    }}>
                      総合スコア: {Math.round(lastEvaluation.overall * 100)}/100点
                      {lastEvaluation.pass ? ' ✅ 合格' : ' 🔄 要改善'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      <div>関連性: {Math.round((lastEvaluation.scores?.relevance || 0) * 100)}%</div>
                      <div>有用性: {Math.round((lastEvaluation.scores?.helpfulness || 0) * 100)}%</div>
                      <div>文体: {Math.round((lastEvaluation.scores?.style || 0) * 100)}%</div>
                      <div>忠実性: {Math.round((lastEvaluation.scores?.faithfulness || 0) * 100)}%</div>
                    </div>
                    {lastEvaluation.issues && lastEvaluation.issues.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600 }}>⚠️ 検出された課題:</div>
                        <ul style={{ margin: '4px 0 0 16px', fontSize: '0.8rem' }}>
                          {lastEvaluation.issues.map((issue: string, i: number) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {lastEvaluation.suggestions && lastEvaluation.suggestions.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600 }}>💡 改善提案:</div>
                        <ul style={{ margin: '4px 0 0 16px', fontSize: '0.8rem' }}>
                          {lastEvaluation.suggestions.map((suggestion: string, i: number) => (
                            <li key={i}>{suggestion}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* メモリー表示（右側 30%） */}
        <div style={{
          background: 'white',
          borderRadius: 16,
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
            padding: '16px 20px',
            color: 'white',
            fontWeight: 600,
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span style={{ fontSize: '0.95rem' }}>🧠 コーチの記憶</span>
            <button
              onClick={() => {
                if (!showMemories) {
                  fetchMemories(studentId);
                }
                setShowMemories(!showMemories);
              }}
              style={{
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
                padding: '4px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '0.75rem'
              }}
            >
              {showMemories ? '隠す' : '表示'}
            </button>
          </div>
          {showMemories && (
            <div style={{ 
              padding: 16, 
              maxHeight: '50vh', // 画面の50%を上限に設定
              overflowY: 'auto' 
            }}>
              {memoryStats && (
                <div style={{
                  marginBottom: 12,
                  padding: 8,
                  background: '#f3f4f6',
                  borderRadius: 6
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: '0.8rem' }}>📊 統計</div>
                  <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>
                    総数: {memoryStats.total} | 
                    期限切れ: {memoryStats.expired}
                  </div>
                </div>
              )}
              {memories.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {memories.map((memory) => {
                    const typeColors = {
                      learning_progress: '#10b981',
                      learning_challenge: '#ef4444',
                      commitment: '#f59e0b',
                      emotional_state: '#3b82f6',
                      milestone: '#8b5cf6'
                    };
                    const typeLabels = {
                      learning_progress: '学習進捗',
                      learning_challenge: '学習課題',
                      commitment: '約束事',
                      emotional_state: '感情状態',
                      milestone: 'マイルストーン'
                    };
                    return (
                      <div
                        key={memory.id}
                        style={{
                          border: `1px solid ${typeColors[memory.type]}30`,
                          borderRadius: 6,
                          padding: 8,
                          background: 'white'
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 4
                        }}>
                          <span style={{
                            background: typeColors[memory.type],
                            color: 'white',
                            padding: '1px 6px',
                            borderRadius: 3,
                            fontSize: '0.65rem',
                            fontWeight: 600
                          }}>
                            {typeLabels[memory.type]}
                          </span>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8
                          }}>
                            <span style={{
                              fontSize: '0.65rem',
                              color: '#9ca3af'
                            }}>
                              {Math.round(memory.relevance * 100)}%
                            </span>
                            <button
                              onClick={() => deleteMemoryItem(memory.id)}
                              style={{
                                padding: '2px 6px',
                                fontSize: '0.65rem',
                                background: '#ef4444',
                                color: 'white',
                                border: 'none',
                                borderRadius: 3,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                              }}
                              onMouseOver={(e) => {
                                e.currentTarget.style.background = '#dc2626';
                              }}
                              onMouseOut={(e) => {
                                e.currentTarget.style.background = '#ef4444';
                              }}
                            >
                              削除
                            </button>
                          </div>
                        </div>
                        <div style={{
                          fontSize: '0.75rem',
                          color: '#374151',
                          marginBottom: 4,
                          lineHeight: 1.4
                        }}>
                          {memory.content.description || 
                           memory.content.task || 
                           memory.content.achievement || 
                           memory.content.originalMessage ||
                           '(内容なし)'}
                        </div>
                        <div style={{
                          fontSize: '0.65rem',
                          color: '#9ca3af'
                        }}>
                          {new Date(memory.timestamp).toLocaleString('ja-JP')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{
                  textAlign: 'center',
                  color: '#9ca3af',
                  padding: 20,
                  fontSize: '0.8rem'
                }}>
                  まだ記憶がありません
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div style={{ 
          background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
          color: '#dc2626',
          padding: 16,
          borderRadius: 12,
          marginBottom: 24,
          border: '2px solid #ef4444',
          boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          <span style={{ fontSize: '1.5rem' }}>⚠️</span>
          <div>
            <strong>エラー:</strong> {error}
          </div>
        </div>
      )}

      {/* 入力エリア */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 生徒の入力 */}
        <div style={{
          background: 'white',
          borderRadius: 16,
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            padding: '16px 20px',
            color: 'white',
            fontWeight: 600,
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            👤 生徒として発言
          </div>
          <form onSubmit={handleStudentSubmit} style={{ padding: 20 }}>
            <textarea
              value={studentMessage}
              onChange={(e) => setStudentMessage(e.target.value)}
              placeholder="生徒からのメッセージを入力..."
              rows={4}
              style={{ 
                width: '100%',
                padding: 12,
                borderRadius: 8,
                border: '2px solid #e5e7eb',
                fontSize: '1rem',
                resize: 'vertical',
                outline: 'none',
                transition: 'all 0.2s',
                fontFamily: 'inherit'
              }}
              disabled={loading}
            />
            <button 
              type="submit"
              disabled={!studentMessage.trim() || loading}
              style={{ 
                marginTop: 12,
                width: '100%',
                padding: '12px 24px',
                background: studentMessage.trim() && !loading 
                  ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
                  : '#e5e7eb',
                color: studentMessage.trim() && !loading ? 'white' : '#9ca3af',
                border: 'none',
                borderRadius: 8,
                fontSize: '1rem',
                fontWeight: 600,
                cursor: studentMessage.trim() && !loading ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s'
              }}
            >
              {loading ? '🔄 送信中...' : '📤 生徒として送信'}
            </button>
          </form>
        </div>

        {/* コーチの入力 */}
        <div style={{
          background: 'white',
          borderRadius: 16,
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            padding: '16px 20px',
            color: 'white',
            fontWeight: 600,
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>🎓 コーチとして発言</span>
            <button
              type="button"
              onClick={handleCoachPrompt}
              disabled={loadingPrompts || loading}
              style={{
                padding: '8px 16px',
                fontSize: '0.9rem',
                border: 'none',
                borderRadius: 6,
                backgroundColor: loadingPrompts ? '#ccc' : 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                fontWeight: 600,
                cursor: loadingPrompts || loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                backdropFilter: 'blur(10px)'
              }}
            >
              {loadingPrompts ? '🔄 生成中...' : '💬 声掛け'}
            </button>
          </div>
          <form onSubmit={handleCoachSubmit} style={{ padding: 20 }}>
            <textarea
              value={coachMessage}
              onChange={(e) => setCoachMessage(e.target.value)}
              placeholder="コーチからのメッセージを入力..."
              rows={4}
              style={{ 
                width: '100%',
                padding: 12,
                borderRadius: 8,
                border: '2px solid #e5e7eb',
                fontSize: '1rem',
                resize: 'vertical',
                outline: 'none',
                transition: 'all 0.2s',
                fontFamily: 'inherit'
              }}
              disabled={loading}
            />
            <button 
              type="submit"
              disabled={!coachMessage.trim() || loading}
              style={{ 
                marginTop: 12,
                width: '100%',
                padding: '12px 24px',
                background: coachMessage.trim() && !loading 
                  ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                  : '#e5e7eb',
                color: coachMessage.trim() && !loading ? 'white' : '#9ca3af',
                border: 'none',
                borderRadius: 8,
                fontSize: '1rem',
                fontWeight: 600,
                cursor: coachMessage.trim() && !loading ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s'
              }}
            >
              {loading ? '🔄 送信中...' : '📤 コーチとして送信'}
            </button>
          </form>
        </div>

        {/* コーチ声掛けメッセージ選択モーダル */}
        {showPromptSelector && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: 16,
              padding: 30,
              maxWidth: 800,
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: 0, color: '#2c3e50' }}>
                  💬 コーチから声掛けメッセージを選択
                </h2>
                {coachPrompts.length > 0 && coachPrompts[0].thinkingLogId && (
                  <button
                    onClick={async () => {
                      const thinkingLogId = coachPrompts[0].thinkingLogId;
                      if (thinkingLogId) {
                        // 思考ログを取得してから表示
                        await fetchThinkingLog(thinkingLogId);
                        setShowThinkingPopup(thinkingLogId);
                      }
                    }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid #e0e0e0',
                      backgroundColor: '#f8f9fa',
                      color: '#495057',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    🧠 思考ログを見る
                  </button>
                )}
              </div>

              <div style={{ marginBottom: 30 }}>
                {coachPrompts.map((prompt, index) => (
                  <div key={prompt.id} style={{
                    marginBottom: 20,
                    padding: 20,
                    borderRadius: 12,
                    border: selectedPromptIndex === index ? '2px solid #4a90e2' : '1px solid #e0e0e0',
                    backgroundColor: selectedPromptIndex === index ? '#f0f8ff' : '#fafafa',
                    transition: 'all 0.2s'
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 10
                    }}>
                      <div style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        backgroundColor: '#e8f4fd',
                        color: '#2c3e50',
                        fontSize: '0.9rem',
                        fontWeight: 500
                      }}>
                        {prompt.type === 'daily_suggestion' && '📚 学習提案'}
                        {prompt.type === 'progress_review' && '📊 進捗確認'}
                        {prompt.type === 'motivation_boost' && '💪 モチベーション'}
                      </div>
                      <div style={{
                        display: 'flex',
                        gap: 10
                      }}>
                        <button
                          onClick={() => handleSelectPrompt(index)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: 'none',
                            backgroundColor: selectedPromptIndex === index ? '#4a90e2' : '#6c757d',
                            color: 'white',
                            cursor: 'pointer',
                            fontSize: '0.9rem'
                          }}
                        >
                          {selectedPromptIndex === index ? '✅ 選択中' : '選択'}
                        </button>
                      </div>
                    </div>

                    <p style={{
                      margin: 0,
                      lineHeight: 1.6,
                      color: '#2c3e50'
                    }}>
                      {prompt.message}
                    </p>

                    <div style={{
                      marginTop: 10,
                      fontSize: '0.85rem',
                      color: '#6c757d'
                    }}>
                      理由: {prompt.reasoning}
                    </div>
                  </div>
                ))}
              </div>

              {selectedPromptIndex !== null && (
                <div style={{
                  marginBottom: 20,
                  padding: 20,
                  borderRadius: 12,
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #e0e0e0'
                }}>
                  <h3 style={{ marginBottom: 10, color: '#2c3e50' }}>
                    ✏️ メッセージを編集
                  </h3>
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    rows={4}
                    style={{
                      width: '100%',
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid #ddd',
                      fontSize: '1rem',
                      resize: 'vertical'
                    }}
                  />
                </div>
              )}

              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10
              }}>
                <button
                  onClick={() => {
                    setShowPromptSelector(false);
                    setCoachPrompts([]);
                    setSelectedPromptIndex(null);
                    setEditedPrompt('');
                  }}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    border: '1px solid #ddd',
                    backgroundColor: 'white',
                    color: '#6c757d',
                    cursor: 'pointer',
                    fontSize: '1rem'
                  }}
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSendSelectedPrompt}
                  disabled={selectedPromptIndex === null || !editedPrompt.trim()}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: selectedPromptIndex !== null && editedPrompt.trim() ? '#28a745' : '#ccc',
                    color: 'white',
                    cursor: selectedPromptIndex !== null && editedPrompt.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '1rem',
                    fontWeight: 600
                  }}
                >
                  送信
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 思考ログポップアップモーダル */}
      {showThinkingPopup && thinkingLogs.has(showThinkingPopup) && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000
          }}
          onClick={() => setShowThinkingPopup(null)}
        >
          <div 
            style={{
              background: 'white',
              borderRadius: 16,
              padding: 24,
              maxWidth: 800,
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const thinkingLog = thinkingLogs.get(showThinkingPopup);
              if (!thinkingLog) return null;
              
              const statusColors = {
                thinking: '#f59e0b',
                completed: '#10b981',
                error: '#ef4444'
              };
              
              const levelColors = {
                info: '#3b82f6',
                debug: '#6b7280',
                warning: '#f59e0b',
                success: '#10b981',
                error: '#ef4444'
              };
              
              return (
                <>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 20,
                    borderBottom: '2px solid #e5e7eb',
                    paddingBottom: 16
                  }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '1.5rem',
                      color: '#1f2937',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }}>
                      🧠 思考ログ
                      <span style={{
                        fontSize: '0.8rem',
                        color: statusColors[thinkingLog.status],
                        background: `${statusColors[thinkingLog.status]}20`,
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontWeight: 600
                      }}>
                        {thinkingLog.status === 'thinking' ? '思考中' : 
                         thinkingLog.status === 'completed' ? '完了' : 'エラー'}
                      </span>
                    </h3>
                    <button
                      onClick={() => setShowThinkingPopup(null)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: '1.5rem',
                        cursor: 'pointer',
                        color: '#6b7280'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  
                  <div style={{ marginBottom: 16, fontSize: '0.875rem', color: '#6b7280' }}>
                    <div>開始時刻: {new Date(thinkingLog.startTime).toLocaleString('ja-JP')}</div>
                    {thinkingLog.endTime && (
                      <div>終了時刻: {new Date(thinkingLog.endTime).toLocaleString('ja-JP')}</div>
                    )}
                    <div>ステップ数: {thinkingLog.steps.length}</div>
                  </div>
                  
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}>
                    {thinkingLog.steps.map((step, index) => (
                      <div key={step.id} style={{
                        background: '#f9fafb',
                        borderLeft: `4px solid ${levelColors[step.level]}`,
                        padding: 12,
                        borderRadius: 8
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 8
                        }}>
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: levelColors[step.level],
                            background: `${levelColors[step.level]}20`,
                            padding: '2px 6px',
                            borderRadius: 4
                          }}>
                            #{index + 1} {step.level.toUpperCase()}
                          </span>
                          <span style={{
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            color: '#374151'
                          }}>
                            {step.step}
                          </span>
                          <span style={{
                            fontSize: '0.75rem',
                            color: '#9ca3af',
                            marginLeft: 'auto'
                          }}>
                            {new Date(step.timestamp).toLocaleTimeString('ja-JP')}
                          </span>
                        </div>
                        <div style={{
                          fontSize: '0.875rem',
                          color: '#4b5563',
                          whiteSpace: 'pre-wrap',
                          lineHeight: 1.5
                        }}>
                          {step.content}
                        </div>
                        {step.metadata && Object.keys(step.metadata).length > 0 && (
                          <details style={{ marginTop: 8 }}>
                            <summary style={{
                              fontSize: '0.75rem',
                              color: '#6b7280',
                              cursor: 'pointer'
                            }}>
                              詳細情報
                            </summary>
                            <pre style={{
                              fontSize: '0.75rem',
                              background: '#f3f4f6',
                              padding: 8,
                              borderRadius: 4,
                              marginTop: 4,
                              overflow: 'auto'
                            }}>
                              {JSON.stringify(step.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
    </>
  );
}
