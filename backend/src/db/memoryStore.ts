import { randomUUID } from 'crypto';
import { Agent, Resource } from './schema';
import { Store, AgentPatch, NewAgent, AppSettings, DEFAULT_SETTINGS } from './store';
import { DEFAULT_RESOURCES } from './postgresStore';

export class MemoryStore implements Store {
  private agentsById = new Map<string, Agent>();
  private resourcesById = new Map<string, Resource>();
  private agentResourceIds = new Map<string, Set<string>>();
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  async listAgents(): Promise<Agent[]> {
    return [...this.agentsById.values()];
  }

  async findAgentByOktaId(oktaAgentId: string): Promise<Agent | undefined> {
    return [...this.agentsById.values()].find((a) => a.oktaAgentId === oktaAgentId);
  }

  async findAgentById(id: string): Promise<Agent | undefined> {
    return this.agentsById.get(id);
  }

  async insertAgent(data: NewAgent): Promise<Agent> {
    const agent: Agent = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? null,
      oktaAgentId: data.oktaAgentId,
      ownerId: null,
      ownerName: null,
      ownerEmail: null,
      status: data.status,
      createdBy: data.createdBy ?? null,
      createdAt: new Date(),
    };
    this.agentsById.set(agent.id, agent);
    return agent;
  }

  async updateAgentByOktaId(oktaAgentId: string, patch: AgentPatch): Promise<Agent | undefined> {
    const existing = await this.findAgentByOktaId(oktaAgentId);
    if (!existing) return undefined;
    return this.updateAgentById(existing.id, patch);
  }

  async updateAgentById(id: string, patch: AgentPatch): Promise<Agent | undefined> {
    const existing = this.agentsById.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.agentsById.set(id, updated);
    return updated;
  }

  async deleteAgentById(id: string): Promise<void> {
    this.agentsById.delete(id);
  }

  async listAgentResourceIds(agentId: string): Promise<string[]> {
    return [...(this.agentResourceIds.get(agentId) || [])];
  }

  async listAgentResourcesJoined(agentId: string): Promise<Resource[]> {
    const ids = this.agentResourceIds.get(agentId);
    if (!ids) return [];
    return [...ids].map((id) => this.resourcesById.get(id)).filter((r): r is Resource => !!r);
  }

  async deleteAgentResourcesByAgentId(agentId: string): Promise<void> {
    this.agentResourceIds.delete(agentId);
  }

  async listResources(): Promise<Resource[]> {
    return [...this.resourcesById.values()];
  }

  async getSettings(): Promise<AppSettings> {
    return { ...this.settings };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...patch };
    return { ...this.settings };
  }

  async init(): Promise<void> {
    if (this.resourcesById.size > 0) return;
    for (const r of DEFAULT_RESOURCES) {
      const id = randomUUID();
      this.resourcesById.set(id, { id, name: r.name, type: r.type, description: r.description, config: null, createdAt: new Date() });
    }
    console.log(`✅ Seeded ${DEFAULT_RESOURCES.length} default resources (in-memory)`);
  }

  async keepAlive(): Promise<void> {
    // no-op — nothing to keep alive for an in-memory store
  }
}
