export type Role = 'student' | 'coach';

export interface Profile {
  id: string;
  role: Role;
  // 最低限の共通フィールド
  name?: string;
  tone?: any; // コーチ側はオブジェクト、学習者側は文字列など可変
  goals?: string[];
  level?: string;
  strengths?: string[];
  weaknesses?: string[];
  preferences?: {
    length?: 'short' | 'medium' | 'long';
    formality?: 'casual' | 'polite' | 'formal';
    emoji?: boolean;
    language?: string;
    // 追加（リッチコーチプロフィール互換）
    lesson_duration?: string;
    response_speed?: string;
    feedback_style?: string;
  };
  schedule?: string;
  notes?: string[];
  specialty?: string[];
  style?: Record<string, unknown>;
  guardrails?: string[];

  // コーチ向けリッチ構造（任意）
  gender?: string;
  age?: number;
  personality?: {
    type?: string;
    traits?: string[];
    communication_style?: string;
  };
  background?: {
    education?: string;
    experience?: string;
    certifications?: string[];
    specialties?: string[];
  };
  coaching_style?: {
    approach?: string;
    methods?: string[];
    session_structure?: Record<string, string>;
  };
  interaction_patterns?: {
    when_student_struggling?: string[];
    when_student_succeeding?: string[];
    when_student_unmotivated?: string[];
  };
  values?: string[];
  boundaries?: Record<string, string>;
}

export interface AskInput {
  threadId: string;
  role: Role;
  message: string;
  profileIds: { self: string; peer: string };
  topK?: number;
  debug?: boolean;
}
