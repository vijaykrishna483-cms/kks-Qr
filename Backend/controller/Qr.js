import xlsx from 'xlsx';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pool } from './../utils/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const uploadAndSendQRCodes = async (req, res) => {
  try {
    // 1️⃣ Read Excel File
    const workbook = xlsx.readFile(path.join(__dirname, '../kksDb.xlsx'));
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // 2️⃣ Setup Gmail SMTP
    console.log( process.env.GMAIL_USER);
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS, // App Password
      },
    });

    for (const row of sheetData) {
      const { id, name, email, count, kksid: kks_id } = row;

      const uuid = uuidv4();

      await pool.query(
        `INSERT INTO qr_codes (name, email, uuid, used, kks_id, count)
         VALUES ($1, $2, $3, false, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [name, email, uuid, kks_id, count]
      );

      const qrData = `UUID:${uuid}`;
      const qrImage = await QRCode.toDataURL(qrData);
      const qrBuffer = Buffer.from(qrImage.split(',')[1], 'base64');

      await transporter.sendMail({
        from: `"QR Service" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Your Unique QR Code',
        text: `Hi ${name},

Please find attached your unique QR code.
Count: ${count}

Regards,
QR Service`,
        attachments: [
          {
            filename: `qrcode-${id}.png`,
            content: qrBuffer,
            encoding: 'base64',
          },
        ],
      });

      console.log(`✅ QR sent to ${email}`);
    }

    res.status(200).json({ message: 'QRs saved in DB and mailed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process QR codes' });
  }
};
