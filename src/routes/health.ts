import { Router, Response } from 'express';

const router = Router();

router.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

router.get('/readyz', (req, res) => {
  res.json({ ready: true });
});

export default router;

