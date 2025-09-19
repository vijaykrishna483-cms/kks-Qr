import xlsx from 'xlsx';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pool } from './../utils/db.js';
import pLimit from 'p-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const uploadAndSendQRCodes = async (req, res) => {
  try {
    // 1️⃣ Read Excel File
    const workbook = xlsx.readFile(path.join(__dirname, '../kksDb.xlsx'));
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // 2️⃣ Setup Gmail SMTP
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS, // App Password
      },
    });

    // 3️⃣ Bulk insert into DB
    const insertValues = [];
    const prepared = [];

    for (const row of sheetData) {
      const { id, name, email, count, kksid: kks_id } = row;
      const uuid = uuidv4();

      insertValues.push(
        pool.query(
          `INSERT INTO qr_codes (name, email, uuid, used, kks_id, count)
           VALUES ($1, $2, $3, false, $4, $5)
           ON CONFLICT (email) DO NOTHING`,
          [name, email, uuid, kks_id, count]
        )
      );

      prepared.push({ id, name, email, count, kks_id, uuid });
    }

    await Promise.all(insertValues);

    // 4️⃣ Generate QR Codes in parallel (limit concurrency)
    const limit = pLimit(10);
    const preparedWithQR = await Promise.all(
      prepared.map((row) =>
        limit(async () => {
          const qrData = `UUID:${row.uuid}`;
          const qrImage = await QRCode.toDataURL(qrData);
          const qrBuffer = Buffer.from(qrImage.split(',')[1], 'base64');
          return { ...row, qrBuffer };
        })
      )
    );

    // 5️⃣ Send Emails in Batches
    const batchSize = 50; // Gmail safe batch
    const delayBetweenBatches = 1000 * 60 * 10; // 10 minutes

    const sendBatch = async (batch, batchNumber) => {
      await Promise.all(
        batch.map((data) =>
          transporter.sendMail({
            from: `"QR Service" <${process.env.GMAIL_USER}>`,
            to: data.email,
            subject: 'Your Unique QR Code',
            text: `Hi ${data.name},

Please find attached your unique QR code.
Count: ${data.count}

Regards,
QR Service`,
            attachments: [
              {
                filename: `qrcode-${data.id}.png`,
                content: data.qrBuffer,
                encoding: 'base64',
              },
            ],
          })
        )
      );
      console.log(`✅ Sent batch ${batchNumber}`);
    };

    for (let i = 0; i < preparedWithQR.length; i += batchSize) {
      const batch = preparedWithQR.slice(i, i + batchSize);
      const batchNumber = i / batchSize + 1;

      await sendBatch(batch, batchNumber);

      if (i + batchSize < preparedWithQR.length) {
        console.log(`⏳ Waiting before next batch...`);
        await new Promise((res) => setTimeout(res, delayBetweenBatches));
      }
    }

    res
      .status(200)
      .json({ message: 'QRs saved in DB and mailed successfully in batches' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process QR codes' });
  }
};
