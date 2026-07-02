import mongoose, { Schema, Document } from 'mongoose';

export interface IMetricSnapshot extends Document {
  id: string;
  user_id: string;
  ad_account_id: string;
  campaign_id?: string;
  ad_set_id?: string;
  ad_id?: string;
  ts: Date;
  impressions: number;
  clicks: number;
  spend_minor: number;
  conversions: number;
}

const MetricSnapshotSchema = new Schema<IMetricSnapshot>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  ad_account_id: { type: String, required: true, index: true },
  campaign_id: { type: String, index: true },
  ad_set_id: { type: String, index: true },
  ad_id: { type: String, index: true },
  ts: { type: Date, required: true, index: true },
  impressions: { type: Number, default: 0, required: true },
  clicks: { type: Number, default: 0, required: true },
  spend_minor: { type: Number, default: 0, required: true },
  conversions: { type: Number, default: 0, required: true },
});

// Compound index for efficient queries
MetricSnapshotSchema.index({ user_id: 1, ad_account_id: 1, campaign_id: 1, ad_set_id: 1, ad_id: 1, ts: 1 });

export const MetricSnapshot = mongoose.model<IMetricSnapshot>('MetricSnapshot', MetricSnapshotSchema);

