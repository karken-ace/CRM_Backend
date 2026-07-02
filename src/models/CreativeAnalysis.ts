import mongoose, { Schema, Document } from 'mongoose';

export interface ICreativeAnalysis extends Document {
  ad_id: string;
  video_id?: string;
  creative_name: string;
  gemini_analysis: Record<string, any>;
  created_at: Date;
}

const CreativeAnalysisSchema = new Schema<ICreativeAnalysis>({
  ad_id: { type: String, required: true, unique: true, index: true },
  video_id: { type: String },
  creative_name: { type: String, default: '' },
  gemini_analysis: { type: Schema.Types.Mixed, required: true },
  created_at: { type: Date, default: Date.now },
});

export const CreativeAnalysis = mongoose.model<ICreativeAnalysis>('CreativeAnalysis', CreativeAnalysisSchema);
