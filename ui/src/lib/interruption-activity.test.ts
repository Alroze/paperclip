import { describe, expect, it } from "vitest";
import { interruptionShowsAgentWorking } from "./interruption-activity";

describe("interruptionShowsAgentWorking", () => {
  it("shows the agent working while recovery is active", () => {
    expect(interruptionShowsAgentWorking({ state: "working" })).toBe(true);
  });

  it("does not show a parked retry as working", () => {
    expect(interruptionShowsAgentWorking({
      state: "working",
      retryWait: { reason: "dependency_blocked", message: "Retry is waiting on a blocked task this one depends on." },
    })).toBe(false);
  });

  it("ignores other states and missing presentations", () => {
    expect(interruptionShowsAgentWorking({ state: "failed" })).toBe(false);
    expect(interruptionShowsAgentWorking(null)).toBe(false);
    expect(interruptionShowsAgentWorking(undefined)).toBe(false);
  });
});
