import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { agents, agentResources, resources, Agent, Resource } from './schema';
import { Store, AgentPatch, NewAgent, AppSettings, DEFAULT_SETTINGS } from './store';

const dbUrl = process.env.DATABASE_URL || '';
// Hosted Postgres providers generally require SSL; local dev doesn't.
const needsSsl = !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 15_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: false,
});

// Reconnect on unexpected termination
pool.on('error', (err) => {
  console.error('Postgres pool error — pool will reconnect on next query:', err.message);
});

const db = drizzle(pool, { schema });

// Retry a DB operation on "Connection terminated" errors
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isConnErr = err.message?.includes('terminated') || err.message?.includes('ECONNRESET') || err.code === '57P01';
      if (isConnErr && i < retries) {
        console.warn(`DB connection error, retrying (${i + 1}/${retries})…`);
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max DB retries exceeded');
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      okta_agent_id TEXT UNIQUE,
      owner_id TEXT,
      owner_name TEXT,
      owner_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS resources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      config JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_resources (
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (agent_id, resource_id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      CONSTRAINT settings_single_row CHECK (id = 1)
    );
  `);
}

export const DEFAULT_RESOURCES = [
  { name: 'AWS Bedrock', type: 'cloud_ai', description: 'Amazon Bedrock foundation models and agent runtime' },
  { name: 'Google Vertex AI', type: 'cloud_ai', description: 'Google Vertex AI — Gemini and other Google AI models' },
  { name: 'Azure OpenAI', type: 'cloud_ai', description: 'Azure OpenAI Service — GPT-4 and other models via Azure' },
  { name: 'Slack MCP Server', type: 'mcp_server', description: 'Slack MCP connector for agent messaging and notifications' },
  { name: 'GitHub MCP Server', type: 'mcp_server', description: 'GitHub MCP connector for code operations and repository access' },
  { name: 'Okta MCP Adapter', type: 'mcp_server', description: 'Okta MCP Adapter — connect AI agents to Okta-secured tools' },
  { name: 'Salesforce', type: 'saas_app', description: 'Salesforce CRM — contacts, accounts, opportunities' },
  { name: 'Jira', type: 'saas_app', description: 'Atlassian Jira project management and issue tracking' },
  { name: 'Google Workspace', type: 'saas_app', description: 'Google Workspace — Gmail, Drive, Calendar, Docs' },
  { name: 'Confluence', type: 'saas_app', description: 'Atlassian Confluence knowledge base and documentation' },
  { name: 'OpenAI API', type: 'api', description: 'OpenAI GPT-4 and other model APIs' },
  { name: 'Anthropic API', type: 'api', description: 'Anthropic Claude API for AI agent capabilities' },
];

async function seedResources() {
  const existing = await pool.query('SELECT COUNT(*) FROM resources');
  if (parseInt(existing.rows[0].count) > 0) return;
  for (const r of DEFAULT_RESOURCES) {
    await pool.query(
      'INSERT INTO resources (name, type, description) VALUES ($1, $2, $3)',
      [r.name, r.type, r.description]
    );
  }
  console.log(`✅ Seeded ${DEFAULT_RESOURCES.length} default resources`);
}

async function seedSettings() {
  await pool.query(
    'INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(DEFAULT_SETTINGS)]
  );
}

export class PostgresStore implements Store {
  async listAgents(): Promise<Agent[]> {
    return withRetry(() => db.select().from(agents));
  }

  async findAgentByOktaId(oktaAgentId: string): Promise<Agent | undefined> {
    const rows = await withRetry(() => db.select().from(agents).where(eq(agents.oktaAgentId, oktaAgentId)));
    return rows[0];
  }

  async findAgentById(id: string): Promise<Agent | undefined> {
    const rows = await withRetry(() => db.select().from(agents).where(eq(agents.id, id)));
    return rows[0];
  }

  async insertAgent(data: NewAgent): Promise<Agent> {
    const [a] = await withRetry(() => db.insert(agents).values(data).returning());
    return a;
  }

  async updateAgentByOktaId(oktaAgentId: string, patch: AgentPatch): Promise<Agent | undefined> {
    const [a] = await withRetry(() => db.update(agents).set(patch).where(eq(agents.oktaAgentId, oktaAgentId)).returning());
    return a;
  }

  async updateAgentById(id: string, patch: AgentPatch): Promise<Agent | undefined> {
    const [a] = await withRetry(() => db.update(agents).set(patch).where(eq(agents.id, id)).returning());
    return a;
  }

  async deleteAgentById(id: string): Promise<void> {
    await withRetry(() => db.delete(agents).where(eq(agents.id, id)));
  }

  async listAgentResourceIds(agentId: string): Promise<string[]> {
    const rows = await withRetry(() => db.select().from(agentResources).where(eq(agentResources.agentId, agentId)));
    return rows.map((r) => r.resourceId);
  }

  async listAgentResourcesJoined(agentId: string): Promise<Resource[]> {
    const rows = await withRetry(() =>
      db.select({ resource: resources })
        .from(agentResources)
        .innerJoin(resources, eq(agentResources.resourceId, resources.id))
        .where(eq(agentResources.agentId, agentId))
    );
    return rows.map((r) => r.resource);
  }

  async deleteAgentResourcesByAgentId(agentId: string): Promise<void> {
    await withRetry(() => db.delete(agentResources).where(eq(agentResources.agentId, agentId)));
  }

  async listResources(): Promise<Resource[]> {
    return withRetry(() => db.select().from(resources));
  }

  async getSettings(): Promise<AppSettings> {
    const { rows } = await withRetry(() => pool.query('SELECT data FROM settings WHERE id = 1'));
    return rows[0] ? { ...DEFAULT_SETTINGS, ...rows[0].data } : DEFAULT_SETTINGS;
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated = { ...current, ...patch };
    await withRetry(() => pool.query(
      'INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
      [JSON.stringify(updated)]
    ));
    return updated;
  }

  async init(): Promise<void> {
    await migrate();
    console.log('✅ Database migrated');
    await seedResources();
    await seedSettings();
  }

  async keepAlive(): Promise<void> {
    await pool.query('SELECT 1');
  }
}
