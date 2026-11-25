import { describe, expect, it } from "vitest";
import { pickReviewEscalationAgentId } from "../services/review-escalation-agent.js";

const now = new Date("2026-11-25T00:00:00.000Z");

function agent(id: string, overrides: Record<string, unknown> = {}) {
  return { id, companyId: "company-1", name: id, role: "general", status: "idle", reportsTo: null as string | null, createdAt: now, ...overrides };
}

describe("pickReviewEscalationAgentId", () => {
  it("prefers an available agent with the ceo role at the top of the org chart", () => {
    expect(pickReviewEscalationAgentId([
      agent("lead"),
      agent("ceo", { role: "ceo" }),
      agent("dev", { reportsTo: "ceo" }),
    ])).toBe("ceo");
  });

  it("uses the single top-level agent when no agent has the ceo role", () => {
    expect(pickReviewEscalationAgentId([
      agent("top", { status: "running" }),
      agent("lead", { reportsTo: "top" }),
      agent("dev", { reportsTo: "lead" }),
    ])).toBe("top");
  });

  it("returns null when several agents share the top of the org chart", () => {
    expect(pickReviewEscalationAgentId([agent("a"), agent("b")])).toBeNull();
  });

  it("skips paused and terminated agents", () => {
    expect(pickReviewEscalationAgentId([
      agent("ceo", { role: "ceo", status: "paused" }),
      agent("lead", { reportsTo: "ceo" }),
    ])).toBeNull();
    expect(pickReviewEscalationAgentId([
      agent("old", { status: "terminated" }),
      agent("top"),
    ])).toBe("top");
  });
});
