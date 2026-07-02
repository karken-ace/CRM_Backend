import mongoose, { Schema, Document } from 'mongoose';

export interface IAdAccount extends Document {
  id: string;
  user_id: string;
  agent_id?: string;
  meta_ad_account_id: string;
  name: string;
  cred_ref?: string;
  currency_code?: string;
  is_active: boolean;
}

const AdAccountSchema = new Schema<IAdAccount>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  agent_id: { type: String, index: true },
  meta_ad_account_id: { type: String, required: true },
  name: { type: String, required: true },
  cred_ref: { type: String },
  currency_code: { type: String },
  is_active: { type: Boolean, default: true, required: true },
});

export const AdAccount = mongoose.model<IAdAccount>('AdAccount', AdAccountSchema);

