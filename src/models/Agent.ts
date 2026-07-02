import mongoose, { Schema, Document } from 'mongoose';

export interface IAgent extends Document {
  id: string;
  user_id: string;
  name: string;
  status: string;
  last_heartbeat_at?: Date;
  allowed_ip?: string;
  token?: string;
  token_hash?: string;
}

const AgentSchema = new Schema<IAgent>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  name: { type: String, required: true },
  status: { type: String, default: 'OFFLINE', required: true },
  last_heartbeat_at: { type: Date },
  allowed_ip: { type: String },
  token: { type: String },
  token_hash: { type: String },
});

export const Agent = mongoose.model<IAgent>('Agent', AgentSchema);

