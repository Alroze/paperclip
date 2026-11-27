import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@paperclipai/adapter-utils/execution-target", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@paperclipai/adapter-utils/execution-target")>()),
  runAdapterExecutionTargetProcess: vi.fn(),
}));

import { runAdapterExecutionTargetProcess } from "@paperclipai/adapter-utils/execution-target";
import {
  clearOpenCodeVersionCache,
  detectOpenCodeMajorVersion,
  isOpenCodeV2,
  openCodeGlobalArgs,
  openCodeErrorStatus,
  openCodeModelArg,
  parseOpenCodeMajorVersion,
} from "./cli-version.js";

const runMock = vi.mocked(runAdapterExecutionTargetProcess);
const result = (stdout: string, exitCode = 0) =>
  ({ exitCode, signal: null, timedOut: false, stdout, stderr: "", pid: 1, startedAt: new Date().toISOString() }) as never;

describe("OpenCode CLI version", () => {
  afterEach(() => {
    clearOpenCodeVersionCache();
    runMock.mockReset();
  });

  it("parses the version output of OpenCode 1 and 2", () => {
    expect(parseOpenCodeMajorVersion("1.19.6\n")).toBe(1);
    expect(parseOpenCodeMajorVersion("opencode v2.4.2\n")).toBe(2);
    expect(parseOpenCodeMajorVersion("not a version")).toBeNull();
    expect(isOpenCodeV2(2)).toBe(true);
    expect(isOpenCodeV2(1)).toBe(false);
    expect(isOpenCodeV2(null)).toBe(false);
    expect(openCodeGlobalArgs(2)).toEqual(["--standalone"]);
    expect(openCodeGlobalArgs(1)).toEqual([]);
  });

  it("passes the variant as a flag for OpenCode 1 and inside the model for OpenCode 2", () => {
    expect(openCodeModelArg("openai/gpt-5", "high", 1)).toEqual({ model: "openai/gpt-5", variantArgs: ["--variant", "high"] });
    expect(openCodeModelArg("openai/gpt-5", "high", null)).toEqual({ model: "openai/gpt-5", variantArgs: ["--variant", "high"] });
    expect(openCodeModelArg("openai/gpt-5", "high", 2)).toEqual({ model: "openai/gpt-5#high", variantArgs: [] });
    expect(openCodeModelArg("openai/gpt-5#low", "high", 2)).toEqual({ model: "openai/gpt-5#low", variantArgs: [] });
    expect(openCodeModelArg("openai/gpt-5", "", 2)).toEqual({ model: "openai/gpt-5", variantArgs: [] });
  });

  it("reads the provider status from both error shapes", () => {
    expect(openCodeErrorStatus({ name: "APIError", data: { statusCode: 401 } })).toBe(401);
    expect(openCodeErrorStatus({ type: "provider.auth", status: 401 })).toBe(401);
    expect(openCodeErrorStatus("unknown session")).toBeNull();
    expect(openCodeErrorStatus({ message: "x" })).toBeNull();
  });

  it("probes --version once per command and caches the answer", async () => {
    runMock.mockResolvedValue(result("opencode v2.4.2\n"));
    const input = { runId: "r", executionTarget: null, command: "/opt/oc2/opencode", cwd: "/tmp", env: { PATH: "/usr/bin" }, now: 1000 };
    expect(await detectOpenCodeMajorVersion(input)).toBe(2);
    expect(await detectOpenCodeMajorVersion({ ...input, now: 2000 })).toBe(2);
    expect(runMock).toHaveBeenCalledOnce();
    expect(runMock.mock.calls[0]?.[3]).toEqual(["--version"]);
  });

  it("treats a failing probe as OpenCode 1", async () => {
    runMock.mockResolvedValueOnce(result("", 1));
    expect(await detectOpenCodeMajorVersion({ runId: "r", executionTarget: null, command: "oc-a", cwd: "/tmp", env: {} })).toBeNull();
    runMock.mockRejectedValueOnce(new Error("spawn ENOENT"));
    expect(await detectOpenCodeMajorVersion({ runId: "r", executionTarget: null, command: "oc-b", cwd: "/tmp", env: {} })).toBeNull();
  });
});
