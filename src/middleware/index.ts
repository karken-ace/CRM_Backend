import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

// Request logging middleware
export const requestLogging = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const method = req.method;
  const path = req.path;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    console.log(`${clientIp} ${method} ${path} ${statusCode} ${duration}ms`);
  });

  next();
};

// Rate limiters
// Agent-facing endpoints sit behind nginx, so every agent's request arrives
// from the same proxy IP — keying by IP would make the whole fleet share one
// bucket. Key by the agent_id path param instead (falling back to IP for
// routes without it, e.g. metrics ingest), and set a per-agent ceiling that
// comfortably covers heartbeat (1/min) + config/commands polling incl. the
// 5s startup burst before backoff.
export const agentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many requests from this agent',
  // Key by agent_id (all agents share the nginx proxy IP). Fall back to IP for
  // routes without the param (metrics ingest). validate disabled because the
  // custom key uses req.ip directly in the fallback.
  validate: false,
  keyGenerator: (req: Request) => {
    const id = req.params?.agent_id;
    return id ? `agent:${id}` : (req.ip ?? 'unknown');
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many authentication attempts',
});

export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests',
});

