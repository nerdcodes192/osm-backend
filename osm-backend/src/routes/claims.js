const express   = require('express');
const Claim     = require('../models/Claim');
const SparePart = require('../models/SparePart');
const Product   = require('../models/Product');
const { auth, requireRole } = require('../middleware/auth');
const router = express.Router();

const HO_ADMIN = ['Head Office Team', 'System Administrator'];

async function rememberSparePart(name, user) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  try {
    const existing = await SparePart.findOne({ name: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (!existing) {
      await new SparePart({ name: trimmed, addedBy: user._id, addedByName: user.fullName }).save();
    }
  } catch (e) { /* non-fatal */ }
}

// Validates the submitted Brand/Category/Orion Code/Orion Description against
// the Product Master and returns the matching product (with Sub Category)
// so the server — not just the UI — enforces "only valid combinations accepted".
async function resolveProductMasterMatch({ brand, category, orionCode, orionDescription }) {
  if (!brand || !category) return { error: 'Brand and Category are required.' };
  if (!orionCode && !orionDescription) return { error: 'Either Orion Code or Orion Description must be selected.' };

  const filter = {
    brand: new RegExp(`^${String(brand).trim()}$`, 'i'),
    category: new RegExp(`^${String(category).trim()}$`, 'i'),
  };
  if (orionCode) filter.orionCode = new RegExp(`^${String(orionCode).trim()}$`, 'i');
  else filter.orionDescription = new RegExp(`^${String(orionDescription).trim()}$`, 'i');

  const match = await Product.findOne(filter);
  if (!match) return { error: 'Selected Brand/Category/Orion Code/Orion Description combination was not found in the Product Master.' };
  return { match };
}

// GET /api/claims — search/filter/sort/paginate.
// Service Coordinators only see their own branch; HO/Admin see all
// (optionally narrowed via ?branch=).
router.get('/', auth, async (req, res) => {
  try {
    const {
      search, status, resolutionStatus, brand, category, branch, location,
      startDate, endDate, tatMin, tatMax,
      page = 1, limit = 20, sortBy = 'createdAt', sortDir = 'desc'
    } = req.query;

    const filter = {};
    if (req.user.userType === 'Service Coordinator') {
      filter.branch = req.user.branch;
    } else if (branch) {
      filter.branch = branch;
    }

    if (status)           filter.status = status;
    if (resolutionStatus) filter.resolutionStatus = resolutionStatus;
    if (brand)             filter.brand = brand;
    if (category)          filter.category = category;
    if (location)          filter.location = location;
    if (startDate || endDate) {
      filter.complaintDate = {};
      if (startDate) filter.complaintDate.$gte = new Date(startDate);
      if (endDate)   filter.complaintDate.$lte = new Date(endDate);
    }
    if (search) {
      filter.$or = [
        { claimNumber:      { $regex: search, $options: 'i' } },
        { caseId:           { $regex: search, $options: 'i' } },
        { customerName:     { $regex: search, $options: 'i' } },
        { unitSerialNumber: { $regex: search, $options: 'i' } },
        { brand:             { $regex: search, $options: 'i' } },
        { orionCode:         { $regex: search, $options: 'i' } },
        { orionDescription:  { $regex: search, $options: 'i' } },
        { rma:               { $regex: search, $options: 'i' } },
      ];
    }

    const allowedSortFields = ['claimNumber', 'customerName', 'complaintDate', 'supplierApprovalDate', 'status', 'resolutionStatus', 'branch', 'createdAt'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sort = { [sortField]: sortDir === 'asc' ? 1 : -1 };

    const skip = (page - 1) * limit;
    let [claims, total] = await Promise.all([
      Claim.find(filter).sort(sort).skip(skip).limit(Number(limit)),
      Claim.countDocuments(filter)
    ]);

    // TAT filter applied post-query since it's a virtual (days between two dates)
    if (tatMin || tatMax) {
      claims = claims.filter(c => {
        const t = c.tat;
        if (t === null) return false;
        if (tatMin && t < Number(tatMin)) return false;
        if (tatMax && t > Number(tatMax)) return false;
        return true;
      });
    }

    res.json({ claims, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found.' });
    if (req.user.userType === 'Service Coordinator' && claim.branch !== req.user.branch) {
      return res.status(403).json({ error: 'You do not have access to this claim.' });
    }
    res.json(claim);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create — Service Coordinators (their own branch only) or Admin
router.post('/', auth, requireRole('Service Coordinator', 'System Administrator'), async (req, res) => {
  try {
    const { match, error } = await resolveProductMasterMatch(req.body);
    if (error) return res.status(400).json({ error });

    const branch = req.user.userType === 'Service Coordinator' ? req.user.branch : (req.body.branch || req.user.branch);
    const claim = new Claim({
      ...req.body,
      brand: match.brand,
      category: match.category,
      orionCode: match.orionCode,
      orionDescription: match.orionDescription,
      subCategory: match.subCategory,
      branch,
      createdBy: req.user._id,
      createdByName: req.user.fullName,
    });
    await claim.save();
    if (req.body.defectSpareParts) await rememberSparePart(req.body.defectSpareParts, req.user);
    res.status(201).json(claim);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update — Service Coordinators (own branch only) or Admin
router.patch('/:id', auth, requireRole('Service Coordinator', 'System Administrator'), async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found.' });
    if (req.user.userType === 'Service Coordinator' && claim.branch !== req.user.branch) {
      return res.status(403).json({ error: 'You do not have access to this claim.' });
    }

    const { branch, claimNumber, createdBy, createdByName, ...updates } = req.body;

    // Re-validate against the Product Master whenever any product field changes
    if (updates.brand || updates.category || updates.orionCode || updates.orionDescription) {
      const { match, error } = await resolveProductMasterMatch({
        brand: updates.brand ?? claim.brand,
        category: updates.category ?? claim.category,
        orionCode: updates.orionCode,
        orionDescription: updates.orionDescription,
      });
      if (error) return res.status(400).json({ error });
      updates.brand = match.brand;
      updates.category = match.category;
      updates.orionCode = match.orionCode;
      updates.orionDescription = match.orionDescription;
      updates.subCategory = match.subCategory;
    }

    Object.assign(claim, updates);
    claim.updatedBy = req.user._id;

    if (updates.defectSpareParts) await rememberSparePart(updates.defectSpareParts, req.user);

    await claim.save();
    res.json(claim);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete — Administrator only
router.delete('/:id', auth, requireRole('System Administrator'), async (req, res) => {
  try {
    const claim = await Claim.findByIdAndDelete(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found.' });
    res.json({ message: 'Claim deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export CSV
router.get('/export/csv', auth, async (req, res) => {
  try {
    const filter = req.user.userType === 'Service Coordinator' ? { branch: req.user.branch } : {};
    const claims = await Claim.find(filter).sort({ createdAt: -1 });

    const headers = ['Claim Number','Customer Name','Location','Case ID','RMA','Brand','Category','Orion Code','Orion Description','Sub Category','Defect Component','Unit Serial Number','Defect Spare Parts','Part Code','Unit Value','Supplier Name','Tracker Number','Compensation Type','Status','Resolution Status','TAT (days)','Complaint Date','Supplier Approval Date','Branch','Supply Remarks','Created By'];
    const rows = claims.map(c => [
      c.claimNumber, c.customerName, c.location, c.caseId, c.rma, c.brand, c.category, c.orionCode, c.orionDescription, c.subCategory,
      c.defectComponent, c.unitSerialNumber, c.defectSpareParts, c.partCodeNumber,
      c.unitValue, c.supplierName, c.trackerNumber, c.compensationType,
      c.status, c.resolutionStatus, c.tat ?? '', c.complaintDate?.toISOString().split('T')[0],
      c.supplierApprovalDate?.toISOString().split('T')[0], c.branch, c.supplyRemarks, c.createdByName
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${(v ?? '')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=supplier_claims.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;