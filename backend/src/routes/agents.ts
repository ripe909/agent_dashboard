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

// ── Sync helper: pull the live Okta owner into the local cache ───────────────
async function syncOwnerForAgent(localId: string, oktaAgent: okta.OktaAIAgent) {
  const agentOrn = okta.agentOrnFromLinks(oktaAgent._links);
  const owners = agentOrn ? await okta.listResourceOwnersByOrn(agentOrn).catch(() => []) : [];
  const owner = owners[0];
  return store.updateAgentById(localId, {
    ownerId: owner?.id ?? null,
    ownerName: owner?.name ?? null,
    ownerEmail: owner?.email ?? null,
  });
}

// Full resync: pulls every Okta agent + its live owner into the local store.
// Used both by the manual "sync owners" endpoints and once at backend startup.
export async function syncAllOwners(): Promise<number> {
  const oktaAgents = await okta.listAIAgents(200);
  const results = await Promise.all(oktaAgents.map(async (oktaAgent) => {
    const local = await upsertAgent(oktaAgent);
    await syncOwnerForAgent(local.id, oktaAgent);
  }));
  return results.length;
}

// POST /api/agents/sync-owners — refresh the local owner cache for every agent from Okta.
// Mounted before /:id so this literal path isn't swallowed by the :id param.
router.post('/sync-owners', async (_req: Request, res: Response) => {
  try {
    const count = await syncAllOwners();
    res.json({ synced: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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
    // (owner fields come from the local cache — see syncOwnerForAgent/syncAllOwners
    // for how that cache gets populated; this route does not call Okta's IGA API)
    const withCounts = await Promise.all(
      oktaAgents.map(async (oktaAgent) => {
        // Find or create the local row
        const local = await store.findAgentByOktaId(oktaAgent.id);
        const linked = local ? await store.listAgentResourceIds(local.id) : [];
        return {
          ...(local || {}),
          oktaAgentId: oktaAgent.id,
          name: oktaAgent.profile.name,
          description: oktaAgent.profile.description || null,
          status: oktaAgent.status.toLowerCase(),
          oktaStatus: oktaAgent.status,
          resourceCount: linked.length,
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
    // Owner comes from the local cache (see syncOwnerForAgent/syncAllOwners), not a live Okta call.
    const oktaOwners: okta.ResourceOwner[] = agent.ownerId
      ? [{ id: agent.ownerId, name: agent.ownerName || '', email: agent.ownerEmail || '' }]
      : [];
    let resourceUrl: string | undefined;
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
      try { resourceUrl = await okta.getAgentResourceUrl(agent.oktaAgentId); } catch {}
    }

    res.json({
      ...agent,
      resources: linked,
      okta: oktaData,
      credentials,
      adminConsoleUrl,
      oktaOwners,
      userAccessEnabled: !!oktaData?.signOnProvider,
      resourceUrl,
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

// POST /api/agents/:id/sync-owner — refresh this agent's owner cache from Okta's IGA registry
router.post('/:id/sync-owner', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    const updated = await syncOwnerForAgent(agent.id, oktaAgent);
    res.json(updated);
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

// PUT /api/agents/:id/user-access — enable human sign-in through this agent
router.put('/:id/user-access', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    await okta.enableUserAccess(agent.oktaAgentId);
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    res.json({ userAccessEnabled: !!oktaAgent.signOnProvider });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/user-access/assign — streamlined flow: provision/activate the backing
// OIDC app if needed, then assign a user to it, all in one request.
router.post('/:id/user-access/assign', async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const appId = await okta.ensureUserAccess(agent.oktaAgentId);
    await okta.assignUserToApp(appId, userId);
    res.status(201).json({ message: 'User assigned' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/user-access/users — users currently assigned to this agent's backing app
router.get('/:id/user-access/users', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.json([]);
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    const appId = oktaAgent.signOnProvider?.appInstanceId;
    if (!appId) return res.json([]);
    const users = await okta.listAppUsers(appId);
    res.json(users);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/authorization-servers — custom authorization servers available for delegation
router.get('/:id/authorization-servers', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.json([]);
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    const agentOrn = okta.agentOrnFromLinks(oktaAgent._links);
    if (!agentOrn) return res.json([]);
    const servers = await okta.listAuthorizationServers(okta.orgIdFromAgentOrn(agentOrn));
    res.json(servers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/delegations — list agents/apps currently authorized to call this agent
router.get('/:id/delegations', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.json([]);
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    const targetOrn = okta.agentOrnFromLinks(oktaAgent._links);
    if (!targetOrn) return res.json([]);

    const links = await okta.listDelegationLinksTo(targetOrn);
    const withCallers = await Promise.all(links.map(async (link) => {
      const callerId = link.callerOrn.split(':').pop();
      let callerName = callerId;
      try {
        const caller = await okta.getAIAgent(callerId!);
        callerName = caller.profile.name;
      } catch {}
      return { id: link.id, callerAgentId: callerId, callerName };
    }));
    res.json(withCallers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/delegations — authorize another AI agent to call this agent
router.post('/:id/delegations', async (req: Request, res: Response) => {
  const { callerAgentId, authorizationServerId } = req.body;
  if (!callerAgentId || !authorizationServerId) {
    return res.status(400).json({ error: 'callerAgentId and authorizationServerId are required' });
  }
  try {
    const target = await store.findAgentById(req.params.id);
    if (!target?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const caller = await store.findAgentById(callerAgentId);
    if (!caller?.oktaAgentId) return res.status(404).json({ error: 'Calling agent not found' });

    const targetOktaAgent = await okta.getAIAgent(target.oktaAgentId);
    const targetOrn = okta.agentOrnFromLinks(targetOktaAgent._links);
    if (!targetOrn) return res.status(400).json({ error: 'Could not resolve target agent ORN' });

    const callerOktaAgent = await okta.getAIAgent(caller.oktaAgentId);
    const callerOrn = okta.agentOrnFromLinks(callerOktaAgent._links);
    if (!callerOrn) return res.status(400).json({ error: 'Could not resolve calling agent ORN' });

    const orgId = okta.orgIdFromAgentOrn(targetOrn);
    const authServerOrn = okta.buildAuthorizationServerOrn(authorizationServerId, orgId);

    const existingResourceUrl = await okta.getAgentResourceUrl(target.oktaAgentId);
    if (!existingResourceUrl) {
      const { resourceUrl } = req.body;
      if (!resourceUrl) return res.status(400).json({ error: 'resourceUrl is required the first time a caller is added to this agent' });
      await okta.setAgentResourceUrl(target.oktaAgentId, resourceUrl);
    }

    await okta.connectAuthorizationServer(target.oktaAgentId, authServerOrn);
    await okta.createDelegationLink(callerOrn, targetOrn, authServerOrn);
    res.status(201).json({ message: 'Caller authorized' });
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
