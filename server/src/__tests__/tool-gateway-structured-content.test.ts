import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { mcpGatewayProtocolRoutes } from "../routes/tool-gateway.js";

async function callTool(value: unknown) {
  const router = mcpGatewayProtocolRoutes({ executeTool: async () => ({ result: value }) } as never);
  const layer = (router.stack as Array<{ route?: { methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }>)
    .find(entry => entry.route?.methods.post)!;
  const req = Object.assign(new EventEmitter(), {
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "example_tool", arguments: {} } },
    params: { gatewayPublicId: "test" }, headers: {}, header: () => "Bearer test",
  });
  let response: { error?: unknown; result: { structuredContent: unknown } } | undefined;
  const res = Object.assign(new EventEmitter(), { json: (body: typeof response) => { response = body; } });
  await layer.route!.stack[0]!.handle(req, res);
  return response!;
}

describe("tool gateway tools/call structuredContent", () => {
  it.each([
    ["plugin envelope", { pluginId: "example", result: { content: "open", data: { id: 1 } } }, { pluginId: "example", result: { content: "open", data: { id: 1 } } }],
    ["record data", { data: { id: 1 }, content: "open" }, { id: 1 }],
    ["null data", { data: null, content: "empty" }, { data: null, content: "empty" }],
    ["array data", { data: [1], content: "list" }, { data: [1], content: "list" }],
    ["scalar data", { data: 1, content: "number" }, { data: 1, content: "number" }],
    ["null result", null, {}],
  ])("returns an MCP-valid object for %s", async (_name, value, expected) => {
    const response = await callTool(value);
    expect(response.error).toBeUndefined();
    expect(response.result.structuredContent).toEqual(expected);
    expect(CallToolResultSchema.safeParse(response.result).success).toBe(true);
  });
});
