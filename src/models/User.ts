import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  id: string;
  email: string;
  password_hash: string;
  role: 'ADMIN' | 'USER';
  is_active: boolean;
  created_at: Date;
  last_login?: Date;
}

const UserSchema = new Schema<IUser>({
  id: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true, index: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['ADMIN', 'USER'], default: 'USER', required: true },
  is_active: { type: Boolean, default: true, required: true },
  created_at: { type: Date, default: Date.now, required: true },
  last_login: { type: Date },
});

export const User = mongoose.model<IUser>('User', UserSchema);

