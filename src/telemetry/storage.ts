/**
 * src/telemetry/storage.ts
 * RunRecord 저장(localStorage)·콘솔 출력·JSON 다운로드. 브라우저 전용.
 */

import type { RunRecord } from './runTelemetry';

export const STORAGE_KEY = 'beatbreak.runs.v1';

export function loadRuns(): RunRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

function writeRuns(runs: RunRecord[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
    return true;
  } catch (e) {
    console.warn('[telemetry] localStorage 저장 실패', e);
    return false;
  }
}

/** 한 판 종료 시: 콘솔 출력 + localStorage 추가 */
export function saveRun(record: RunRecord): void {
  console.log('[telemetry] run end', record.outcome, record.cause ?? '', record.summary);
  console.log('[telemetry] run record JSON', JSON.stringify(record));
  writeRuns([...loadRuns(), record]);
}

/** 결과 화면에서 R로 재시작 → 해당 판의 restarted 갱신 (H4) */
export function markRestarted(runId: string): void {
  const runs = loadRuns();
  const run = runs.find((r) => r.runId === runId);
  if (!run) return;
  run.restarted = true;
  writeRuns(runs);
  console.log('[telemetry] restart', runId);
}

/** 저장된 전체 기록(방금 끝난 판 포함)을 JSON 파일로 내려받는다 */
export function downloadRunsJson(fallback: RunRecord): void {
  const runs = loadRuns();
  const data = runs.some((r) => r.runId === fallback.runId) ? runs : [...runs, fallback];
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `beatbreak-runs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
