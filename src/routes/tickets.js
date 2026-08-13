const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const os = require('os');
const MaintenanceTicket = require('../models/MaintenanceTicket');
const DrainNode = require('../models/DrainNode');

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

const resolveUpload = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    upload.array('photos', 5)(req, res, next);
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

router.patch('/:ticketId/dispatch', async (req, res) => {
  try {
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
    const uploadedFiles = req.files || [];
    if (uploadedFiles.length > 0) {
      const urls = await Promise.all(
        uploadedFiles.map(file =>
          useCloudinary ? uploadToCloudinary(file) : '/uploads/' + file.filename
        )
      );
      set.photoUrls = urls;
    } else if (req.body.photoUrls) {
      set.photoUrls = Array.isArray(req.body.photoUrls) ? req.body.photoUrls : [req.body.photoUrls];
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
    req.app.get('io').emit('ticket_resolved', ticket);
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
