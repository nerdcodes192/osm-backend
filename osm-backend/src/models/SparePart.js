const mongoose = require('mongoose');

// Master list of spare part names. New entries typed into the "Spare Part
// Used" autocomplete (on Service Job Closure or a Claim's Defect Spare
// Parts field) are saved here automatically so they show up for future
// searches — mirrors the Product master pattern.
const sparePartSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true, unique: true },
  addedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedByName: { type: String, trim: true },
}, { timestamps: true });

sparePartSchema.index({ name: 1 });

module.exports = mongoose.model('SparePart', sparePartSchema);
