import mongoose, { Schema, Document } from 'mongoose';

export interface IConceptCache extends Document {
  ad_id: string;
  date_range: string;
  concepts_json: Record<string, any>;
  created_at: Date;
  expires_at: Date;
}

const ConceptCacheSchema = new Schema<IConceptCache>({
  ad_id: { type: String, required: true, index: true },
  date_range: { type: String, default: 'last_30d' },
  concepts_json: { type: Schema.Types.Mixed, required: true },
  created_at: { type: Date, default: Date.now },
  expires_at: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, // 30 days
});

// Compound index for cache lookups
ConceptCacheSchema.index({ ad_id: 1, date_range: 1 }, { unique: true });

// TTL index — MongoDB automatically deletes expired documents
ConceptCacheSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const ConceptCache = mongoose.model<IConceptCache>('ConceptCache', ConceptCacheSchema);
