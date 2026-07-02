import mongoose, { Schema, Document } from 'mongoose';

export interface IDailyMetric extends Document {
  id: string;
  user_id: string;
  ad_account_id: string;
  campaign_id?: string;
  ad_set_id?: string;
  ad_id?: string;
  date: Date;
  impressions: number;
  clicks: number;
  spend_minor: number;
  conversions: number;
}

const DailyMetricSchema = new Schema<IDailyMetric>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  ad_account_id: { type: String, required: true, index: true },
  campaign_id: { type: String, index: true },
  ad_set_id: { type: String, index: true },
  ad_id: { type: String, index: true },
  date: { type: Date, required: true, index: true },
  impressions: { type: Number, default: 0, required: true },
  clicks: { type: Number, default: 0, required: true },
  spend_minor: { type: Number, default: 0, required: true },
  conversions: { type: Number, default: 0, required: true },
});

export const DailyMetric = mongoose.model<IDailyMetric>('DailyMetric', DailyMetricSchema);

