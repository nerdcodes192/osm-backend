const mongoose = require('mongoose');

const importHistorySchema = new mongoose.Schema({
  fileName:        { type: String, required: true },
  importedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  importedByName:  { type: String, required: true },
  totalRecords:    { type: Number, default: 0 },
  newProducts:     { type: Number, default: 0 },
  updatedProducts: { type: Number, default: 0 },
  failedRecords:   { type: Number, default: 0 },
  status:          { type: String, enum: ['success', 'failed'], default: 'success' },
}, { timestamps: true });

module.exports = mongoose.model('ImportHistory', importHistorySchema);