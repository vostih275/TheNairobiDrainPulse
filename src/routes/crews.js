const express = require('express');
const router = express.Router();
const Crew = require('../models/Crew');
const { computeLeaderboard, updateCrewScores } = require('../utils/crewScorer');

function sanitizeCrew(crew) {
  return {
    _id: crew._id,
    crewName: crew.crewName,
    loginIdentifier: crew.loginIdentifier,
    members: (crew.members || []).map(m => ({
      memberId: m.memberId,
      name: m.name,
      role: m.role
    }))
  };
}

router.get('/', async (req, res) => {
  try {
    const crews = await Crew.find({}).lean();
    res.json(crews.map(sanitizeCrew));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { loginIdentifier, password } = req.body;
    if (!loginIdentifier || !password) {
      return res.status(400).json({ success: false, error: 'Crew ID and password are required' });
    }
    const crew = await Crew.findOne({ loginIdentifier }).lean();
    if (!crew) {
      return res.status(401).json({ success: false, error: 'Invalid crew ID or password' });
    }
    if (password === crew.leaderPassword) {
      const leaderMember = (crew.members || []).find(m => m.role === 'Leader') || (crew.members || [])[0];
      return res.json({ success: true, isLeader: true, crew: sanitizeCrew(crew), activeMember: leaderMember || null });
    }
    if (crew.sharedPassword && password === crew.sharedPassword) {
      return res.json({ success: true, isLeader: false, crew: sanitizeCrew(crew) });
    }
    res.status(401).json({ success: false, error: 'Invalid crew ID or password' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { crewName, loginIdentifier, leaderPassword, leaderName } = req.body;
    if (!crewName || !loginIdentifier || !leaderPassword || !leaderName) {
      return res.status(400).json({ success: false, error: 'crewName, loginIdentifier, leaderPassword, and leaderName are required' });
    }
    const existing = await Crew.findOne({ $or: [{ loginIdentifier }, { crewName }] });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Crew name or login identifier already exists' });
    }
    const crew = await Crew.create({
      crewName,
      loginIdentifier,
      leaderPassword,
      sharedPassword: null,
      members: [{ memberId: `leader-${Date.now()}`, name: leaderName, role: 'Leader' }]
    });
    res.status(201).json({ success: true, crew: sanitizeCrew(crew) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const crew = await Crew.findByIdAndDelete(req.params.id);
    if (!crew) return res.status(404).json({ success: false, error: 'Crew not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/shared-password', async (req, res) => {
  try {
    const { sharedPassword } = req.body;
    if (!sharedPassword) {
      return res.status(400).json({ success: false, error: 'sharedPassword is required' });
    }
    const crew = await Crew.findById(req.params.id);
    if (!crew) return res.status(404).json({ success: false, error: 'Crew not found' });
    crew.sharedPassword = sharedPassword;
    await crew.save();
    res.json({ success: true, crew: sanitizeCrew(crew) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/members', async (req, res) => {
  try {
    const { memberId, name, role } = req.body;
    if (!memberId || !name || !role) {
      return res.status(400).json({ success: false, error: 'memberId, name, and role are required' });
    }
    const crew = await Crew.findById(req.params.id);
    if (!crew) return res.status(404).json({ success: false, error: 'Crew not found' });
    if (crew.members.find(m => m.memberId === memberId)) {
      return res.status(409).json({ success: false, error: 'Member ID already exists in this crew' });
    }
    crew.members.push({ memberId, name, role });
    await crew.save();
    res.json({ success: true, crew: sanitizeCrew(crew) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/members/:memberId', async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id);
    if (!crew) return res.status(404).json({ success: false, error: 'Crew not found' });
    const before = crew.members.length;
    crew.members = crew.members.filter(m => m.memberId !== req.params.memberId);
    if (crew.members.length === before) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }
    await crew.save();
    res.json({ success: true, crew: sanitizeCrew(crew) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const leaderboard = await computeLeaderboard();
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/rescore', async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id);
    if (!crew) return res.status(404).json({ success: false, error: 'Crew not found' });
    const updated = await updateCrewScores(crew.crewName);
    res.json({ success: true, crew: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
