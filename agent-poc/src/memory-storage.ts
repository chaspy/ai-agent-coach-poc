import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Memory, MemorySearchCriteria, MemoryType } from './memory-types';

const MEMORY_DIR = path.resolve(process.cwd(), 'data', 'memories');

// ディレクトリの初期化
export function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

// メモリーファイルのパス生成
function getMemoryFilePath(userId: string): string {
  return path.join(MEMORY_DIR, `${userId}.jsonl`);
}

// メモリーの保存
export function saveMemory(memory: Omit<Memory, 'id' | 'timestamp' | 'accessed'>): Memory {
  ensureMemoryDir();
  
  const fullMemory: Memory = {
    ...memory,
    id: uuidv4(),
    timestamp: new Date(),
    accessed: 0,
  };
  
  const filePath = getMemoryFilePath(memory.userId);
  const line = JSON.stringify(fullMemory) + '\n';
  
  fs.appendFileSync(filePath, line, 'utf-8');
  console.log(`[MemoryStorage] 💾 保存: type=${memory.type}, userId=${memory.userId}`);
  
  return fullMemory;
}

// 全メモリーの読み込み
export function loadMemories(userId: string): Memory[] {
  ensureMemoryDir();
  const filePath = getMemoryFilePath(userId);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  return lines.map(line => {
    try {
      const memory = JSON.parse(line);
      // Date型の復元
      memory.timestamp = new Date(memory.timestamp);
      if (memory.lastAccessed) {
        memory.lastAccessed = new Date(memory.lastAccessed);
      }
      if (memory.expiresAt) {
        memory.expiresAt = new Date(memory.expiresAt);
      }
      return memory;
    } catch (err) {
      console.error('[MemoryStorage] ❌ パースエラー:', err);
      return null;
    }
  }).filter(memory => memory !== null) as Memory[];
}

// メモリーの検索
export function searchMemories(criteria: MemorySearchCriteria): Memory[] {
  if (!criteria.userId) {
    throw new Error('userId is required for memory search');
  }
  
  let memories = loadMemories(criteria.userId);
  
  // タイプでフィルタリング
  if (criteria.type) {
    const types = Array.isArray(criteria.type) ? criteria.type : [criteria.type];
    memories = memories.filter(m => types.includes(m.type));
  }
  
  // タグでフィルタリング
  if (criteria.tags && criteria.tags.length > 0) {
    memories = memories.filter(m => 
      criteria.tags!.some(tag => m.tags.includes(tag))
    );
  }
  
  // 日付範囲でフィルタリング
  if (criteria.fromDate) {
    memories = memories.filter(m => m.timestamp >= criteria.fromDate!);
  }
  if (criteria.toDate) {
    memories = memories.filter(m => m.timestamp <= criteria.toDate!);
  }
  
  // 関連度でフィルタリング
  if (criteria.minRelevance !== undefined) {
    memories = memories.filter(m => m.relevance >= criteria.minRelevance!);
  }
  
  // 有効期限でフィルタリング
  if (criteria.notExpired) {
    const now = new Date();
    memories = memories.filter(m => {
      if (m.expired) return false;
      if (m.expiresAt && m.expiresAt < now) return false;
      return true;
    });
  }
  
  // 関連度でソート（降順）
  memories.sort((a, b) => b.relevance - a.relevance);
  
  // 件数制限
  if (criteria.limit) {
    memories = memories.slice(0, criteria.limit);
  }
  
  return memories;
}

// メモリーのアクセス記録更新
export function updateMemoryAccess(userId: string, memoryId: string): void {
  const memories = loadMemories(userId);
  const memoryIndex = memories.findIndex(m => m.id === memoryId);
  
  if (memoryIndex === -1) {
    console.warn(`[MemoryStorage] ⚠️ Memory not found: ${memoryId}`);
    return;
  }
  
  memories[memoryIndex].accessed++;
  memories[memoryIndex].lastAccessed = new Date();
  
  // 全メモリーを再保存（簡易実装）
  const filePath = getMemoryFilePath(userId);
  const content = memories.map(m => JSON.stringify(m)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
  
  console.log(`[MemoryStorage] 📊 アクセス更新: memoryId=${memoryId}, count=${memories[memoryIndex].accessed}`);
}

// メモリーの有効期限切れマーク
export function expireMemory(userId: string, memoryId: string): void {
  const memories = loadMemories(userId);
  const memoryIndex = memories.findIndex(m => m.id === memoryId);
  
  if (memoryIndex === -1) {
    console.warn(`[MemoryStorage] ⚠️ Memory not found: ${memoryId}`);
    return;
  }
  
  memories[memoryIndex].expired = true;
  
  // 全メモリーを再保存
  const filePath = getMemoryFilePath(userId);
  const content = memories.map(m => JSON.stringify(m)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
  
  console.log(`[MemoryStorage] 🗑️ 期限切れマーク: memoryId=${memoryId}`);
}

// メモリーの削除
export function deleteMemory(userId: string, memoryId: string): boolean {
  const memories = loadMemories(userId);
  const memoryIndex = memories.findIndex(m => m.id === memoryId);

  if (memoryIndex === -1) {
    console.warn(`[MemoryStorage] ⚠️ Memory not found for deletion: ${memoryId}`);
    return false;
  }

  // 該当メモリーを除外
  memories.splice(memoryIndex, 1);

  // 全メモリーを再保存
  const filePath = getMemoryFilePath(userId);
  if (memories.length > 0) {
    const content = memories.map(m => JSON.stringify(m)).join('\n') + '\n';
    fs.writeFileSync(filePath, content, 'utf-8');
  } else {
    // メモリーが空になった場合はファイルを削除
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  console.log(`[MemoryStorage] 🗑️ 削除完了: memoryId=${memoryId}`);
  return true;
}

// 古いメモリーのクリーンアップ（30日以上前の低関連度メモリー）
export function cleanupOldMemories(userId: string, daysOld: number = 30): number {
  const memories = loadMemories(userId);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const memoriesToKeep = memories.filter(m => {
    // 高関連度は保持
    if (m.relevance >= 0.7) return true;
    // 最近のメモリーは保持
    if (m.timestamp > cutoffDate) return true;
    // アクセス頻度が高いものは保持
    if (m.accessed >= 3) return true;
    // マイルストーンは保持
    if (m.type === 'milestone') return true;
    
    return false;
  });
  
  const deletedCount = memories.length - memoriesToKeep.length;
  
  if (deletedCount > 0) {
    const filePath = getMemoryFilePath(userId);
    const content = memoriesToKeep.map(m => JSON.stringify(m)).join('\n') + '\n';
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[MemoryStorage] 🧹 クリーンアップ: ${deletedCount}件削除`);
  }
  
  return deletedCount;
}

// 統計情報の取得
export function getMemoryStats(userId: string): {
  total: number;
  byType: Record<MemoryType, number>;
  expired: number;
  recentlyAccessed: number;
} {
  const memories = loadMemories(userId);
  const now = new Date();
  const recentThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7日前
  
  const stats = {
    total: memories.length,
    byType: {} as Record<MemoryType, number>,
    expired: 0,
    recentlyAccessed: 0,
  };
  
  memories.forEach(m => {
    // タイプ別カウント
    stats.byType[m.type] = (stats.byType[m.type] || 0) + 1;
    
    // 期限切れカウント
    if (m.expired || (m.expiresAt && m.expiresAt < now)) {
      stats.expired++;
    }
    
    // 最近アクセスされたカウント
    if (m.lastAccessed && m.lastAccessed > recentThreshold) {
      stats.recentlyAccessed++;
    }
  });
  
  return stats;
}