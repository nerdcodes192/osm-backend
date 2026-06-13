const express = require('express');
const ServiceRecord = require('../models/ServiceRecord');
const { auth, requireRole } = require('../middleware/auth');
const router = express.Router();

// Get all service records
router.get('/', auth, async (req, res) => {
  try {
    const { status, branch, brand, category, search, page = 1, limit = 20, startDate, endDate } = req.query;
    const filter = {};

    // Branch filter: coordinators/technicians only see their branch
    if (['Service Coordinator', 'Service Technician', 'Branch User'].includes(req.user.userType)) {
      filter.branch = req.user.branch;
    } else if (branch) {
      filter.branch = branch;
    }

    if (status) filter.status = status;
    if (brand) filter.brand = brand;
    if (category) filter.category = category;
    if (startDate || endDate) {
      filter.serviceDate = {};
      if (startDate) filter.serviceDate.$gte = new Date(startDate);
      if (endDate) filter.serviceDate.$lte = new Date(endDate);
    }
    if (search) {
      filter.$or = [
        { serviceNumber: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { orionDescription: { $regex: search, $options: 'i' } },
        { 'technician.name': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    const [records, total] = await Promise.all([
      ServiceRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit))
        .populate('createdBy', 'fullName'),
      ServiceRecord.countDocuments(filter)
    ]);

    res.json({ records, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get dashboard stats
router.get('/stats/dashboard', auth, async (req, res) => {
  try {
    const branchFilter = ['Service Coordinator', 'Service Technician', 'Branch User'].includes(req.user.userType)
      ? { branch: req.user.branch } : {};

    const [total, opened, pending, closed] = await Promise.all([
      ServiceRecord.countDocuments(branchFilter),
      ServiceRecord.countDocuments({ ...branchFilter, status: 'Opened' }),
      ServiceRecord.countDocuments({ ...branchFilter, status: 'Pending' }),
      ServiceRecord.countDocuments({ ...branchFilter, status: 'Closed' })
    ]);

    // By branch (HO only)
    let byBranch = [];
    if (['Head Office Team', 'System Administrator'].includes(req.user.userType)) {
      byBranch = await ServiceRecord.aggregate([
        { $group: { _id: '$branch', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);
    }

    // Monthly trend (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);

    const monthlyTrend = await ServiceRecord.aggregate([
      { $match: { ...branchFilter, createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        count: { $sum: 1 }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // By category
    const byCategory = await ServiceRecord.aggregate([
      { $match: branchFilter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({ total, opened, pending, closed, byBranch, monthlyTrend, byCategory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single service record
router.get('/:id', auth, async (req, res) => {
  try {
    const record = await ServiceRecord.findById(req.params.id).populate('createdBy', 'fullName');
    if (!record) return res.status(404).json({ error: 'Record not found.' });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create service record
router.post('/', auth, requireRole('Service Coordinator'), async (req, res) => {
  try {
    const record = new ServiceRecord({
      ...req.body,
      branch: req.user.branch,
      createdBy: req.user._id,
      createdByName: req.user.fullName,
      status: 'Opened',
      openedAt: new Date(),
      statusHistory: [{
        previousStatus: null,
        newStatus: 'Opened',
        changedBy: req.user._id,
        changedByName: req.user.fullName,
        changedAt: new Date()
      }]
    });
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update service record
router.patch('/:id', auth, requireRole('Service Coordinator', 'Head Office Team', 'System Administrator'), async (req, res) => {
  try {
    const record = await ServiceRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found.' });

    const { status, remarks, ...otherUpdates } = req.body;

    if (status && status !== record.status) {
      record.statusHistory.push({
        previousStatus: record.status,
        newStatus: status,
        changedBy: req.user._id,
        changedByName: req.user.fullName,
        changedAt: new Date(),
        remarks: remarks || ''
      });
      record.status = status;
      if (status === 'Opened' && !record.openedAt) record.openedAt = new Date();
      if (status === 'Closed' && !record.closedAt) record.closedAt = new Date();
    }

    if (remarks !== undefined) record.remarks = remarks;
    Object.assign(record, otherUpdates);
    record.updatedBy = req.user._id;

    await record.save();
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export records
router.get('/export/csv', auth, async (req, res) => {
  try {
    const branchFilter = ['Service Coordinator', 'Service Technician', 'Branch User'].includes(req.user.userType)
      ? { branch: req.user.branch } : {};
    const records = await ServiceRecord.find(branchFilter).sort({ createdAt: -1 });

    const headers = ['Service No', 'Date', 'Branch', 'Brand', 'Category', 'Orion Code', 'Orion Description', 'Sub-Category', 'Technician', 'Status', 'Opened At', 'Closed At', 'Remarks'];
    const rows = records.map(r => [
      r.serviceNumber, r.serviceDate?.toISOString().split('T')[0], r.branch,
      r.brand, r.category, r.orionCode, r.orionDescription, r.subCategory,
      r.technician?.name, r.status, r.openedAt?.toISOString(), r.closedAt?.toISOString(), r.remarks
    ]);

    const csv = [headers, ...rows].map(row => row.map(v => `"${v || ''}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=osm_records.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
