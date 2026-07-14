const express    = require('express');
const SparePart  = require('../models/SparePart');
const { auth }   = require('../middleware/auth');
const router = express.Router();

// GET /api/spare-parts?search=... — used to populate the searchable
// autocomplete dropdown (Service Job Closure "Spare Part Used" and Claim
// "Defect Spare Parts").
router.get('/', auth, async (req, res) => {
  try {
    const { search, limit = 200 } = req.query;
    const filter = {};
    if (search) filter.name = { $regex: search, $options: 'i' };
    const parts = await SparePart.find(filter).sort({ name: 1 }).limit(Number(limit));
    res.json({ parts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/spare-parts — adds a new spare part to the master list if it
// doesn't already exist (case-insensitive). Any authenticated user can add
// one — this is how manually-typed entries get remembered for next time.
router.post('/', auth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Spare part name is required.' });

    const existing = await SparePart.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
    if (existing) return res.json(existing);

    const part = new SparePart({ name, addedBy: req.user._id, addedByName: req.user.fullName });
    await part.save();
    res.status(201).json(part);
  } catch (err) {
    // Unique-index race — another request created it first; just return it.
    if (err.code === 11000) {
      const existing = await SparePart.findOne({ name: new RegExp(`^${req.body.name}$`, 'i') });
      if (existing) return res.json(existing);
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
