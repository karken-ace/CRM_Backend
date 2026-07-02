import mongoose, { Schema, Document } from 'mongoose';

export interface IPasswordReset extends Document {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  used: boolean;
  created_at: Date;
}

const PasswordResetSchema = new Schema<IPasswordReset>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  token: { type: String, required: true, unique: true, index: true },
  expires_at: { type: Date, required: true },
  used: { type: Boolean, default: false, required: true },
  created_at: { type: Date, default: Date.now, required: true },
});

export const PasswordReset = mongoose.model<IPasswordReset>('PasswordReset', PasswordResetSchema);

