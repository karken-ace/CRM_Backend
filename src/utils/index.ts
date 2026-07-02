import crypto from 'crypto';

export const generateId = (prefix: string): string => {
  return `${prefix}_${crypto.randomBytes(8).toString('base64url')}`;
};

