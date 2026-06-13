const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, mobileNumber, jobRole, branch, userType, reportingCoordinator, password } = req.body;

    if (email) {
      const existing = await User.findOne({ email });
      if (existing) return res.status(400).json({ error: 'Email already registered.' });
    }

    const user = new User({
      fullName, email, mobileNumber, jobRole, branch, userType,
      reportingCoordinator: reportingCoordinator || undefined,
      password: password || undefined,
      status: 'Pending'
    });

    await user.save();
    res.status(201).json({ message: 'Registration submitted. Awaiting approval.', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid email or password.' });
    if (user.status === 'Pending') return res.status(403).json({ error: 'Account pending approval.' });
    if (user.status === 'Rejected') return res.status(403).json({ error: 'Account rejected.' });
    if (!user.password) return res.status(400).json({ error: 'No password set for this account.' });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(400).json({ error: 'Invalid email or password.' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  res.json(req.user);
});

module.exports = router;
