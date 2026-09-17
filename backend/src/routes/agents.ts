import { Router, Request, Response } from 'express';
import { store } from '../db/client';
import * as okta from '../services/okta';

const router = Router();

// ── Sync helper: upsert an Okta agent into local store ───────────────────────
async function upsertAgent(oktaAgent: okta.OktaAIAgent) {
  const existing = await store.findAgentByOktaId(oktaAgent.id);
  if (existing) {
    const updated = await store.updateAgentByOktaId(oktaAgent.id, {
      name: oktaAgent.profile.name,
      description: oktaAgent.profile.description || null,
      status: oktaAgent.status.toLowerCase(),
    });
    return updated || existing;
  }
  return store.insertAgent({
    name: oktaAgent.profile.name,
    description: oktaAgent.profile.description || null,
    oktaAgentId: oktaAgent.id,
    status: oktaAgent.status.toLowerCase(),
  });
}

// GET /api/agents — Okta is the source of truth: only return agents that exist in Okta
router.get('/', async (_req: Request, res: Response) => {
  try {
    const oktaAgents = await okta.listAIAgents(200);
    const oktaIds = new Set(oktaAgents.map(a => a.id));

    // Upsert current Okta agents into local store
    await Promise.all(oktaAgents.map(upsertAgent));

    // Purge any local rows whose Okta agent has been deleted
    const allLocal = await store.listAgents();
    const stale = allLocal.filter(a => a.oktaAgentId && !oktaIds.has(a.oktaAgentId));
    await Promise.all(stale.map(async (a) => {
      await store.deleteAgentResourcesByAgentId(a.id);
      await store.deleteAgentById(a.id);
    }));

    // Return only agents that exist in Okta, enriched with local metadata
    const withCounts = await Promise.all(
      oktaAgents.map(async (oktaAgent) => {
        // Find or create the local row
        const local = await store.findAgentByOktaId(oktaAgent.id);
        const linked = local ? await store.listAgentResourceIds(local.id) : [];
        const agentOrn = okta.agentOrnFromLinks(oktaAgent._links);
        const oktaOwners = agentOrn ? await okta.listResourceOwnersByOrn(agentOrn).catch(() => []) : [];
        const liveOwner = oktaOwners[0];
        return {
          ...(local || {}),
          oktaAgentId: oktaAgent.id,
          name: oktaAgent.profile.name,
          description: oktaAgent.profile.description || null,
          status: oktaAgent.status.toLowerCase(),
          oktaStatus: oktaAgent.status,
          resourceCount: linked.length,
          ownerId: liveOwner?.id ?? (local as any)?.ownerId,
          ownerName: liveOwner?.name ?? (local as any)?.ownerName,
          ownerEmail: liveOwner?.email ?? (local as any)?.ownerEmail,
        };
      })
    );

    // Sort newest first (by Okta created date)
    withCounts.sort((a, b) => {
      const ta = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
      const tb = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
      return tb - ta;
    });

    res.json(withCounts);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents — create in Okta, store locally
router.post('/', async (req: Request, res: Response) => {
  const { name, description } = req.body;
  const createdBy = req.headers['x-user-id'] as string | undefined;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const oktaAgent = await okta.createAIAgent(name.trim(), description?.trim());
    const agent = await store.insertAgent({
      name: oktaAgent.profile.name, description: oktaAgent.profile.description || null,
      oktaAgentId: oktaAgent.id, status: oktaAgent.status?.toLowerCase() || 'staged',
      createdBy: createdBy || null,
    });
    res.status(201).json({ ...agent, oktaStatus: oktaAgent.status });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id — full agent detail with live Okta data
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const linked = await store.listAgentResourcesJoined(agent.id);

    let oktaData: any = null;
    let credentials: any = null;
    let adminConsoleUrl: string | undefined;
    let oktaOwners: okta.ResourceOwner[] = [];
    if (agent.oktaAgentId) {
      try {
        oktaData = await okta.getAIAgent(agent.oktaAgentId);
        if (oktaData?.appId) {
          credentials = await okta.getAgentCredentials(oktaData.appId);
        } else if (oktaData?.oauthClient?.clientId) {
          credentials = await okta.getNativeAgentCredentials(agent.oktaAgentId);
        }
        adminConsoleUrl = await okta.getAgentAdminUrl(agent.oktaAgentId);
      } catch {}
      try { oktaOwners = await okta.listResourceOwners(agent.oktaAgentId); } catch {}
    }

    res.json({
      ...agent,
      resources: linked,
      okta: oktaData,
      credentials,
      adminConsoleUrl,
      oktaOwners,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/agents/:id/owner
router.put('/:id/owner', async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  try {
    const user = await okta.getUser(userId);
    // 1. Store locally
    const updated = await store.updateAgentById(req.params.id, { ownerId: user.id, ownerName: user.displayName, ownerEmail: user.email });
    if (!updated) return res.status(404).json({ error: 'Agent not found' });

    // 2. Register the owner in Okta's IGA governance registry
    let adminConsoleUrl: string | undefined;
    let ownerNote: string;
    if (updated.oktaAgentId) {
      try { adminConsoleUrl = await okta.getAgentAdminUrl(updated.oktaAgentId); } catch {}
      try {
        await okta.setAgentOwner(updated.oktaAgentId, user.id);
        ownerNote = 'Owner saved and registered in Okta.';
      } catch (e: any) {
        ownerNote = `Owner saved in app, but registering in Okta failed: ${e.message}`;
      }
    } else {
      ownerNote = 'Owner saved in app. Agent has no linked Okta ID yet.';
    }

    res.json({ ...updated, adminConsoleUrl, ownerNote });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/activate
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const result = await okta.activateAIAgent(agent.oktaAgentId);
    // Update local status
    await store.updateAgentById(req.params.id, { status: 'active' });
    res.json({ message: 'Activation triggered', ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/deactivate
router.post('/:id/deactivate', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    await okta.deactivateAIAgent(agent.oktaAgentId);
    await store.updateAgentById(req.params.id, { status: 'inactive' });
    res.json({ message: 'Deactivated' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/agents/:id/credentials — set auth method on backing app
router.put('/:id/credentials', async (req: Request, res: Response) => {
  const { authMethod } = req.body; // 'none' | 'client_secret_basic' | 'private_key_jwt'
  if (!authMethod) return res.status(400).json({ error: 'authMethod is required' });
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    if (!oktaAgent.appId) return res.status(400).json({ error: 'Agent must be activated before configuring credentials' });
    const result = await okta.setAgentAuthMethod(oktaAgent.appId, authMethod);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/credentials/secret — generate a client secret for a native (no backing app) agent
router.post('/:id/credentials/secret', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    if (oktaAgent.appId) return res.status(400).json({ error: 'This agent uses a backing app — manage credentials via the Authentication Method setting above' });
    const result = await okta.createAgentSecret(agent.oktaAgentId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/credentials/jwk — generate a keypair and register the public key for a native agent
router.post('/:id/credentials/jwk', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    if (oktaAgent.appId) return res.status(400).json({ error: 'This agent uses a backing app — manage credentials via the Authentication Method setting above' });
    const result = await okta.createAgentJwk(agent.oktaAgentId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/agents/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (agent.oktaAgentId) await okta.deleteAIAgent(agent.oktaAgentId).catch(() => {});
    await store.deleteAgentResourcesByAgentId(req.params.id);
    await store.deleteAgentById(req.params.id);
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
