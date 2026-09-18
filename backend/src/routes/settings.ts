import { Router, Request, Response } from 'express';
import { store } from '../db/client';

const router = Router();

// GET /api/settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await store.getSettings());
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
