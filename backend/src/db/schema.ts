import { pgTable, text, timestamp, uuid, jsonb, primaryKey, numeric, boolean } from 'drizzle-orm/pg-core';

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  oktaAgentId: text('okta_agent_id').unique(),
  ownerId: text('owner_id'),
  ownerName: text('owner_name'),
  ownerEmail: text('owner_email'),
  status: text('status').default('pending').notNull(),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Plaintext credentials captured for the Exercise Agent feature — Okta only shows these once,
  // so they must be persisted here if we want to make a live token request as this agent later.
  testClientSecret: text('test_client_secret'),
  testPrivateKeyPem: text('test_private_key_pem'),
  testPrivateKeyKid: text('test_private_key_kid'),
  // Kill switch (see routes/agents.ts POST /:id/kill-switch): deactivates the agent's own live
  // credential(s) in Okta so its token endpoint genuinely refuses them, rather than merely flipping
  // a status flag the token endpoint doesn't check (confirmed live — agent status is NOT enforced
  // at the token endpoint, credential lifecycle status IS). killSwitchCredentials is a JSON array of
  // { type: 'secret' | 'jwk', id: string } for exactly the credentials this flipped, so restore can
  // reactivate precisely those rather than guessing.
  killSwitchActive: boolean('kill_switch_active').default(false).notNull(),
  killSwitchCredentials: text('kill_switch_credentials'),
});

export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  description: text('description'),
  config: jsonb('config'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const agentResources = pgTable(
  'agent_resources',
  {
    agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.resourceId] }) })
);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').default('draft').notNull(),
  budget: numeric('budget'),
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type Resource = typeof resources.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
