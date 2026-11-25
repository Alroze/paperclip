import { asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { getAgentWorkEligibility } from "@paperclipai/shared";

const UNAVAILABLE_AGENT_STATUSES = new Set(["paused", "terminated", "pending_approval"]);

export async function reviewEscalationAgentId(db: Db, companyId: string): Promise<string | null> {
  const companyAgents = await db.select({
    id: agents.id,
    companyId: agents.companyId,
    name: agents.name,
    role: agents.role,
    status: agents.status,
    reportsTo: agents.reportsTo,
    createdAt: agents.createdAt,
  }).from(agents).where(eq(agents.companyId, companyId)).orderBy(asc(agents.createdAt), asc(agents.id));
  return pickReviewEscalationAgentId(companyAgents);
}

type EscalationCandidate = Parameters<typeof getAgentWorkEligibility>[0]["agents"][number] & {
  id: string;
  role: string;
  status: string;
  reportsTo: string | null;
};

export function pickReviewEscalationAgentId(companyAgents: EscalationCandidate[]): string | null {
  const usable = companyAgents.filter((agent) => !UNAVAILABLE_AGENT_STATUSES.has(agent.status)
    && getAgentWorkEligibility({ agent, agents: companyAgents }).assignable);
  const ceo = usable.find((agent) => agent.role === "ceo" && !agent.reportsTo);
  if (ceo) return ceo.id;
  const top = usable.filter((agent) => !agent.reportsTo);
  return top.length === 1 ? top[0]!.id : null;
}
