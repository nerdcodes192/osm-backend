const express = require('express');
const Product = require('../models/Product');
const { auth, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET all custom products — available to all authenticated users
router.get('/', auth, async (req, res) => {
  try {
    const { search, brand, category } = req.query;
    const filter = {};
    if (brand)    filter.brand = { $regex: brand, $options: 'i' };
    if (category) filter.category = category;
    if (search)   filter.$or = [
      { brand:            { $regex: search, $options: 'i' } },
      { orionDescription: { $regex: search, $options: 'i' } },
      { orionCode:        { $regex: search, $options: 'i' } },
    ];
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add new product — HO Team + Admin only
router.post('/', auth, requireRole('Head Office Team', 'System Administrator'), async (req, res) => {
  try {
    const { brand, category, orionCode, orionDescription, subCategory } = req.body;
    if (!brand || !category || !orionDescription) {
      return res.status(400).json({ error: 'Brand, Category and Orion Description are required.' });
    }
    // Check for duplicate orion description
    const existing = await Product.findOne({ orionDescription: orionDescription.trim() });
    if (existing) return res.status(400).json({ error: 'A product with this Orion Description already exists.' });

    const product = new Product({
      brand, category, orionCode, orionDescription, subCategory,
      addedBy: req.user._id,
      addedByName: req.user.fullName,
    });
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE product — Admin only
router.delete('/:id', auth, requireRole('System Administrator'), async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json({ message: 'Product deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
