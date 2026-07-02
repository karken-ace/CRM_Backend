import mongoose, { Schema, Document } from 'mongoose';

export interface IAdSetRule extends Document {
  id: string;
  user_id: string;
  agent_id: string;
  campaign_id: string;
  rule_name: string;
  description?: string;
  is_active: boolean;
  execution_mode: 'AUTO' | 'MANUAL';
  filter_config: {
    conditions: Array<{
      field: string;
      operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'greater_than_or_equal' | 'less_than_or_equal' | 'between' | 'contains' | 'in' | 'not_in';
      value: any;
      value2?: any; // For 'between' operator
    }>;
    logical_operator?: 'AND' | 'OR'; // How to combine multiple conditions
  };
  action: {
    type: 'PAUSE' | 'ACTIVATE';
  };
  last_executed_at?: Date;
  execution_count: number;
  last_action?: string;
  last_matched_count?: number;
  meta_rule_id?: string; // ID of the rule on Meta's servers (if created there)
  created_at: Date;
  updated_at: Date;
}

const AdSetRuleSchema = new Schema<IAdSetRule>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  agent_id: { type: String, required: true, index: true },
  campaign_id: { type: String, required: true, index: true },
  rule_name: { type: String, required: true },
  description: { type: String },
  is_active: { type: Boolean, default: true, required: true },
  execution_mode: { type: String, enum: ['AUTO', 'MANUAL'], default: 'MANUAL', required: true },
  filter_config: {
    conditions: [{
      field: { type: String, required: true },
      operator: { 
        type: String, 
        enum: ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal', 'between', 'contains', 'in', 'not_in'],
        required: true 
      },
      value: { type: Schema.Types.Mixed, required: true },
      value2: { type: Schema.Types.Mixed }, // For 'between' operator
    }],
    logical_operator: { type: String, enum: ['AND', 'OR'], default: 'AND' },
  },
  action: {
    type: { type: String, enum: ['PAUSE', 'ACTIVATE'], required: true },
  },
  last_executed_at: { type: Date },
  execution_count: { type: Number, default: 0 },
  last_action: { type: String },
  last_matched_count: { type: Number },
  meta_rule_id: { type: String }, // ID of the rule on Meta's servers
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

// Compound index for efficient queries
AdSetRuleSchema.index({ agent_id: 1, campaign_id: 1, is_active: 1 });
AdSetRuleSchema.index({ user_id: 1, is_active: 1 });

export const AdSetRule = mongoose.model<IAdSetRule>('AdSetRule', AdSetRuleSchema);

