import type { Request } from "express";
import { forbidden } from "../errors.js";
import { assertBoardOrgAccess, assertInstanceAdmin } from "./authz.js";

export const PLUGIN_OPERATOR_AGENT_IDS_ENV = "PAPERCLIP_PLUGIN_OPERATOR_AGENT_IDS";

export function pluginOperatorAgentIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env[PLUGIN_OPERATOR_AGENT_IDS_ENV] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean));
}

export function isPluginOperatorAgent(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const actor = req.actor;
  if (actor?.type !== "agent" || !actor.agentId) return false;
  if (actor.onBehalfOfUserId?.trim()) return false;
  return pluginOperatorAgentIds(env).has(actor.agentId);
}

export function assertPluginReader(req: Request) {
  if (isPluginOperatorAgent(req)) return;
  assertBoardOrgAccess(req);
}

export function assertPluginOperator(req: Request) {
  if (isPluginOperatorAgent(req)) return;
  assertInstanceAdmin(req);
}

export function assertOperatorAgentMayEnable(req: Request, status: string) {
  if (!isPluginOperatorAgent(req)) return;
  if (status === "upgrade_pending") {
    throw forbidden("New plugin capabilities need board approval", {
      code: "plugin_capability_approval_required",
    });
  }
}
