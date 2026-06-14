const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  brand:            { type: String, required: true, trim: true },
  category:         { type: String, required: true, trim: true },
  orionCode:        { type: String, trim: true },
  orionDescription: { type: String, required: true, trim: true },
  subCategory:      { type: String, trim: true },
  addedBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedByName:      { type: String, trim: true },
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
