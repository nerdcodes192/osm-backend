const express = require('express');
const User = require('../models/User');
const { auth, requireRole } = require('../middleware/auth');
const router = express.Router();

// Get all users (HO Team + Admin)
router.get('/', auth, requireRole('Head Office Team', 'System Administrator'), async (req, res) => {
  try {
    const { status, userType, branch, search } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (userType) filter.userType = userType;
    if (branch) filter.branch = branch;
    if (search) filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
    const users = await User.find(filter).populate('reportingCoordinator', 'fullName').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pending registrations
router.get('/pending', auth, requireRole('Head Office Team', 'System Administrator'), async (req, res) => {
  try {
    const users = await User.find({ status: 'Pending' }).sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get technicians by branch (for service coordinator)
router.get('/technicians', auth, async (req, res) => {
  try {
    const branch = req.query.branch || req.user.branch;
    const technicians = await User.find({
      userType: 'Service Technician',
      status: 'Approved',
      branch
    }).select('fullName mobileNumber branch');
    res.json(technicians);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get coordinators by branch
router.get('/coordinators', async (req, res) => {
  try {
    const { branch } = req.query;
    const filter = { userType: 'Service Coordinator', status: 'Approved' };
    if (branch) filter.branch = branch;
    const coordinators = await User.find(filter).select('fullName branch');
    res.json(coordinators);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve user
router.patch('/:id/approve', auth, requireRole('Head Office Team', 'System Administrator'), async (req, res) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.status = 'Approved';
    user.approvedBy = req.user._id;
    user.approvedAt = new Date();
    if (password) user.password = password;

    await user.save();
    res.json({ message: 'User approved.', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject user
router.patch('/:id/reject', auth, requireRole('Head Office Team', 'System Administrator'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    user.status = 'Rejected';
    user.rejectionReason = req.body.reason || '';
    await user.save();
    res.json({ message: 'User rejected.', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user
router.patch('/:id', auth, requireRole('System Administrator'), async (req, res) => {
  try {
    const updates = req.body;
    delete updates.password;
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats for dashboard
router.get('/stats/summary', auth, requireRole('Head Office Team', 'System Administrator'), async (req, res) => {
  try {
    const [total, pending, approved, rejected] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: 'Pending' }),
      User.countDocuments({ status: 'Approved' }),
      User.countDocuments({ status: 'Rejected' })
    ]);
    res.json({ total, pending, approved, rejected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
