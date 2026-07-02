import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  id: string;
  user_id: string;
  agent_id: string;
  campaign_id?: string;
  type: 'critical' | 'warning' | 'scale' | 'info' | 'success';
  title: string;
  message: string;
  detail?: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  source: 'optimization' | 'rule' | 'system' | 'manual';
  related_entity_id?: string;
  related_entity_name?: string;
  actions?: Array<{ label: string; action_type: string; params?: Record<string, any> }>;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: Date;
  updated_at: Date;
}

const NotificationSchema = new Schema<INotification>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  agent_id: { type: String, required: true, index: true },
  campaign_id: { type: String },
  type: { type: String, enum: ['critical', 'warning', 'scale', 'info', 'success'], required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  detail: { type: String },
  priority: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], required: true },
  source: { type: String, enum: ['optimization', 'rule', 'system', 'manual'], required: true },
  related_entity_id: { type: String },
  related_entity_name: { type: String },
  actions: [{
    label: { type: String, required: true },
    action_type: { type: String, required: true },
    params: { type: Schema.Types.Mixed },
  }],
  is_read: { type: Boolean, default: false },
  is_dismissed: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

// Compound indexes for efficient queries
NotificationSchema.index({ user_id: 1, is_read: 1, created_at: -1 });
NotificationSchema.index({ agent_id: 1, created_at: -1 });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
