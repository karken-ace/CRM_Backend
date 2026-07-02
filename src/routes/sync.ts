import { Router, Response } from 'express';
import axios from 'axios';
import { Agent } from '../models';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { config } from '../config';

const router = Router();

/**
 * POST /api/sync/trigger
 *
 * Forces the agent to do an immediate Meta sync. Backs the dashboard's
 * Refresh button so users can pull truly-current Meta state on demand
 * rather than waiting up to 5 min for the scheduled loop.
 *
 * Without this endpoint, Refresh would only invalidate the frontend cache
 * — which just re-reads whatever Mongo already has. With it, the chain is:
 *   Refresh click → backend → agent fetches Meta → upserts Mongo → backend
 *   returns counts → frontend invalidates queries → next read pulls fresh.
 */
router.post('/trigger', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.body;
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) return res.status(404).json({ detail: 'Agent not found' });
    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }
    if (agent.status !== 'ONLINE') {
      return res.status(503).json({ detail: `Agent is ${agent.status}; sync requires ONLINE` });
    }

    // 60s timeout matches the realistic hierarchical fetch ceiling. On cold
    // L2 cache or a brief Meta throttle this can take ~30-60s; longer than
    // that almost always means Meta is rate-limited and the next scheduled
    // loop will pick up.
    const response = await axios.post(
      `${config.agent.baseUrl}/sync/trigger`,
      {},
      { timeout: 60_000 }
    );
    res.json(response.data);
  } catch (error: any) {
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ detail: 'Sync timed out (still running in background; try again in 30s)' });
    }
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ detail: 'Cannot reach agent' });
    }
    return res.status(502).json({ detail: error.message || 'Sync trigger failed' });
  }
});

export default router;
