import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { User } from '../models';
import { hashPassword, validatePasswordPolicy } from '../utils/security';
import { generateId } from '../utils';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Create user (Admin only)
router.post('/', authenticate, requireRoles('ADMIN'), [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('role').optional().isIn(['ADMIN', 'USER']),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, role = 'USER', id } = req.body;

    // Validate password policy
    const policyCheck = validatePasswordPolicy(password);
    if (!policyCheck.valid) {
      return res.status(400).json({ detail: policyCheck.error });
    }

    // Check if user exists
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ detail: 'Email already exists' });
    }

    const user = new User({
      id: id || uuidv4(),
      email,
      password_hash: await hashPassword(password),
      role,
      is_active: true,
      created_at: new Date(),
    });

    await user.save();

    const userResponse: any = user.toObject();
    delete userResponse.password_hash;

    res.status(201).json(userResponse);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// List users (Admin only)
router.get('/', authenticate, requireRoles('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const users = await User.find().sort({ created_at: -1 });
    const usersResponse = users.map(user => {
      const userObj: any = user.toObject();
      delete userObj.password_hash;
      return userObj;
    });
    res.json(usersResponse);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Delete user (Admin only)
router.delete('/:user_id', authenticate, requireRoles('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { user_id } = req.params;
    const user = await User.findOne({ id: user_id });

    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    await User.deleteOne({ id: user_id });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;

