import { Schema, model } from 'mongoose';
const organizationSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        default: 'Excel Technologies and Services',
        maxlength: 150,
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 120,
    },
    phone: {
        type: String,
        trim: true,
        maxlength: 30,
    },
    address: {
        type: String,
        trim: true,
        maxlength: 500,
    },
    expandedLogo: {
        type: String,
        trim: true,
    },
    expandedLogoAsset: {
        type: Schema.Types.ObjectId,
        ref: 'FileAsset',
    },
    collapsedLogo: {
        type: String,
        trim: true,
    },
    collapsedLogoAsset: {
        type: Schema.Types.ObjectId,
        ref: 'FileAsset',
    },
    updatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
    },
}, { timestamps: true, versionKey: false });
export const Organization = model('Organization', organizationSchema);
