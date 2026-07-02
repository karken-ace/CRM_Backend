import { Request, Response, NextFunction } from 'express';
import { decodeToken } from '../utils/security';
import { User, Agent } from '../models';
import { verifyPassword } from '../utils/security';

export interface AuthRequest extends Request {
  user?: any;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ detail: 'Missing token' });
      return;
    }

    const token = authHeader.substring(7);
    const data = decodeToken(token);
    
    if (!data || !data.sub) {
      res.status(401).json({ detail: 'Invalid token' });
      return;
    }

    const user = await User.findOne({ id: data.sub });
    if (!user || !user.is_active) {
      res.status(401).json({ detail: 'Inactive or missing user' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ detail: 'Authentication failed' });
  }
};

export const requireRoles = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ detail: 'Forbidden' });
      return;
    }

    next();
  };
};

export const verifyAgentRequest = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const agentId = req.params.agent_id || req.params.command_id?.split('/')[0];
    if (!agentId) {
      res.status(400).json({ detail: 'Agent ID required' });
      return;
    }

    const agent = await Agent.findOne({ id: agentId });
    if (!agent) {
      res.status(404).json({ detail: 'Agent not found' });
      return;
    }

    // Check IP allowlist if configured
    if (agent.allowed_ip && req.ip !== agent.allowed_ip) {
      res.status(403).json({ detail: 'IP not allowed' });
      return;
    }

    // Verify agent token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ detail: 'Missing token' });
      return;
    }

    const token = authHeader.substring(7);
    
    if (!agent.token_hash) {
      res.status(401).json({ detail: 'Agent not provisioned' });
      return;
    }

    const tokenOk = await verifyPassword(token, agent.token_hash);
    if (!tokenOk) {
      res.status(401).json({ detail: 'Invalid agent token' });
      return;
    }

    req.user = agent;
    next();
  } catch (error) {
    res.status(401).json({ detail: 'Agent authentication failed' });
  }
};

