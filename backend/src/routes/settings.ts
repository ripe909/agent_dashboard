import { Router, Request, Response } from 'express';
import { store } from '../db/client';
import * as okta from '../services/okta';

const router = Router();

// GET /api/settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await store.getSettings());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/settings/authorization-servers — org-wide list, for the shared authz server picker
router.get('/authorization-servers', async (_req: Request, res: Response) => {
  try {
    const orgId = await okta.getAnyOrgId();
    if (!orgId) return res.json([]);
    const servers = await okta.listAuthorizationServers(orgId);
    res.json(servers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/settings
router.put('/', async (req: Request, res: Response) => {
  try {
    res.json(await store.updateSettings(req.body));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
