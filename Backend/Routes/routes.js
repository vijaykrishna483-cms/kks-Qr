import express from 'express';
import { uploadAndSendQRCodes } from '../controller/Qr.js';
import { scanQrCode } from '../controller/Scan.js';

const router = express.Router();

// Protect /send with a secret admin key
const adminOnly = (req, res, next) => {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden: Invalid or missing admin key' });
  }
  next();
};

router.post('/send', adminOnly, uploadAndSendQRCodes);
router.post('/scan', scanQrCode);

export default router;
