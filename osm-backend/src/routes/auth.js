const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const router = express.Router();

// Register — password now set by user at registration
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, mobileNumber, jobRole, branch, userType, reportingCoordinator, password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    if (email) {
      const existing = await User.findOne({ email });
      if (existing) return res.status(400).json({ error: 'Email already registered.' });
    }

    if (mobileNumber) {
      const existingMobile = await User.findOne({ mobileNumber });
      if (existingMobile) return res.status(400).json({ error: 'Mobile number already registered.' });
    }

    const user = new User({
      fullName, email, mobileNumber, jobRole, branch, userType,
      reportingCoordinator: reportingCoordinator || undefined,
      password,
      status: 'Pending'
    });

    await user.save();
    res.status(201).json({ message: 'Registration submitted. Awaiting approval.', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login — supports email OR mobile number
router.post('/login', async (req, res) => {
  try {
    const { email, mobileNumber, password } = req.body;

    if (!password) return res.status(400).json({ error: 'Password is required.' });
    if (!email && !mobileNumber) return res.status(400).json({ error: 'Email or mobile number is required.' });

    let user = null;
    if (email) {
      user = await User.findOne({ email });
    } else if (mobileNumber) {
      user = await User.findOne({ mobileNumber });
    }

    if (!user) {
      return res.status(400).json({ error: `No account found with this ${email ? 'email' : 'mobile number'}.` });
    }
    if (user.status === 'Pending')  return res.status(403).json({ error: 'Your account is pending approval by Head Office.' });
    if (user.status === 'Rejected') return res.status(403).json({ error: 'Your account has been rejected. Contact Head Office.' });
    if (!user.password)             return res.status(400).json({ error: 'No password set. Contact Head Office.' });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials.' });

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
