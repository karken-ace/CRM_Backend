import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export const hashPassword = async (plain: string): Promise<string> => {
  return bcrypt.hash(plain, 10);
};

export const verifyPassword = async (plain: string, hashed: string): Promise<boolean> => {
  try {
    return await bcrypt.compare(plain, hashed);
  } catch {
    return false;
  }
};

export const validatePasswordPolicy = (password: string): { valid: boolean; error?: string } => {
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, error: 'Password must contain at least one digit' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  return { valid: true };
};

export const generateResetToken = (): string => {
  return require('crypto').randomBytes(32).toString('base64url');
};

export const createToken = (sub: string, ttlMinutes: number, extraClaims?: Record<string, any>): string => {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    iat: now,
    exp: now + ttlMinutes * 60,
    ...extraClaims,
  };
  return jwt.sign(payload, config.jwt.secret, { algorithm: config.jwt.algorithm as jwt.Algorithm });
};

export const decodeToken = (token: string): jwt.JwtPayload | null => {
  try {
    return jwt.verify(token, config.jwt.secret, { algorithms: [config.jwt.algorithm as jwt.Algorithm] }) as jwt.JwtPayload;
  } catch {
    return null;
  }
};

export const sendPasswordResetEmail = async (email: string, resetToken: string, baseUrl: string = 'http://localhost:3000'): Promise<boolean> => {
  try {
    const { smtpServer, smtpPort, smtpUser, smtpPassword } = config.email;
    
    if (!smtpUser || !smtpPassword) {
      // For development, just log the reset link
      console.log(`Password reset link for ${email}: ${baseUrl}/reset-password?token=${resetToken}`);
      return true;
    }

    // In production, use nodemailer or similar
    // For now, just log it
    console.log(`Password reset link for ${email}: ${baseUrl}/reset-password?token=${resetToken}`);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
};

