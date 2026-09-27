import { randomUUID } from 'crypto';
import { Agent, Resource, Campaign } from './schema';
import { Store, AgentPatch, NewAgent, AppSettings, DEFAULT_SETTINGS, NewCampaign, CampaignPatch } from './store';
import { DEFAULT_RESOURCES } from './postgresStore';

export class MemoryStore implements Store {
  private agentsById = new Map<string, Agent>();
  private resourcesById = new Map<string, Resource>();
  private agentResourceIds = new Map<string, Set<string>>();
  private campaignsById = new Map<string, Campaign>();
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
      testClientSecret: null,
      testPrivateKeyPem: null,
      testPrivateKeyKid: null,
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

  async listCampaigns(): Promise<Campaign[]> {
    return [...this.campaignsById.values()];
  }

  async searchCampaigns(query: string): Promise<Campaign[]> {
    const q = query.toLowerCase();
    return [...this.campaignsById.values()].filter((c) => c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q));
  }

  async findCampaignById(id: string): Promise<Campaign | undefined> {
    return this.campaignsById.get(id);
  }

  async insertCampaign(data: NewCampaign): Promise<Campaign> {
    const now = new Date();
    const campaign: Campaign = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? null,
      status: data.status ?? 'draft',
      budget: data.budget ?? null,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.campaignsById.set(campaign.id, campaign);
    return campaign;
  }

  async updateCampaignById(id: string, patch: CampaignPatch): Promise<Campaign | undefined> {
    const existing = this.campaignsById.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date() };
    this.campaignsById.set(id, updated);
    return updated;
  }

  async deleteCampaignById(id: string): Promise<void> {
    this.campaignsById.delete(id);
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
