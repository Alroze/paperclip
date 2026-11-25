import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRegistry = vi.hoisted(() => ({
  getById: vi.fn(),
  getByKey: vi.fn(),
  listInstalled: vi.fn(),
  listByStatus: vi.fn(),
}));

const mockLifecycle = vi.hoisted(() => ({
  load: vi.fn(),
  upgrade: vi.fn(),
  unload: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => mockRegistry,
}));

vi.mock("../services/plugin-lifecycle.js", () => ({
  pluginLifecycleManager: () => mockLifecycle,
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  publishGlobalLiveEvent: vi.fn(),
}));

const companyA = "22222222-2222-4222-8222-222222222222";
const operatorAgent = "44444444-4444-4444-8444-444444444444";
const otherAgent = "88888888-8888-4888-8888-888888888888";
const pluginId = "11111111-1111-4111-8111-111111111111";

function agentActor(agentId: string, overrides: Record<string, unknown> = {}) {
  return { type: "agent", agentId, companyId: companyA, runId: "55555555-5555-4555-8555-555555555555", source: "agent_jwt", ...overrides };
}

async function createApp(actor: Record<string, unknown>) {
  const [{ pluginRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/plugins.js"),
    import("../middleware/index.js"),
  ]);
  const loader = { installPlugin: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as typeof req.actor;
    next();
  });
  app.use("/api", pluginRoutes({} as never, loader as never, undefined as never, undefined, undefined as never, undefined as never));
  app.use(errorHandler);
  return { app, loader };
}

function plugin(status: string) {
  const record = { id: pluginId, pluginKey: "paperclip.example", version: "1.0.0", status };
  mockRegistry.getById.mockResolvedValue(record);
  return record;
}

describe("plugin operator agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PAPERCLIP_PLUGIN_OPERATOR_AGENT_IDS", ` ${operatorAgent} ,`);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets a listed agent read, upgrade, disable and enable an installed plugin", async () => {
    const record = plugin("ready");
    mockRegistry.listInstalled.mockResolvedValue([record]);
    mockLifecycle.upgrade.mockResolvedValue({ ...record, version: "1.1.0" });
    mockLifecycle.disable.mockResolvedValue({ ...record, status: "disabled" });
    mockLifecycle.enable.mockResolvedValue(record);
    const { app } = await createApp(agentActor(operatorAgent));

    expect((await request(app).get("/api/plugins")).status).toBe(200);
    expect((await request(app).get(`/api/plugins/${pluginId}`)).status).toBe(200);
    expect((await request(app).post(`/api/plugins/${pluginId}/upgrade`).send({})).status).toBe(200);
    expect((await request(app).post(`/api/plugins/${pluginId}/disable`).send({})).status).toBe(200);
    plugin("disabled");
    expect((await request(app).post(`/api/plugins/${pluginId}/enable`).send({})).status).toBe(200);

    expect(mockLifecycle.upgrade).toHaveBeenCalledWith(pluginId, undefined);
    expect(mockLifecycle.disable).toHaveBeenCalledWith(pluginId, undefined);
    expect(mockLifecycle.enable).toHaveBeenCalledWith(pluginId);
  }, 60_000);

  it("refuses a listed agent approving new capabilities by enabling an upgrade_pending plugin", async () => {
    plugin("upgrade_pending");
    const { app } = await createApp(agentActor(operatorAgent));

    const res = await request(app).post(`/api/plugins/${pluginId}/enable`).send({});

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ details: { code: "plugin_capability_approval_required" } });
    expect(mockLifecycle.enable).not.toHaveBeenCalled();
  }, 60_000);

  it("refuses a listed agent installing a new plugin", async () => {
    const { app, loader } = await createApp(agentActor(operatorAgent));

    const res = await request(app).post("/api/plugins/install").send({ packageName: "paperclip-plugin-example" });

    expect(res.status).toBe(403);
    expect(loader.installPlugin).not.toHaveBeenCalled();
  }, 60_000);

  it.each([
    ["an agent that is not listed", agentActor(otherAgent)],
    ["a listed agent acting for a user", agentActor(operatorAgent, { onBehalfOfUserId: "user-1" })],
  ])("refuses %s", async (_name, actor) => {
    plugin("ready");
    const { app } = await createApp(actor);

    expect((await request(app).get("/api/plugins")).status).toBe(403);
    expect((await request(app).post(`/api/plugins/${pluginId}/upgrade`).send({})).status).toBe(403);
    expect((await request(app).post(`/api/plugins/${pluginId}/disable`).send({})).status).toBe(403);
    expect(mockLifecycle.upgrade).not.toHaveBeenCalled();
    expect(mockLifecycle.disable).not.toHaveBeenCalled();
  }, 60_000);

  it("refuses every agent when no operator is configured", async () => {
    vi.stubEnv("PAPERCLIP_PLUGIN_OPERATOR_AGENT_IDS", "");
    plugin("ready");
    const { app } = await createApp(agentActor(operatorAgent));

    expect((await request(app).post(`/api/plugins/${pluginId}/upgrade`).send({})).status).toBe(403);
    expect(mockLifecycle.upgrade).not.toHaveBeenCalled();
  }, 60_000);
});
