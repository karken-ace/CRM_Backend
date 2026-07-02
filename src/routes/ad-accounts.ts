import { Router, Response } from 'express';
import { body, validationResult, query } from 'express-validator';
import { AdAccount, Campaign } from '../models';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Create ad account
router.post('/', authenticate, [
  body('id').notEmpty(),
  body('user_id').notEmpty(),
  body('meta_ad_account_id').notEmpty(),
  body('name').notEmpty(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id, user_id, agent_id, meta_ad_account_id, name, cred_ref, currency_code, is_active = true } = req.body;

    // Admin can create for any user; regular user only for self
    if (req.user!.role !== 'ADMIN' && user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Forbidden' });
    }

    // Check if ID exists
    const exists = await AdAccount.findOne({ id });
    if (exists) {
      return res.status(400).json({ detail: 'ID exists' });
    }

    const account = new AdAccount({
      id,
      user_id,
      agent_id,
      meta_ad_account_id,
      name,
      cred_ref,
      currency_code,
      is_active,
    });

    await account.save();
    res.status(201).json(account);
  } catch (error) {
    console.error('Create ad account error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// List ad accounts
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    let accounts;
    if (req.user!.role === 'ADMIN') {
      accounts = await AdAccount.find().sort({ name: 1 });
    } else {
      accounts = await AdAccount.find({ user_id: req.user!.id }).sort({ name: 1 });
    }
    res.json(accounts);
  } catch (error) {
    console.error('List ad accounts error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Get ad account
router.get('/:ad_account_id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { ad_account_id } = req.params;
    const account = await AdAccount.findOne({ id: ad_account_id });

    if (!account) {
      return res.status(404).json({ detail: 'Not found' });
    }

    if (req.user!.role !== 'ADMIN' && account.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Forbidden' });
    }

    res.json(account);
  } catch (error) {
    console.error('Get ad account error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// List campaigns
router.get('/campaigns', authenticate, [
  query('ad_account_id').notEmpty(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { ad_account_id } = req.query;

    // Ensure ownership
    const account = await AdAccount.findOne({ id: ad_account_id as string });
    if (!account) {
      return res.status(404).json({ detail: 'Account not found' });
    }

    if (req.user!.role !== 'ADMIN' && account.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Forbidden' });
    }

    const campaigns = await Campaign.find({ ad_account_id: ad_account_id as string });
    res.json(campaigns.map(c => ({
      id: c.id,
      ad_account_id: c.ad_account_id,
      meta_id: c.meta_id,
      name: c.name,
      status: c.status,
    })));
  } catch (error) {
    console.error('List campaigns error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;

