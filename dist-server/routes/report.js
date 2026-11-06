import { Router } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { success } from '../utils/api.js';
import { Visit } from '../models/Visit.js';
import { Client } from '../models/Client.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
import mongoose from 'mongoose';
export const reportRouter = Router();
reportRouter.use(requireAuth, requireRoles('SUPER_ADMIN', 'MARKETING_HEAD', 'ADMIN'));
async function teamMatch(req) {
    if (req.authUser.role !== 'MARKETING_HEAD')
        return {};
    const team = await User.find({ reportingTo: req.authUser.id, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] } }).select('_id').lean();
    return { assignedTo: { $in: team.map((item) => item._id) } };
}
reportRouter.get('/overview', async (req, res) => {
    const match = await teamMatch(req);
    const [clients, staff] = await Promise.all([
        Client.aggregate([
            { $match: { isActive: true } },
            { $lookup: { from: 'visits', let: { clientId: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$client', '$$clientId'] }, ...match } }], as: 'visits' } },
            { $project: { organisationName: 1, totalVisits: { $size: '$visits' }, completedVisits: { $size: { $filter: { input: '$visits', as: 'visit', cond: { $eq: ['$$visit.status', 'COMPLETED'] } } } } } },
            { $sort: { organisationName: 1 } },
        ]),
        User.aggregate([
            { $match: { isActive: true, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] }, ...(req.authUser.role === 'MARKETING_HEAD' ? { reportingTo: req.authUser.id } : {}) } },
            { $lookup: { from: 'visits', localField: '_id', foreignField: 'assignedTo', as: 'visits' } },
            { $project: { name: 1, email: 1, totalVisits: { $size: '$visits' }, completedVisits: { $size: { $filter: { input: '$visits', as: 'visit', cond: { $eq: ['$$visit.status', 'COMPLETED'] } } } } } },
            { $sort: { name: 1 } },
        ]),
    ]);
    return success(res, { clients, staff });
});
reportRouter.get('/clients', async (req, res) => success(res, await Client.aggregate([
    { $match: { isActive: true } },
    { $lookup: { from: 'visits', let: { clientId: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$client', '$$clientId'] }, ...(await teamMatch(req)) } }], as: 'visits' } },
    { $project: { organisationName: 1, totalVisits: { $size: '$visits' }, completedVisits: { $size: { $filter: { input: '$visits', as: 'visit', cond: { $eq: ['$$visit.status', 'COMPLETED'] } } } } } },
    { $sort: { organisationName: 1 } },
])));
reportRouter.get('/staff', async (req, res) => success(res, await User.aggregate([
    { $match: { isActive: true, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] }, ...(req.authUser.role === 'MARKETING_HEAD' ? { reportingTo: req.authUser.id } : {}) } },
    { $lookup: { from: 'visits', localField: '_id', foreignField: 'assignedTo', as: 'visits' } },
    { $project: { name: 1, email: 1, totalVisits: { $size: '$visits' }, completedVisits: { $size: { $filter: { input: '$visits', as: 'visit', cond: { $eq: ['$$visit.status', 'COMPLETED'] } } } } } },
    { $sort: { name: 1 } },
])));
async function visitReport(req, res, field) {
    const id = String(req.params[field === 'client' ? 'clientId' : 'userId']);
    if (!mongoose.isValidObjectId(id))
        throw new AppError(400, 'Invalid report filter');
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const sortField = req.query.sort === 'clientName' ? 'clientName' : req.query.sort === 'executiveName' ? 'executiveName' : 'plannedDate';
    const direction = req.query.order === 'asc' ? 1 : -1;
    const match = { [field]: new mongoose.Types.ObjectId(id), ...(await teamMatch(req)) };
    const pipeline = [
        { $match: match },
        { $lookup: { from: 'clients', localField: 'client', foreignField: '_id', as: 'client' } },
        { $unwind: '$client' },
        { $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: 'assignedTo' } },
        { $unwind: '$assignedTo' },
        { $lookup: { from: 'users', localField: 'marketingHeadAtAssignment', foreignField: '_id', as: 'marketingHead' } },
        { $unwind: { path: '$marketingHead', preserveNullAndEmptyArrays: true } },
        { $addFields: { clientName: '$client.organisationName', executiveName: '$assignedTo.name', marketingHeadName: '$marketingHead.name' } },
        { $sort: { [sortField]: direction, _id: -1 } },
        { $facet: {
                items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
                total: [{ $count: 'value' }],
            } },
    ];
    const [result] = await Visit.aggregate(pipeline);
    const total = result?.total?.[0]?.value ?? 0;
    return success(res, { items: result?.items ?? [], page, limit, total, pages: Math.ceil(total / limit) });
}
async function listVisitReport(req, res, field) {
    const filterId = field === 'client' ? req.query.clientId : req.query.staffId;
    const filter = typeof filterId === 'string' && filterId ? filterId : undefined;
    if (filter && !mongoose.isValidObjectId(filter))
        throw new AppError(400, 'Invalid report filter');
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const sortField = req.query.sort === 'clientName' ? 'clientName' : req.query.sort === 'executiveName' ? 'executiveName' : 'plannedDate';
    const direction = req.query.order === 'asc' ? 1 : -1;
    const pipeline = [
        { $match: await teamMatch(req) },
        ...(filter ? [{ $match: { [field]: new mongoose.Types.ObjectId(filter) } }] : []),
        { $lookup: { from: 'clients', localField: 'client', foreignField: '_id', as: 'client' } },
        { $unwind: '$client' },
        { $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: 'assignedTo' } },
        { $unwind: '$assignedTo' },
        { $lookup: { from: 'users', localField: 'marketingHeadAtAssignment', foreignField: '_id', as: 'marketingHead' } },
        { $unwind: { path: '$marketingHead', preserveNullAndEmptyArrays: true } },
        { $addFields: { clientName: '$client.organisationName', executiveName: '$assignedTo.name', marketingHeadName: '$marketingHead.name' } },
        { $sort: { [sortField]: direction, _id: -1 } },
        { $facet: {
                items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
                total: [{ $count: 'value' }],
            } },
    ];
    const [result] = await Visit.aggregate(pipeline);
    const total = result?.total?.[0]?.value ?? 0;
    return success(res, { items: result?.items ?? [], page, limit, total, pages: Math.ceil(total / limit) });
}
reportRouter.get('/client', async (req, res) => listVisitReport(req, res, 'client'));
reportRouter.get('/staff/records', async (req, res) => listVisitReport(req, res, 'assignedTo'));
reportRouter.get('/client/:clientId', async (req, res) => visitReport(req, res, 'client'));
reportRouter.get('/staff/:userId', async (req, res) => visitReport(req, res, 'assignedTo'));
