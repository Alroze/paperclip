import { createHash } from "node:crypto";
import type { AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import { runAdapterExecutionTargetProcess } from "@paperclipai/adapter-utils/execution-target";

const VERSION_PROBE_TIMEOUT_SEC = 20;
const VERSION_CACHE_TTL_MS = 10 * 60 * 1000;
const versionCache = new Map<string, { major: number | null; expiresAt: number }>();

export function parseOpenCodeMajorVersion(output: string): number | null {
  const match = /(?:^|[^\d.])v?(\d+)\.(\d+)(?:\.\d+)?/m.exec(output.trim());
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

export function isOpenCodeV2(major: number | null): boolean {
  return major !== null && major >= 2;
}

export function openCodeGlobalArgs(major: number | null): string[] {
  return isOpenCodeV2(major) ? ["--standalone"] : [];
}

export function openCodeModelArg(model: string, variant: string, major: number | null): { model: string; variantArgs: string[] } {
  if (!variant) return { model, variantArgs: [] };
  if (!isOpenCodeV2(major)) return { model, variantArgs: ["--variant", variant] };
  if (!model || model.includes("#")) return { model, variantArgs: [] };
  return { model: `${model}#${variant}`, variantArgs: [] };
}

export function openCodeErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const rec = error as Record<string, unknown>;
  const data = typeof rec.data === "object" && rec.data !== null ? (rec.data as Record<string, unknown>) : {};
  for (const value of [data.statusCode, rec.status, rec.statusCode]) {
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return null;
}

function cacheKey(target: AdapterExecutionTarget | null | undefined, command: string, env: Record<string, string>): string {
  const targetKey = target ? JSON.stringify({ kind: target.kind, transport: (target as { transport?: unknown }).transport ?? null }) : "local";
  const envKey = ["PATH", "HOME"].map((key) => `${key}=${env[key] ?? ""}`).join("\n");
  return createHash("sha256").update(`${targetKey}\n${command}\n${envKey}`).digest("hex");
}

export function clearOpenCodeVersionCache(): void {
  versionCache.clear();
}

export async function detectOpenCodeMajorVersion(input: {
  runId: string;
  executionTarget: AdapterExecutionTarget | null | undefined;
  command: string;
  cwd: string;
  env: Record<string, string>;
  now?: number;
}): Promise<number | null> {
  const now = input.now ?? Date.now();
  const key = cacheKey(input.executionTarget, input.command, input.env);
  const cached = versionCache.get(key);
  if (cached && cached.expiresAt > now) return cached.major;
  let major: number | null = null;
  try {
    const probe = await runAdapterExecutionTargetProcess(input.runId, input.executionTarget, input.command, ["--version"], {
      cwd: input.cwd,
      env: input.env,
      timeoutSec: VERSION_PROBE_TIMEOUT_SEC,
      graceSec: 2,
      onLog: async () => {},
    });
    if (!probe.timedOut && (probe.exitCode ?? 1) === 0) major = parseOpenCodeMajorVersion(`${probe.stdout}\n${probe.stderr}`);
  } catch {
    major = null;
  }
  versionCache.set(key, { major, expiresAt: now + VERSION_CACHE_TTL_MS });
  return major;
}
