import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import csv from 'csv-parser';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { pool } from './../utils/db.js';
import pLimit from 'p-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Logger ──────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, '../send_log.log');

const log = (message) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
  console.log(line.trim());
};

// ─── Main Controller ──────────────────────────────────────────────────────────
export const uploadAndSendQRCodes = async (req, res) => {
  try {
    const csvPath = path.join(__dirname, '../bbq.csv');

    if (!fs.existsSync(csvPath)) {
      return res.status(400).json({ error: 'bbq.csv file not found in Backend directory' });
    }

    log('========== NEW RUN STARTED ==========');

    // 1️⃣ Read CSV File from path
    const sheetData = await new Promise((resolve, reject) => {
      const results = [];
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (error) => reject(error));
    });

    log(`📋 Loaded ${sheetData.length} rows from bbq.csv`);

    // 2️⃣ Setup SMTP (Brevo/Sendinblue)
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false, // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // 3️⃣ Insert into DB one-by-one with per-row logging
    const prepared = [];

    for (const row of sheetData) {
      const { id, name, email, foodpref: food_pref } = row;
      const uuid = uuidv4();

      try {
        const result = await pool.query(
          `INSERT INTO qr_codes (name, email, uuid, used, unique_id, count)
           VALUES ($1, $2, $3, false, $4, $5)
           ON CONFLICT (email) DO NOTHING
           RETURNING uuid`,
          [name, email, uuid, food_pref, 1]
        );

        if (result.rowCount === 0) {
          log(`⚠️  DB SKIP   | ${email} — already exists, skipped insert`);
        } else {
          log(`✅ DB INSERT | ${email} — saved with UUID ${uuid}`);
        }
      } catch (dbErr) {
        log(`❌ DB ERROR  | ${email} — ${dbErr.message}`);
      }

      prepared.push({ id, name, email, food_pref, uuid });
    }

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

    log(`🎨 QR codes generated for all ${preparedWithQR.length} recipients`);

    // 5️⃣ Send Emails one-by-one with per-email logging
    const batchSize = 50;
    const delayBetweenBatches = 10000;

    const sendBatch = async (batch, batchNumber) => {
      log(`📤 Sending batch ${batchNumber} (${batch.length} emails)...`);
      for (const data of batch) {
        try {
          await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: data.email,
            subject: 'Greeshma Sandhya \\'26 - Entry Pass',
            text: `Hello ${data.name}, Greetings from Kerala Kala Samiti! We’re happy to invite you to Greeshma Sandhya ’26 on 24 April 2026, 6:00 PM at SAC. Your food preference is ${data.food_pref}. Please find your QR code attached. Do not share it, it can be used only once. Hope to see you all there! സ്നേഹപൂർവ്വം കേരള കലാസമിതി`,
            html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0f0f0;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:30px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

  <tr><td style="background:#111111;padding:36px 40px;text-align:center;">
    <p style="margin:0;color:#999999;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Kerala Kala Samiti</p>
    <h1 style="margin:10px 0 0 0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:1px;">Greeshma Sandhya '26</h1>
    <p style="margin:8px 0 0 0;color:#cccccc;font-size:13px;">Friday, 24 April 2026 &nbsp;|&nbsp; SAC</p>
  </td></tr>

  <tr><td style="padding:32px 40px 0 40px;">
    <p style="margin:0;font-size:16px;color:#111111;">Hello <strong>${data.name}</strong>,</p>
    <p style="margin:14px 0 0 0;font-size:14px;color:#444444;line-height:1.8;">Greetings from <strong>Kerala Kala Samiti!</strong><br><br>We’re happy to invite all students, faculty, non-faculty members, and your families at IIT Madras to <strong>Greeshma Sandhya ’26</strong>. It’s going to be a memorable evening with cultural programs and tasty food — a great chance to relax and enjoy together.</p>
  </td></tr>

  <tr><td style="padding:24px 40px 0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-left:4px solid #111111;">
    <tr><td style="padding:18px 22px;">
      <p style="margin:0 0 4px 0;font-size:10px;letter-spacing:2px;color:#999999;text-transform:uppercase;">Event Details</p>
      <p style="margin:6px 0;font-size:14px;color:#222222;"><strong>Date:</strong> 24 April 2026</p>
      <p style="margin:6px 0;font-size:14px;color:#222222;"><strong>Time:</strong> 6:00 PM</p>
      <p style="margin:6px 0;font-size:14px;color:#222222;"><strong>Venue:</strong> SAC</p>
    </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:24px 40px 0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#111111;border-radius:3px;">
    <tr><td style="padding:16px 24px;">
      <p style="margin:0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888888;">Your Food Preference</p>
      <p style="margin:6px 0 0 0;font-size:22px;font-weight:700;color:#ffffff;">${data.food_pref}</p>
    </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:24px 40px 0 40px;">
    <p style="margin:0;font-size:14px;color:#444444;line-height:1.8;">Your unique QR code is attached to this email. Please save it to your phone and show it at the entrance when you arrive.</p>
  </td></tr>

  <tr><td style="padding:18px 40px 0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border-left:4px solid #cc0000;">
    <tr><td style="padding:14px 18px;">
      <p style="margin:0;font-size:13px;color:#880000;line-height:1.7;"><strong>Important:</strong> Please do not share your QR code with anyone. It can be used only once. If your QR has already been scanned by someone else, you will not be allowed to enter.</p>
    </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:28px 40px 32px 40px;">
    <p style="margin:0;font-size:14px;color:#444444;line-height:1.8;">Hope to see you all there!</p>
    <p style="margin:20px 0 0 0;font-size:14px;color:#111111;"><strong>സ്നേഹപൂർവ്വം,</strong><br>കേരള കലാസമിതി</p>
  </td></tr>

  <tr><td style="background:#f0f0f0;padding:16px 40px;text-align:center;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#aaaaaa;">This is an automated email. Please do not reply to this message.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`,
            attachments: [
              {
                filename: `qrcode-${data.id}.png`,
                content: data.qrBuffer,
                encoding: 'base64',
              },
            ],
          });
          log(`✅ MAIL SENT | ${data.email} (${data.name})`);
        } catch (mailErr) {
          log(`❌ MAIL FAIL | ${data.email} (${data.name}) — ${mailErr.message}`);
        }
      }
      log(`✅ Batch ${batchNumber} complete`);
    };

    for (let i = 0; i < preparedWithQR.length; i += batchSize) {
      const batch = preparedWithQR.slice(i, i + batchSize);
      const batchNumber = i / batchSize + 1;

      await sendBatch(batch, batchNumber);

      if (i + batchSize < preparedWithQR.length) {
        log(`⏳ Waiting before next batch...`);
        await new Promise((res) => setTimeout(res, delayBetweenBatches));
      }
    }

    log('========== RUN COMPLETE ==========');

    res.status(200).json({ message: 'QRs saved in DB and mailed successfully in batches' });
  } catch (error) {
    log(`💥 FATAL ERROR — ${error.message}`);
    console.error(error);
    res.status(500).json({ error: 'Failed to process QR codes' });
  }
};
