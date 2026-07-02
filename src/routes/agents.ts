import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { Agent, AdAccount, Command, CommandResult } from '../models';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { agentRateLimiter } from '../middleware';
import { generateId } from '../utils';
import { createToken } from '../utils/security';
import { config } from '../config';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/** Agent responses must never carry credentials — the plaintext token is
 *  returned exactly once (creation / rotation) via the bootstrap object. */
function sanitizeAgent(agent: any): any {
  const obj = typeof agent.toObject === 'function' ? agent.toObject() : { ...agent };
  delete obj.token;
  delete obj.token_hash;
  return obj;
}

function bootstrapFor(agentId: string, plainToken: string) {
  return {
    token: plainToken,
    docker_run: `docker run -d --name sm-agent --restart unless-stopped -e AGENT_ID=${agentId} -e AGENT_TOKEN=${plainToken} ghcr.io/seven-media/sm-agent:latest`,
  };
}

// List agents
router.get('/', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    let agents;
    if (req.user!.role === 'ADMIN') {
      agents = await Agent.find();
    } else {
      agents = await Agent.find({ user_id: req.user!.id });
    }

    res.json(agents.map(sanitizeAgent));
  } catch (error) {
    console.error('List agents error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Get agent
router.get('/:agent_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.params;
    const agent = await Agent.findOne({ id: agent_id });

    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    res.json(sanitizeAgent(agent));
  } catch (error) {
    console.error('Get agent error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Create agent
router.post('/', authenticate, requireRoles('USER', 'ADMIN'), [
  body('name').notEmpty(),
  body('user_id').optional(),
  body('allowed_ip').optional(),
  body('base_url').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_tld: false, require_protocol: true }),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, user_id, allowed_ip, base_url } = req.body;
    let agent_id = `agent-${uuidv4().substring(0, 8)}`;

    // Check if generated ID already exists
    let existingAgent = await Agent.findOne({ id: agent_id });
    while (existingAgent) {
      agent_id = `agent-${uuidv4().substring(0, 8)}`;
      existingAgent = await Agent.findOne({ id: agent_id });
    }

    const target_user_id = user_id || req.user!.id;

    // Users can only create agents for themselves
    if (req.user!.role !== 'ADMIN' && target_user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Can only create agents for yourself' });
    }

    // Generate token — the plaintext is returned once in this response and
    // never stored; only the bcrypt hash is persisted.
    const plain = require('crypto').randomBytes(24).toString('base64url');
    const token_hash = await bcrypt.hash(plain, 10);

    const agent = new Agent({
      id: agent_id,
      user_id: target_user_id,
      name,
      status: 'OFFLINE',
      allowed_ip,
      base_url,
      token_hash,
    });

    await agent.save();

    res.status(201).json({ ...sanitizeAgent(agent), bootstrap: bootstrapFor(agent.id, plain) });
  } catch (error) {
    console.error('Create agent error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Update agent
router.put('/:agent_id', authenticate, requireRoles('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.params;
    const agent = await Agent.findOne({ id: agent_id });

    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (req.body.name) agent.name = req.body.name;
    if (req.body.allowed_ip !== undefined) agent.allowed_ip = req.body.allowed_ip;
    if (req.body.base_url !== undefined) {
      const base_url = req.body.base_url;
      if (base_url && !/^https?:\/\//.test(base_url)) {
        return res.status(400).json({ detail: 'base_url must start with http:// or https://' });
      }
      agent.base_url = base_url || undefined;
    }
    await agent.save();

    res.json(sanitizeAgent(agent));
  } catch (error) {
    console.error('Update agent error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Delete agent
router.delete('/:agent_id', authenticate, requireRoles('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.params;
    const agent = await Agent.findOne({ id: agent_id });

    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    await Agent.deleteOne({ id: agent_id });
    res.json({ message: 'Agent deleted successfully' });
  } catch (error) {
    console.error('Delete agent error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Rotate agent token — for when the one-time bootstrap token is lost or
// compromised. Returns the new plaintext exactly once; only the hash persists.
router.post('/:agent_id/token:rotate', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.params;
    const agent = await Agent.findOne({ id: agent_id });

    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    const plain = require('crypto').randomBytes(24).toString('base64url');
    agent.token_hash = await bcrypt.hash(plain, 10);
    agent.token = undefined; // clear any legacy plaintext
    await agent.save();

    res.json({ ...sanitizeAgent(agent), bootstrap: bootstrapFor(agent.id, plain) });
  } catch (error) {
    console.error('Rotate agent token error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Heartbeat
router.post('/:agent_id/heartbeat', agentRateLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.params;
    const { message } = req.body;

    // Verify agent token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ detail: 'Missing token' });
    }

    const token = authHeader.substring(7);
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (!agent.token_hash) {
      return res.status(401).json({ detail: 'Agent not provisioned' });
    }

    const tokenOk = await bcrypt.compare(token, agent.token_hash);
    if (!tokenOk) {
      return res.status(401).json({ detail: 'Invalid agent token' });
    }

    agent.last_heartbeat_at = new Date();
    agent.status = 'ONLINE';
    await agent.save();

    res.json({ ok: true, message: message || '' });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Pull config
router.post('/:agent_id/config:pull', agentRateLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.params;

    // Verify agent token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ detail: 'Missing token' });
    }

    const token = authHeader.substring(7);
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (!agent.token_hash) {
      return res.status(401).json({ detail: 'Agent not provisioned' });
    }

    const tokenOk = await bcrypt.compare(token, agent.token_hash);
    if (!tokenOk) {
      return res.status(401).json({ detail: 'Invalid agent token' });
    }

    const adAccounts = await AdAccount.find({ agent_id, is_active: true });

    res.json({
      agent_id,
      version: new Date().toISOString() + 'Z',
      polling: {
        heartbeat_seconds: 30,
        commands_seconds: 60,
        config_seconds: 60,
        sync_minutes: 15,
      },
      ad_accounts: adAccounts.map(acc => ({
        id: acc.id,
        meta_ad_account_id: acc.meta_ad_account_id,
        cred_ref: acc.cred_ref,
        permissions: ['READ', 'WRITE'],
      })),
    });
  } catch (error) {
    console.error('Pull config error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Pull commands
router.post('/:agent_id/commands:pull', agentRateLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.params;

    // Verify agent token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ detail: 'Missing token' });
    }

    const token = authHeader.substring(7);
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (!agent.token_hash) {
      return res.status(401).json({ detail: 'Agent not provisioned' });
    }

    const tokenOk = await bcrypt.compare(token, agent.token_hash);
    if (!tokenOk) {
      return res.status(401).json({ detail: 'Invalid agent token' });
    }
    
    // Get account IDs for this agent
    const accounts = await AdAccount.find({ agent_id });
    const accountIds = accounts.map(acc => acc.id);

    if (accountIds.length === 0) {
      return res.json([]);
    }

    // Get QUEUED commands
    const commands = await Command.find({
      ad_account_id: { $in: accountIds },
      status: 'QUEUED',
    })
      .sort({ created_at: 1 })
      .limit(50);

    // Update to RUNNING
    for (const cmd of commands) {
      cmd.status = 'RUNNING';
      await cmd.save();
    }

    res.json(commands);
  } catch (error) {
    console.error('Pull commands error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Submit command result - need to verify agent differently
router.post('/commands/:command_id/result', agentRateLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { command_id } = req.params;
    const { started_at, finished_at, success, details } = req.body;

    const cmd = await Command.findOne({ id: command_id });
    if (!cmd) {
      return res.status(404).json({ detail: 'Command not found' });
    }

    // Verify agent is assigned to the ad account
    const account = await AdAccount.findOne({ id: cmd.ad_account_id });
    if (!account || !account.agent_id) {
      return res.status(400).json({ detail: 'Command account not assigned to agent' });
    }

    // Verify agent token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ detail: 'Missing token' });
    }

    const token = authHeader.substring(7);
    const agent = await Agent.findOne({ id: account.agent_id });
    if (!agent || !agent.token_hash) {
      return res.status(401).json({ detail: 'Agent not provisioned' });
    }

    const bcrypt = require('bcrypt');
    const tokenOk = await bcrypt.compare(token, agent.token_hash);
    if (!tokenOk) {
      return res.status(401).json({ detail: 'Invalid agent token' });
    }

    // Upsert result
    let result = await CommandResult.findOne({ command_id });
    if (result) {
      result.started_at = new Date(started_at);
      if (finished_at) result.finished_at = new Date(finished_at);
      result.success = success;
      result.details = details;
    } else {
      result = new CommandResult({
        id: generateId('crs'),
        command_id,
        started_at: new Date(started_at),
        finished_at: finished_at ? new Date(finished_at) : undefined,
        success,
        details,
      });
    }

    await result.save();

    // Update command status
    if (success === true) {
      cmd.status = 'SUCCEEDED';
    } else if (success === false) {
      cmd.status = 'FAILED';
    }
    await cmd.save();

    res.json({ ok: true });
  } catch (error) {
    console.error('Submit result error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;

