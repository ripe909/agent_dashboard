import { Router, Request, Response } from 'express';
import { store } from '../db/client';
import * as okta from '../services/okta';

const router = Router();

// GET /api/agents/:id/potential-connections — all types for an agent
router.get('/:id/potential-connections', async (req: Request, res: Response) => {
  try {
    const connections = await okta.listPotentialConnections();
    res.json(connections);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/potential-connections/:type — single type
router.get('/:id/potential-connections/:type', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as okta.ConnectionType;
    const connections = await okta.listPotentialConnections([type]);
    res.json(connections);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/authorization-servers/:authServerId/scopes — the AS's own scope catalog,
// for the "Only these scopes" picker. System scopes (openid/profile/email/etc) are filtered out —
// the picker is only useful for the AS's actual custom scopes.
router.get('/:id/authorization-servers/:authServerId/scopes', async (req: Request, res: Response) => {
  try {
    const scopes = await okta.listAuthorizationServerScopes(req.params.authServerId);
    res.json(scopes.filter((s) => !s.system));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/connections — current Okta connections
router.get('/:id/connections', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.json([]);
    const connections = await okta.listAgentConnections(agent.oktaAgentId);
    res.json(connections);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/connections — create a connection in Okta. For an agent-to-agent
// (IDENTITY_ASSERTION_A2A_SERVER) connection, also creates the reciprocal delegation link —
// matching the real Okta Admin Console, which keeps a resource connection and its delegation
// link in sync automatically rather than treating them as two independent manual steps.
router.post('/:id/connections', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found or not registered in Okta' });

    // Lightweight contract from ResourcePicker's "Connect to another AI agent" flow: the target
    // may not have Machine Access configured yet (no A2A resource-server object in Okta), so the
    // frontend sends just a dashboard agent id instead of a full PotentialConnection — this route
    // provisions the target (ensureMachineAccess) before building the real connection body,
    // matching how POST /machine-access/assign already provisions from the other tab.
    if (req.body.connectionType === 'IDENTITY_ASSERTION_A2A_SERVER' && req.body.targetAgentId) {
      const settings = await store.getSettings();
      if (!settings.sharedAuthorizationServerId) {
        return res.status(400).json({ error: 'Configure a shared authorization server in Settings first' });
      }
      const targetAgent = await store.findAgentById(req.body.targetAgentId);
      if (!targetAgent?.oktaAgentId) return res.status(404).json({ error: 'Target agent not found' });

      const { targetOrn, authServerOrn } = await okta.ensureMachineAccess(targetAgent.oktaAgentId, settings.sharedAuthorizationServerId);
      req.body = {
        connectionType: 'IDENTITY_ASSERTION_A2A_SERVER',
        authorizationServer: { orn: authServerOrn },
        resource: { orn: okta.buildA2AResourceOrn(targetAgent.oktaAgentId, okta.orgIdFromAgentOrn(targetOrn)) },
      };
    }

    const connection = await okta.createAgentConnection(agent.oktaAgentId, req.body);

    let warning: string | undefined;
    if (connection.connectionType === 'IDENTITY_ASSERTION_A2A_SERVER' && connection.resource?.orn && connection.authorizationServer?.orn) {
      try {
        const callerOktaAgent = await okta.getAIAgent(agent.oktaAgentId);
        const callerOrn = okta.agentOrnFromLinks(callerOktaAgent._links);
        // The connection's resource.orn is the target's a2a resource-server ORN, not its agent
        // ORN — delegation links key off the agent ORN, so resolve that from the target agent id.
        const targetAgentId = connection.resource.orn.split(':').pop();
        const targetOktaAgent = targetAgentId ? await okta.getAIAgent(targetAgentId) : null;
        const targetOrn = targetOktaAgent ? okta.agentOrnFromLinks(targetOktaAgent._links) : '';
        if (callerOrn && targetOrn) {
          await okta.createDelegationLink(callerOrn, targetOrn, connection.authorizationServer.orn);
        } else {
          warning = 'Connection created, but could not resolve ORNs to also authorize this as a Machine Access caller';
        }
      } catch (e: any) {
        warning = `Connection created, but failed to also authorize this as a Machine Access caller: ${e.message}`;
      }
    }

    res.status(201).json(warning ? { ...connection, warning } : connection);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/agents/:id/connections/:connId
router.delete('/:id/connections/:connId', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    await okta.deleteAgentConnection(agent.oktaAgentId, req.params.connId);
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
