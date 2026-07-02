import mongoose, { Schema, Document } from 'mongoose';

export interface ICommandResult extends Document {
  id: string;
  command_id: string;
  started_at: Date;
  finished_at?: Date;
  success?: boolean;
  details?: Record<string, any>;
}

const CommandResultSchema = new Schema<ICommandResult>({
  id: { type: String, required: true, unique: true },
  command_id: { type: String, required: true, unique: true, index: true },
  started_at: { type: Date, required: true },
  finished_at: { type: Date },
  success: { type: Boolean },
  details: { type: Schema.Types.Mixed },
});

export const CommandResult = mongoose.model<ICommandResult>('CommandResult', CommandResultSchema);

