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
  statusHistory: [statusHistorySchema],
  technicianHistory: [technicianHistorySchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByName: { type: String },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Auto-generate service number
serviceRecordSchema.pre('save', async function(next) {
  if (!this.serviceNumber) {
    const count = await mongoose.model('ServiceRecord').countDocuments();
    const year = new Date().getFullYear();
    this.serviceNumber = `OSM-${year}-${String(count + 1).padStart(5, '0')}`;
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
