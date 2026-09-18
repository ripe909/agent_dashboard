import { Agent, Resource } from './schema';
import { PostgresStore } from './postgresStore';
import { MemoryStore } from './memoryStore';

export type AgentPatch = Partial<Pick<Agent, 'name' | 'description' | 'status' | 'ownerId' | 'ownerName' | 'ownerEmail'>>;
export type NewAgent = Pick<Agent, 'name' | 'oktaAgentId' | 'status'> & Partial<Pick<Agent, 'description' | 'createdBy'>>;

export interface AppSettings {
  streamlinedUserAccess: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = { streamlinedUserAccess: true };

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

  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  init(): Promise<void>;
  keepAlive(): Promise<void>;
}

const DB_MODE = process.env.DB_MODE || 'postgres';

export const store: Store = DB_MODE === 'memory' ? new MemoryStore() : new PostgresStore();
