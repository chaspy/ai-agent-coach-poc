// 学習記録ストレージ（JSONL永続化実装）

import fs from 'fs';
import path from 'path';
import type {
  StudyRecord,
  StudyStats,
  StudyContentType,
  PartStats,
  ContentTypeStats,
  WeekStats,
} from './study-record-types';

const STUDY_RECORD_DIR = path.resolve(process.cwd(), 'data', 'study-records');

// ディレクトリの初期化
function ensureStudyRecordDir() {
  if (!fs.existsSync(STUDY_RECORD_DIR)) {
    fs.mkdirSync(STUDY_RECORD_DIR, { recursive: true });
  }
}

// 学習記録ファイルのパス生成
function getStudyRecordFilePath(userId: string): string {
  return path.join(STUDY_RECORD_DIR, `${userId}.jsonl`);
}

// 全学習記録の読み込み
function loadStudyRecords(userId: string): StudyRecord[] {
  ensureStudyRecordDir();
  const filePath = getStudyRecordFilePath(userId);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  return lines.map(line => {
    try {
      return JSON.parse(line) as StudyRecord;
    } catch (err) {
      console.error(`[StudyRecordStorage] Parse error:`, err);
      return null;
    }
  }).filter((r): r is StudyRecord => r !== null);
}

// 学習記録を保存
export function saveStudyRecord(record: Omit<StudyRecord, 'id'>): StudyRecord {
  ensureStudyRecordDir();
  
  const id = `study_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const fullRecord: StudyRecord = {
    ...record,
    id,
  };
  
  const filePath = getStudyRecordFilePath(record.userId);
  const line = JSON.stringify(fullRecord) + '\n';
  
  fs.appendFileSync(filePath, line, 'utf-8');
  console.log(`[StudyRecordStorage] 💾 学習記録を保存: ${fullRecord.contentType} (${fullRecord.durationMinutes}分)`);
  
  return fullRecord;
}

// 学習記録を取得
export function getStudyRecords(
  userId: string,
  options?: {
    fromDate?: string;
    toDate?: string;
    contentType?: StudyContentType;
    partNumber?: number;
    limit?: number;
  }
): StudyRecord[] {
  const records = loadStudyRecords(userId);
  
  let filtered = records.filter(r => {
    if (options?.fromDate && r.date < options.fromDate) return false;
    if (options?.toDate && r.date > options.toDate) return false;
    if (options?.contentType && r.contentType !== options.contentType) return false;
    if (options?.partNumber !== undefined && r.partNumber !== options.partNumber) return false;
    return true;
  });
  
  // 日付降順でソート（最新が先頭）
  filtered.sort((a, b) => b.date.localeCompare(a.date));
  
  if (options?.limit) {
    filtered = filtered.slice(0, options.limit);
  }
  
  return filtered;
}

// 学習統計を計算
export function calculateStudyStats(userId: string): StudyStats {
  const records = getStudyRecords(userId);
  
  // 累計学習時間
  const totalMinutes = records.reduce((sum, r) => sum + r.durationMinutes, 0);
  
  // 連続学習日数の計算
  const uniqueDates = [...new Set(records.map(r => r.date))].sort().reverse();
  let consecutiveDays = 0;
  const today = new Date().toISOString().split('T')[0];
  
  if (uniqueDates.length > 0) {
    const lastDate = uniqueDates[0];
    const daysSinceLastStudy = Math.floor(
      (new Date(today).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // 最終学習日が今日または昨日の場合のみ連続日数をカウント
    if (daysSinceLastStudy <= 1) {
      consecutiveDays = 1;
      for (let i = 1; i < uniqueDates.length; i++) {
        const prevDate = new Date(uniqueDates[i - 1]);
        const currDate = new Date(uniqueDates[i]);
        const dayDiff = Math.floor((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (dayDiff === 1) {
          consecutiveDays++;
        } else {
          break;
        }
      }
    }
  }
  
  // Part別統計
  const byPart: PartStats[] = [1, 2, 3, 4, 5, 6, 7].map(partNum => {
    const partRecords = records.filter(r => r.partNumber === partNum);
    const totalMinutes = partRecords.reduce((sum, r) => sum + r.durationMinutes, 0);
    
    // 正答率の計算
    const withAccuracy = partRecords.filter(r => 
      r.correctCount !== undefined && 
      r.questionCount !== undefined && 
      r.questionCount > 0
    );
    
    const averageAccuracy = withAccuracy.length > 0
      ? withAccuracy.reduce((sum, r) => sum + (r.correctCount! / r.questionCount!), 0) / withAccuracy.length
      : undefined;
    
    return {
      partNumber: partNum as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      totalMinutes,
      sessions: partRecords.length,
      averageAccuracy,
    };
  });
  
  // コンテンツタイプ別統計
  const contentTypes: StudyContentType[] = [
    'basics',
    'dictation',
    'shadowing',
    'practice',
    'vocabulary',
    'mock_test'
  ];
  
  const byContentType: ContentTypeStats[] = contentTypes.map(type => {
    const typeRecords = records.filter(r => r.contentType === type);
    return {
      contentType: type,
      totalMinutes: typeRecords.reduce((sum, r) => sum + r.durationMinutes, 0),
      sessions: typeRecords.length,
    };
  });
  
  // 今週の統計（月曜始まり）
  const getWeekStart = (date: Date): string => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 月曜日を週の始まりとする
    const weekStart = new Date(d.setDate(diff));
    return weekStart.toISOString().split('T')[0];
  };
  
  const weekStart = getWeekStart(new Date());
  const thisWeekRecords = records.filter(r => r.date >= weekStart);
  const thisWeekMinutes = thisWeekRecords.reduce((sum, r) => sum + r.durationMinutes, 0);
  
  // 今週の日別統計（月〜日の7日分）
  const byDay = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const dayRecords = thisWeekRecords.filter(r => r.date === dateStr);
    
    return {
      date: dateStr,
      minutes: dayRecords.reduce((sum, r) => sum + r.durationMinutes, 0),
    };
  });
  
  const thisWeek: WeekStats = {
    totalMinutes: thisWeekMinutes,
    sessions: thisWeekRecords.length,
    byDay,
  };
  
  return {
    userId,
    totalStudyTimeMinutes: totalMinutes,
    consecutiveDays,
    lastStudyDate: uniqueDates[0],
    byPart,
    byContentType,
    thisWeek,
  };
}

// 特定の学習記録を削除
export function deleteStudyRecord(userId: string, recordId: string): boolean {
  ensureStudyRecordDir();
  const records = loadStudyRecords(userId);
  const initialLength = records.length;
  const filtered = records.filter(r => r.id !== recordId);
  
  if (filtered.length < initialLength) {
    const filePath = getStudyRecordFilePath(userId);
    const content = filtered.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[StudyRecordStorage] 🗑️ 学習記録を削除: ${recordId}`);
    return true;
  }
  
  return false;
}

// 全ての学習記録を取得（デバッグ用）
export function getAllStudyRecords(): Record<string, StudyRecord[]> {
  ensureStudyRecordDir();
  const files = fs.readdirSync(STUDY_RECORD_DIR).filter(f => f.endsWith('.jsonl'));
  const result: Record<string, StudyRecord[]> = {};
  
  for (const file of files) {
    const userId = file.replace('.jsonl', '');
    result[userId] = loadStudyRecords(userId);
  }
  
  return result;
}