import mongoose, { Schema, Document } from 'mongoose';

/**
 * AdSet — synced view of Meta's ad set object. Scoped by agent_id +
 * campaign_id so reads can pull all ad sets for a campaign in one query.
 */
export interface IAdSet extends Document {
  id: string;
  agent_id: string;
  user_id: string;
  ad_account_id: string;
  meta_id: string;
  campaign_id: string;
  name: string;
  status: string;
  effective_status?: string;
  optimization_goal?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  pacing_type?: any;
  targeting?: Record<string, any>;
  created_time?: Date;
  updated_time?: Date;
  performance_metrics?: Record<string, any>;
  raw?: Record<string, any>;
  last_synced_at: Date;
}

const AdSetSchema = new Schema<IAdSet>({
  id: { type: String, required: true, unique: true },
  agent_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true, index: true },
  ad_account_id: { type: String, required: true, index: true },
  meta_id: { type: String, required: true, index: true },
  campaign_id: { type: String, required: true, index: true },
  name: { type: String, required: true },
  status: { type: String, required: true },
  effective_status: { type: String },
  optimization_goal: { type: String },
  daily_budget: { type: String },
  lifetime_budget: { type: String },
  bid_strategy: { type: String },
  pacing_type: { type: Schema.Types.Mixed },
  targeting: { type: Schema.Types.Mixed },
  created_time: { type: Date },
  updated_time: { type: Date },
  performance_metrics: { type: Schema.Types.Mixed, default: {} },
  raw: { type: Schema.Types.Mixed },
  last_synced_at: { type: Date, required: true, default: Date.now, index: true },
});

AdSetSchema.index({ agent_id: 1, campaign_id: 1 });

export const AdSet = mongoose.model<IAdSet>('AdSet', AdSetSchema);
