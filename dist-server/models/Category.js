import { Schema, model } from 'mongoose';
const categorySchema = new Schema({
    name: { type: String, required: true, trim: true, maxlength: 100 },
    normalizedName: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });
export const Category = model('Category', categorySchema);
