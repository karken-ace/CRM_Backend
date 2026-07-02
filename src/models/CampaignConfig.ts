import mongoose, { Schema, Document } from 'mongoose';

export interface ICampaignConfig extends Document {
  id: string;
  user_id: string;
  agent_id: string;
  campaign_id: string; // Meta campaign ID
  target_cpa?: number; // User-defined target cost per acquisition
  target_roas?: number; // User-defined target return on ad spend
  created_at: Date;
  updated_at: Date;
}

const CampaignConfigSchema = new Schema<ICampaignConfig>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  agent_id: { type: String, required: true, index: true },
  campaign_id: { type: String, required: true, index: true },
  target_cpa: { type: Number },
  target_roas: { type: Number },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

// Ensure unique campaign config per user/agent/campaign
CampaignConfigSchema.index({ user_id: 1, agent_id: 1, campaign_id: 1 }, { unique: true });

// Update timestamp on save
CampaignConfigSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

export const CampaignConfig = mongoose.model<ICampaignConfig>('CampaignConfig', CampaignConfigSchema);



