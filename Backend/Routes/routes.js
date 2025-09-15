import express from 'express';
import { uploadAndSendQRCodes } from '../controller/Qr.js';
import { scanQrCode } from '../controller/Scan.js';

const router = express.Router();

router.post('/send', uploadAndSendQRCodes);
router.post('/scan', scanQrCode);

export default router;
