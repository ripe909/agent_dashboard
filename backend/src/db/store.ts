import { Agent, Resource, Campaign } from './schema';
import { PostgresStore } from './postgresStore';
import { MemoryStore } from './memoryStore';

export type AgentPatch = Partial<Pick<Agent, 'name' | 'description' | 'status' | 'ownerId' | 'ownerName' | 'ownerEmail' | 'testClientSecret' | 'testPrivateKeyPem' | 'testPrivateKeyKid' | 'killSwitchActive' | 'killSwitchCredentials'>>;
export type NewAgent = Pick<Agent, 'name' | 'oktaAgentId' | 'status'> & Partial<Pick<Agent, 'description' | 'createdBy'>>;

export type NewCampaign = Pick<Campaign, 'name'> & Partial<Pick<Campaign, 'description' | 'status' | 'budget' | 'startDate' | 'endDate'>>;
export type CampaignPatch = Partial<Pick<Campaign, 'name' | 'description' | 'status' | 'budget' | 'startDate' | 'endDate'>>;

export interface AppSettings {
  streamlinedUserAccess: boolean;
  streamlinedMachineAccess: boolean;
  sharedAuthorizationServerId: string | null;
  serviceClientId: string | null;
  serviceClientSecret: string | null;
  campaignsAuthorizationServerId: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  streamlinedUserAccess: true,
  streamlinedMachineAccess: true,
  sharedAuthorizationServerId: null,
  serviceClientId: null,
  serviceClientSecret: null,
  campaignsAuthorizationServerId: null,
};

export interface Store {
  listAgents(): Promise<Agent[]>;
  findAgentByOktaId(oktaAgentId: string): Promise<Agent | undefined>;
  findAgentById(id: string): Promise<Agent | undefined>;
  insertAgent(data: NewAgent): Promise<Agent>;
  updateAgentByOktaId(oktaAgentId: string, patch: AgentPatch): Promise<Agent | undefined>;
  updateAgentById(id: string, patch: AgentPatch): Promise<Agent | undefined>;
  deleteAgentById(id: string): Promise<void>;

  listAgentResourceIds(agentId: string): Promise<string[]>;
  listAgentResourcesJoined(agentId: string): Promise<Resource[]>;
  deleteAgentResourcesByAgentId(agentId: string): Promise<void>;

  listResources(): Promise<Resource[]>;

  listCampaigns(): Promise<Campaign[]>;
  searchCampaigns(query: string): Promise<Campaign[]>;
  findCampaignById(id: string): Promise<Campaign | undefined>;
  insertCampaign(data: NewCampaign): Promise<Campaign>;
  updateCampaignById(id: string, patch: CampaignPatch): Promise<Campaign | undefined>;
  deleteCampaignById(id: string): Promise<void>;

  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  init(): Promise<void>;
  keepAlive(): Promise<void>;
}

const DB_MODE = process.env.DB_MODE || 'postgres';

export const store: Store = DB_MODE === 'memory' ? new MemoryStore() : new PostgresStore();
