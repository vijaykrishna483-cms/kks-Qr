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

    // 2️⃣ Setup Brevo
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      auth: {
        user: process.env.BREVO_USER,   // 🔑 Replace with your Brevo login email
        pass: process.env.BREVO_API_KEY,   
      },
    });

    for (const row of sheetData) {
      const { id, name, email } = row;

      // ✅ Generate unique UUID for DB
      const uuid = uuidv4();

      // ✅ Insert into DB with used=false
      await pool.query(
        `INSERT INTO qr_codes (name, email, uuid, used)
         VALUES ($1, $2, $3, false)
         ON CONFLICT (email) DO NOTHING`,
        [name, email, uuid]
      );

      // ✅ Create QR with UUID
      const qrData = `UUID:${uuid}`;
      const qrImage = await QRCode.toDataURL(qrData);
      const qrBuffer = Buffer.from(qrImage.split(',')[1], 'base64');

      // ✅ Send email
      await transporter.sendMail({
        from: `"QR Service" <${process.env.BREVO_EMAIL}>`,
        to: email,
        subject: 'Your Unique QR Code',
        text: `Hi ${name},\n\nPlease find attached your unique QR code.`,
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
