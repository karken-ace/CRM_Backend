import { Router, Response } from 'express';
import { body, validationResult, query } from 'express-validator';
import { Command, AdAccount } from '../models';
import { authenticate, AuthRequest } from '../middleware/auth';
import { generateId } from '../utils';

const router = Router();

// Create command
router.post('/', authenticate, [
  body('ad_account_id').notEmpty(),
  body('target_type').notEmpty(),
  body('target_id').notEmpty(),
  body('action').notEmpty(),
  body('payload').isObject(),
  body('idempotency_key').notEmpty(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { ad_account_id, target_type, target_id, action, payload, idempotency_key } = req.body;

    // Ensure user owns the ad account or is admin
    const account = await AdAccount.findOne({ id: ad_account_id });
    if (!account) {
      return res.status(404).json({ detail: 'Ad account not found' });
    }

    if (req.user!.role !== 'ADMIN' && account.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Forbidden' });
    }

    // Idempotency: if exists by idempotency_key, return existing
    const existing = await Command.findOne({ idempotency_key });
    if (existing) {
      return res.json(existing);
    }

    const command = new Command({
      id: generateId('cmd'),
      user_id: account.user_id,
      ad_account_id,
      target_type,
      target_id,
      action,
      payload: payload || {},
      status: 'QUEUED',
      idempotency_key,
      created_by: req.user!.id,
      created_at: new Date(),
    });

    await command.save();
    res.status(201).json(command);
  } catch (error) {
    console.error('Create command error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// List commands
router.get('/', authenticate, [
  query('status_eq').optional(),
], async (req: AuthRequest, res: Response) => {
  try {
    const { status_eq } = req.query;

    let query: any = {};
    if (req.user!.role !== 'ADMIN') {
      query.user_id = req.user!.id;
    }
    if (status_eq) {
      query.status = status_eq;
    }

    const commands = await Command.find(query)
      .sort({ created_at: -1 })
      .limit(200);

    res.json(commands);
  } catch (error) {
    console.error('List commands error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Get command
router.get('/:command_id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { command_id } = req.params;
    const command = await Command.findOne({ id: command_id });

    if (!command) {
      return res.status(404).json({ detail: 'Not found' });
    }

    if (req.user!.role !== 'ADMIN' && command.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Forbidden' });
    }

    res.json(command);
  } catch (error) {
    console.error('Get command error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;

