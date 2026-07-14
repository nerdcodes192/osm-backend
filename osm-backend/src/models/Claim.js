const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema({
  claimNumber: { type: String, unique: true }, // CLM-YYYY-000001, resets yearly

  // Customer / case information
  customerName: { type: String, trim: true, required: true },
  location:     { type: String, enum: ['SVC', 'Factory'], required: true },
  caseId:       { type: String, trim: true },
  rma:          { type: String, trim: true },

  // Technical information — Product Master hierarchy (Brand -> Category ->
  // Orion Code / Orion Description, kept in sync -> Sub Category auto-filled).
  // Only valid Product Master combinations are accepted; no manual entry.
  brand:             { type: String, trim: true, required: true },
  category:          { type: String, trim: true, required: true },
  orionCode:         { type: String, trim: true },
  orionDescription:  { type: String, trim: true },
  subCategory:       { type: String, trim: true },
  defectComponent:  { type: String, trim: true },
  unitSerialNumber: { type: String, trim: true },
  defectSpareParts: { type: String, trim: true }, // searchable dropdown w/ manual entry, saved to SparePart master
  partCodeNumber:   { type: String, trim: true },
  defectPhotos:     [{ type: String }], // stored as data URLs / uploaded image URLs

  // Status information
  status:           { type: String, enum: ['Accepted', 'Rejected'], default: 'Accepted' },
  resolutionStatus: { type: String, enum: ['Active', 'Closed'], default: 'Active' },
  supplyRemarks:    { type: String, trim: true },

  complaintDate:  { type: Date, required: true },
  resolutionDate: { type: Date }, // auto-filled when Resolution Status -> Closed, if blank
  // TAT is derived (Resolution Date − Complaint Date), stored in days, read-only

  branch:          { type: String, required: true },
  createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByName:   { type: String },
  createdByDesignation: { type: String, default: 'Service Coordinator' },
  updatedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

claimSchema.index({ branch: 1 });
claimSchema.index({ status: 1 });
claimSchema.index({ resolutionStatus: 1 });
claimSchema.index({ createdAt: -1 });
claimSchema.index({ branch: 1, resolutionStatus: 1, createdAt: -1 });

// Virtual — TAT in whole days, only meaningful once Closed with a resolution date
claimSchema.virtual('tat').get(function () {
  if (this.resolutionStatus !== 'Closed' || !this.resolutionDate || !this.complaintDate) return null;
  const ms = new Date(this.resolutionDate) - new Date(this.complaintDate);
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
});
claimSchema.set('toJSON', { virtuals: true });
claimSchema.set('toObject', { virtuals: true });

// Auto-generate claim number — sequential per calendar year, resets yearly
claimSchema.pre('save', async function (next) {
  if (!this.orionCode && !this.orionDescription) {
    return next(new Error('Either Orion Code or Orion Description must be selected.'));
  }
  if (!this.claimNumber) {
    const year = new Date().getFullYear();
    const prefix = `CLM-${year}-`;
    const Model = mongoose.model('Claim');

    const last = await Model.findOne(
      { claimNumber: { $regex: `^${prefix}` } },
      { claimNumber: 1 },
      { sort: { claimNumber: -1 } }
    ).lean();

    let nextNum = 1;
    if (last) {
      const parts = last.claimNumber.split('-');
      const parsed = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(parsed)) nextNum = parsed + 1;
    }

    let attempts = 0;
    while (attempts < 5) {
      const candidate = `${prefix}${String(nextNum).padStart(6, '0')}`;
      const exists = await Model.exists({ claimNumber: candidate });
      if (!exists) { this.claimNumber = candidate; break; }
      nextNum++;
      attempts++;
    }
    if (!this.claimNumber) {
      this.claimNumber = `${prefix}${Date.now().toString(36).toUpperCase()}`;
    }
  }

  // Resolution/TAT logic — auto-fill resolution date when moved to Closed
  if (this.resolutionStatus === 'Closed' && !this.resolutionDate) {
    this.resolutionDate = new Date();
  }
  if (this.resolutionStatus === 'Active') {
    this.resolutionDate = undefined;
  }

  next();
});

module.exports = mongoose.model('Claim', claimSchema);
