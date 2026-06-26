const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema({
  previousStatus: String,
  newStatus: String,
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  changedByName: String,
  changedAt: { type: Date, default: Date.now },
  remarks: String
}, { _id: false });

const technicianHistorySchema = new mongoose.Schema({
  previousTechnicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  previousTechnicianName: String,
  newTechnicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  newTechnicianName: String,
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  changedByName: String,
  changedAt: { type: Date, default: Date.now }
}, { _id: false });

const serviceRecordSchema = new mongoose.Schema({
  serviceNumber: { type: String, unique: true },
  serviceDate: { type: Date, required: true },
  branch: { type: String, required: true },
  brand: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  orionCode: { type: String, trim: true },
  orionDescription: { type: String, required: true, trim: true },
  subCategory: { type: String, trim: true },
  technician: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true }
  },
  status: {
    type: String,
    enum: ['Opened', 'Pending', 'Closed'],
    default: 'Opened'
  },
  remarks: { type: String, trim: true },
  openedAt: { type: Date },
  closedAt: { type: Date },
  // Optional customer information
  customer: {
    dateOfPurchase: { type: Date },
    name:           { type: String, trim: true },
    address:        { type: String, trim: true },
    phone:          { type: String, trim: true }
  },
  // Optional dealer information
  dealer: {
    dateOfPurchase: { type: Date },
    name:           { type: String, trim: true },
    address:        { type: String, trim: true },
    phone:          { type: String, trim: true }
  },
  // Optional product information
  productInfo: {
    location: { type: String, trim: true },
    serialNo: { type: String, trim: true }
  },
  statusHistory: [statusHistorySchema],
  technicianHistory: [technicianHistorySchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByName: { type: String },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Auto-generate service number — uses highest existing number for the year
// to avoid collisions from deletions or concurrent inserts
serviceRecordSchema.pre('save', async function(next) {
  if (!this.serviceNumber) {
    const year = new Date().getFullYear();
    const prefix = `OSM-${year}-`;
    const Model = mongoose.model('ServiceRecord');

    // Find highest-numbered record for this year
    const last = await Model.findOne(
      { serviceNumber: { $regex: `^${prefix}` } },
      { serviceNumber: 1 },
      { sort: { serviceNumber: -1 } }
    ).lean();

    let nextNum = 1;
    if (last) {
      const parts = last.serviceNumber.split('-');
      const parsed = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(parsed)) nextNum = parsed + 1;
    }

    // Retry up to 5 times in case of a concurrent insert collision
    let attempts = 0;
    while (attempts < 5) {
      const candidate = `${prefix}${String(nextNum).padStart(5, '0')}`;
      const exists = await Model.exists({ serviceNumber: candidate });
      if (!exists) { this.serviceNumber = candidate; break; }
      nextNum++;
      attempts++;
    }

    // Last-resort fallback: timestamp+random guarantees uniqueness
    if (!this.serviceNumber) {
      this.serviceNumber = `${prefix}${Date.now().toString(36).toUpperCase()}`;
    }
  }
  if (this.status === 'Opened' && !this.openedAt) {
    this.openedAt = new Date();
  }
  if (this.status === 'Closed' && !this.closedAt) {
    this.closedAt = new Date();
  }
  next();
});

module.exports = mongoose.model('ServiceRecord', serviceRecordSchema);
