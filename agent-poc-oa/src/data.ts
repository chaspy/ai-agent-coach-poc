import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');

export function ensureDataDirs() {
  const dirs = [path.join(DATA_DIR, 'profiles'), path.join(DATA_DIR, 'history')];
  for (const d of dirs) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

export function readProfile(id: string) {
  const p = path.join(DATA_DIR, 'profiles', `${id}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as any;
}

export function readRecentHistory(threadId: string, limit = 8) {
  const p = path.join(DATA_DIR, 'history', `${threadId}.jsonl`);
  if (!fs.existsSync(p)) return [] as any[];
  const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return { text: l }; } });
}

export function writeProfile(id: string, profile: any): void {
  const p = path.join(DATA_DIR, 'profiles', `${id}.json`);
  fs.writeFileSync(p, JSON.stringify(profile, null, 2), 'utf-8');
}

export function writeHistory(threadId: string, role: string, text: string): void {
  const p = path.join(DATA_DIR, 'history', `${threadId}.jsonl`);
  const entry = {
    role,
    ts: new Date().toISOString(),
    text
  };
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(p, line, 'utf-8');
}

