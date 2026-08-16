const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const os = require('os');
const MaintenanceTicket = require('../models/MaintenanceTicket');
const DrainNode = require('../models/DrainNode');
const { findEquipmentManifest, dispatchByTicketId } = require('../services/assetMatcher');

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const useCloudinary = !!(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

if (useCloudinary) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
  console.log('[CLOUDINARY] Configured for production uploads');
} else {
  console.log('[CLOUDINARY] Environment not found; falling back to local disk uploads');
}

function uploadToCloudinary(file) {
  return new Promise((resolve, reject) => {
    const cldStream = cloudinary.uploader.upload_stream(
      { resource_type: 'image' },
      async (error, result) => {
        try { await fs.promises.unlink(file.path); } catch (_) { /* ignore */ }
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    const readStream = fs.createReadStream(file.path);
    readStream.on('error', (err) => {
      fs.promises.unlink(file.path).catch(() => {});
      reject(err);
    });
    readStream.pipe(cldStream);
  });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (useCloudinary) {
      cb(null, os.tmpdir());
    } else {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    }
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image uploads are allowed'));
  }
});

const uploadFields = upload.fields([
  { name: 'beforePhotos', maxCount: 3 },
  { name: 'afterPhotos', maxCount: 3 }
]);

const resolveUpload = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    uploadFields(req, res, (err) => {
      if (err) return res.status(400).json({ success: false, error: err.message });
      next();
    });
  } else {
    next();
  }
};

router.get('/', async (req, res) => {
  try {
    const tickets = await MaintenanceTicket.find({}).sort({ createdAt: -1 }).lean();
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/active', async (req, res) => {
  try {
    const { crewName } = req.query;
    const query = { status: { $in: ['Pending', 'Dispatched'] } };
    if (crewName) query.assignedCrew = crewName;
    const ticket = await MaintenanceTicket.findOne(query).sort({ createdAt: -1 }).lean();
    if (!ticket) return res.json({ success: true, ticket: null, node: null });
    const node = await DrainNode.findOne({ nodeId: ticket.nodeId }).lean();
    res.json({ success: true, ticket, node });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:ticketId/manifest', async (req, res) => {
  try {
    const ticket = await MaintenanceTicket.findOne({ ticketId: req.params.ticketId }).lean();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const node = await DrainNode.findOne({ nodeId: ticket.nodeId }).lean();
    if (!node) return res.status(404).json({ error: 'Node not found' });
    const manifest = await findEquipmentManifest(node.location, ticket.blockageType);
    res.json({ success: true, ticketId: ticket.ticketId, ...manifest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:ticketId/dispatch', async (req, res) => {
  try {
    if (req.body.auto) {
      const { ticket } = await dispatchByTicketId(req.params.ticketId);
      req.app.get('io').emit('ticket_dispatched', ticket);
      return res.json({ success: true, ticket });
    }

    const assignedCrew = req.body.assignedCrew || 'Unit 4 - Vacuum Truck';
    const ticket = await MaintenanceTicket.findOneAndUpdate(
      { ticketId: req.params.ticketId, status: { $ne: 'Resolved' } },
      { status: 'Dispatched', assignedCrew },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket not found or already resolved' });
    req.app.get('io').emit('ticket_dispatched', ticket);
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:ticketId/resolve', resolveUpload, async (req, res) => {
  try {
    const { resolutionNotes, memberId, memberName } = req.body;
    const set = { status: 'Resolved', resolvedAt: new Date(), resolutionNotes: resolutionNotes || '' };
    const beforeFiles = (req.files && req.files['beforePhotos']) || [];
    const afterFiles = (req.files && req.files['afterPhotos']) || [];

    const uploadUrls = async (files) =>
      Promise.all(files.map(file =>
        useCloudinary ? uploadToCloudinary(file) : '/uploads/' + file.filename
      ));

    if (beforeFiles.length || afterFiles.length) {
      set.photoUrls = {
        before: await uploadUrls(beforeFiles),
        after: await uploadUrls(afterFiles)
      };
    } else if (req.body.photoUrls) {
      try {
        const parsed = JSON.parse(req.body.photoUrls);
        set.photoUrls = { before: parsed.before || [], after: parsed.after || [] };
      } catch (_) {
        set.photoUrls = { before: [], after: Array.isArray(req.body.photoUrls) ? req.body.photoUrls : [req.body.photoUrls] };
      }
    }
    if (memberId || memberName) {
      set['actionAudit.resolvedByMemberId'] = memberId || '';
      set['actionAudit.resolvedByMemberName'] = memberName || '';
    }
    const ticket = await MaintenanceTicket.findOneAndUpdate(
      { ticketId: req.params.ticketId, status: { $ne: 'Resolved' } },
      { $set: set },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket not found or already resolved' });
    if (ticket.assignedCrew) {
      updateCrewScores(ticket.assignedCrew).catch(err => console.warn('[CREW SCORE] update failed:', err.message));
    }
    req.app.get('io').emit('ticket_resolved', ticket);
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:ticketId/photos', resolveUpload, async (req, res) => {
  try {
    const beforeFiles = (req.files && req.files['beforePhotos']) || [];
    const afterFiles = (req.files && req.files['afterPhotos']) || [];

    const uploadUrls = async (files) =>
      Promise.all(files.map(file =>
        useCloudinary ? uploadToCloudinary(file) : '/uploads/' + file.filename
      ));

    const beforeUrls = beforeFiles.length ? await uploadUrls(beforeFiles) : [];
    const afterUrls = afterFiles.length ? await uploadUrls(afterFiles) : [];

    const ticket = await MaintenanceTicket.findOne({ ticketId: req.params.ticketId });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const existing = ticket.photoUrls || { before: [], after: [] };
    ticket.photoUrls = {
      before: [...(existing.before || []), ...beforeUrls],
      after: [...(existing.after || []), ...afterUrls]
    };
    await ticket.save();
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
