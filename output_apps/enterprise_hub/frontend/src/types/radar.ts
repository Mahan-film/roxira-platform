/**
 * قراردادهای تایپ‌سیف پنل رادار فناوری و ازدحام ایجنت‌ها
 * (Contract-First Synchronization — Rule #4 AGENTS.md).
 */

export interface RadarSource {
  title?: string;
  url?: string;
  relevance_score?: number;
  crawl_engine?: string;
  excerpt?: string;
}

export interface EmergingTechnology {
  name?: string;
  category?: string;
  maturity?: string;
  description?: string;
  why_it_matters?: string;
  adoption_signal?: string;
}

export interface GithubRepository {
  name?: string;
  url?: string;
  stars?: string | number;
  language?: string;
  description?: string;
  why_relevant?: string;
}

export interface ProsConsItem {
  technology?: string;
  pros?: string[];
  cons?: string[];
  best_for?: string;
}

export interface SuggestedCommand {
  purpose?: string;
  command?: string;
}

export interface RadarEngineInfo {
  search?: string[];
  crawl?: string[];
  rerank?: string;
  synthesis_model?: string;
}

export interface RadarStructuredReport {
  topic?: string;
  mode?: string;
  generated_at?: string;
  elapsed_seconds?: number;
  status?: string;
  model?: string;
  confidence?: number;
  source_count?: number;
  engine?: RadarEngineInfo;
  providers?: Record<string, boolean>;
  queries?: string[];
  executive_summary?: string;
  key_findings?: string[];
  emerging_technologies?: EmergingTechnology[];
  top_github_repositories?: GithubRepository[];
  pros_cons?: ProsConsItem[];
  suggested_commands?: SuggestedCommand[];
  risks_and_caveats?: string[];
  recommendations?: string[];
  sources?: RadarSource[];
}

export interface RadarReportResponse {
  available: boolean;
  topic?: string;
  mode?: string;
  generatedAt?: string;
  confidence?: number;
  sourceCount?: number;
  model?: string;
  status?: string;
  markdown: string;
  structured: RadarStructuredReport;
}

export type RadarJobStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
export type RadarAgentState = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

export interface RadarScoutStatus {
  jobId?: string | null;
  status: RadarJobStatus;
  topic?: string | null;
  deep: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  error?: string | null;
  log: string[];
}

export interface RadarAgentStatus {
  id: string;
  label: string;
  task: string;
  status: RadarAgentState;
  elapsedSeconds?: number | null;
  stderr?: string;
}

export interface RadarSwarmSummary {
  total: number;
  running: number;
  success: number;
  failed: number;
  pending: number;
}

export interface RadarSwarmStatus {
  jobId?: string | null;
  status: RadarJobStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  agents: RadarAgentStatus[];
  summary: RadarSwarmSummary;
}

export interface TriggerScoutDto {
  topic: string;
  deep?: boolean;
}

export interface RunSwarmDto {
  timeoutSeconds?: number;
}
