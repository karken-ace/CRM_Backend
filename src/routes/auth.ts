import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { User, PasswordReset } from '../models';
import { hashPassword, verifyPassword, createToken, decodeToken, validatePasswordPolicy, generateResetToken, sendPasswordResetEmail } from '../utils/security';
import { config } from '../config';
import { generateId } from '../utils';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ detail: 'Invalid credentials' });
    }

    user.last_login = new Date();
    await user.save();

    const access = createToken(user.id, config.jwt.accessTokenTTL, { role: user.role, email: user.email });
    const refresh = createToken(user.id, config.jwt.refreshTokenTTL);

    res.json({ access, refresh });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Refresh token
router.post('/refresh', [
  body('refresh').notEmpty(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { refresh } = req.body;
    const data = decodeToken(refresh);

    if (!data || !data.sub) {
      return res.status(401).json({ detail: 'Invalid refresh token' });
    }

    const user = await User.findOne({ id: data.sub });
    if (!user) {
      return res.status(401).json({ detail: 'User not found' });
    }

    const access = createToken(user.id, config.jwt.accessTokenTTL, { role: user.role, email: user.email });
    const newRefresh = createToken(user.id, config.jwt.refreshTokenTTL);

    res.json({ access, refresh: newRefresh });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Request password reset
router.post('/request-password-reset', [
  body('email').isEmail().normalizeEmail(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      // Don't reveal if email exists
      return res.json({ message: 'If the email exists, a reset link has been sent' });
    }

    // Invalidate any existing reset tokens
    await PasswordReset.updateMany(
      { user_id: user.id, used: false },
      { used: true }
    );

    // Create new reset token
    const token = generateResetToken();
    const resetRecord = new PasswordReset({
      id: generateId('pr'),
      user_id: user.id,
      token,
      expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      used: false,
    });
    await resetRecord.save();

    // Send email
    await sendPasswordResetEmail(user.email, token);

    res.json({ message: 'If the email exists, a reset link has been sent' });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Reset password
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, password } = req.body;

    // Validate password policy
    const policyCheck = validatePasswordPolicy(password);
    if (!policyCheck.valid) {
      return res.status(400).json({ detail: policyCheck.error });
    }

    // Find valid reset token
    const resetRecord = await PasswordReset.findOne({
      token,
      used: false,
      expires_at: { $gt: new Date() },
    });

    if (!resetRecord) {
      return res.status(400).json({ detail: 'Invalid or expired reset token' });
    }

    // Update user password
    const user = await User.findOne({ id: resetRecord.user_id });
    if (!user) {
      return res.status(400).json({ detail: 'User not found' });
    }

    user.password_hash = await hashPassword(password);
    await user.save();

    resetRecord.used = true;
    await resetRecord.save();

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;

