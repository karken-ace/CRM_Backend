import mongoose, { Schema, Document } from 'mongoose';

/**
 * Ad — synced view of Meta's ad object. Scoped by agent_id + ad_set_id.
 * `creative` carries the creative object (id, thumbnail_url, etc) that
 * the dashboard uses for thumbnails and Clone Winner.
 */
export interface IAd extends Document {
  id: string;
  agent_id: string;
  user_id: string;
  ad_account_id: string;
  meta_id: string;
  ad_set_id: string;
  campaign_id?: string;
  name: string;
  status: string;
  effective_status?: string;
  creative?: Record<string, any>;
  created_time?: Date;
  updated_time?: Date;
  performance_metrics?: Record<string, any>;
  raw?: Record<string, any>;
  last_synced_at: Date;
}

const AdSchema = new Schema<IAd>({
  id: { type: String, required: true, unique: true },
  agent_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true, index: true },
  ad_account_id: { type: String, required: true, index: true },
  meta_id: { type: String, required: true, index: true },
  ad_set_id: { type: String, required: true, index: true },
  campaign_id: { type: String, index: true },
  name: { type: String, required: true },
  status: { type: String, required: true },
  effective_status: { type: String },
  creative: { type: Schema.Types.Mixed },
  created_time: { type: Date },
  updated_time: { type: Date },
  performance_metrics: { type: Schema.Types.Mixed, default: {} },
  raw: { type: Schema.Types.Mixed },
  last_synced_at: { type: Date, required: true, default: Date.now, index: true },
});

AdSchema.index({ agent_id: 1, ad_set_id: 1 });

export const Ad = mongoose.model<IAd>('Ad', AdSchema);
