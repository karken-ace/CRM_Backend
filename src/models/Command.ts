import mongoose, { Schema, Document } from 'mongoose';

export interface ICommand extends Document {
  id: string;
  user_id: string;
  ad_account_id: string;
  target_type: string;
  target_id: string;
  action: string;
  payload: Record<string, any>;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  idempotency_key: string;
  created_by: string;
  created_at: Date;
}

const CommandSchema = new Schema<ICommand>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  ad_account_id: { type: String, required: true, index: true },
  target_type: { type: String, required: true },
  target_id: { type: String, required: true },
  action: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true, default: {} },
  status: { type: String, enum: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'], default: 'QUEUED', required: true },
  idempotency_key: { type: String, required: true, unique: true, index: true },
  created_by: { type: String, required: true, index: true },
  created_at: { type: Date, default: Date.now, required: true },
});

export const Command = mongoose.model<ICommand>('Command', CommandSchema);

