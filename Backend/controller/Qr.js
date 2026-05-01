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

    // 1️⃣ Read CSV — new structure:
    //    email, Name, Roll No, Food Preference
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
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // 3️⃣ Build per-person QR record and insert into DB — 1 QR per person
    const allPersonData = [];

    for (const row of sheetData) {
      const email       = (row['email']           || '').trim();
      const name        = (row['Name']            || '').trim();
      const rollNo      = (row['Roll No']         || '').trim();
      const foodPref    = (row['Food Preference'] || '').trim(); // 'Veg' or 'Non Veg'

      if (!email || !name || !rollNo || !foodPref) {
        log(`⚠️  SKIP row — missing required field (${JSON.stringify(row)})`);
        continue;
      }

      // Normalise food preference to consistent label
      const food_type = foodPref.toLowerCase().includes('non') ? 'Non-Veg' : 'Veg';

      const uuid = uuidv4();

      // Insert single QR row into DB
      try {
        const result = await pool.query(
          `INSERT INTO qr_codes (name, email, roll_no, uuid, food_type, used)
           VALUES ($1, $2, $3, $4, $5, false)
           ON CONFLICT (uuid) DO NOTHING
           RETURNING uuid`,
          [name, email, rollNo, uuid, food_type]
        );

        if (result.rowCount === 0) {
          log(`⚠️  DB SKIP   | ${email} — UUID ${uuid} already exists`);
        } else {
          log(`✅ DB INSERT | ${email} (${rollNo}) — ${food_type} — UUID ${uuid}`);
        }
      } catch (dbErr) {
        log(`❌ DB ERROR  | ${email} — ${dbErr.message}`);
        continue;
      }

      allPersonData.push({ email, name, rollNo, food_type, uuid });
    }

    // 4️⃣ Generate QR images in parallel
    const limit = pLimit(10);

    await Promise.all(
      allPersonData.map((person) =>
        limit(async () => {
          const qrBuffer = await QRCode.toBuffer(`UUID:${person.uuid}`, {
            type: 'png',
            width: 300,
            margin: 2,
          });
          person.qrBuffer = qrBuffer;
        })
      )
    );

    log(`🎨 QR images generated for all ${allPersonData.length} recipients`);

    // 5️⃣ Send Emails in batches
    const batchSize = 50;
    const delayBetweenBatches = 10000;

    const buildEmailHTML = ({ name, rollNo, food_type }) => {
      const isNonVeg    = food_type === 'Non-Veg';
      const borderColor = isNonVeg ? '#8B0000' : '#2E7D32';
      const bgColor     = isNonVeg ? '#FFF5F5' : '#F1F8E9';
      const labelBg     = isNonVeg ? '#8B0000' : '#2E7D32';
      const label       = `${food_type} Coupon`;

      const vegMenu = `
        <tr><td style="padding:0 0 14px 0;">
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;">Starters</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#444;line-height:2;">
            <li>Cheese &amp; Corn Nuggets (2 Pc)</li>
            <li>Spring Roll (2 Pc)</li>
            <li>Paneer Tikka (2 Pc)</li>
          </ul>
        </td></tr>
        <tr><td style="padding:0 0 14px 0;">
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;">Main Course</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#444;line-height:2;">
            <li>Mushroom Biryani</li>
            <li>Phulka (2 Pc)</li>
            <li>Paneer Gravy</li>
          </ul>
        </td></tr>
        <tr><td style="padding:0 0 14px 0;">
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;">Desserts</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#444;line-height:2;">
            <li>Bread Halwa</li>
            <li>Gulab Jamun (1 Pc)</li>
            <li>Ice Cream</li>
          </ul>
        </td></tr>
        <tr><td style="padding:0;">
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;">Drinks</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#444;line-height:2;">
            <li>Watermelon Juice (150 mL)</li>
          </ul>
        </td></tr>`;

      const nonVegMenu = `
        <tr><td style="padding:0 0 14px 0;">
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;">Starters</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#444;line-height:2;">
            <li>Chicken Nuggets (2 Pc)</li>
            <li>Spring Roll (2 Pc)</li>
            <li>Hariyali Chicken (2 Pc)</li>
          </ul>
        </td></tr>
        <tr><td style="padding:0 0 14px 0;">
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;">Main Course</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#444;line-height:2;">
            <li>Chicken Dum Biryani</li>
            <li>Phulka (2 Pc)</li>
            <li>Chicken Chettinad Gravy</li>
          </ul>
        </td></tr>
        <tr><td style="padding:0 0 14px 0;">
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;">Desserts</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#444;line-height:2;">
            <li>Bread Halwa</li>
            <li>Gulab Jamun (1 Pc)</li>
            <li>Ice Cream</li>
          </ul>
        </td></tr>
        <tr><td style="padding:0;">
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;">Drinks</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#444;line-height:2;">
            <li>Watermelon Juice (150 mL)</li>
          </ul>
        </td></tr>`;

      const menuRows = isNonVeg ? nonVegMenu : vegMenu;

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Alakananda Hostel Nite 2026 – Entry Coupon</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f0f0;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:30px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

  <!-- Header -->
  <tr><td style="background:#111111;padding:36px 40px;text-align:center;">
    <p style="margin:0;color:#999999;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Alakananda Hostel</p>
    <h1 style="margin:10px 0 0 0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:1px;">Hostel Nite 2026</h1>
    <p style="margin:8px 0 0 0;color:#cccccc;font-size:13px;">Friday, 1st May 2026 &nbsp;|&nbsp; Alakananda Ground</p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:32px 40px 0 40px;">
    <p style="margin:0;font-size:16px;color:#111111;">Hello <strong>${name}</strong>,</p>
    <p style="margin:14px 0 0 0;font-size:14px;color:#444444;line-height:1.9;">
      Hope you're doing well!<br><br>
      We're excited to invite you to <strong>Alakananda Hostel Nite 2026</strong> — an evening filled with great food, fun, and unforgettable memories!
    </p>
  </td></tr>

  <!-- Event Details -->
  <tr><td style="padding:24px 40px 0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-left:4px solid #111111;">
    <tr><td style="padding:18px 22px;">
      <p style="margin:0 0 8px 0;font-size:10px;letter-spacing:2px;color:#999999;text-transform:uppercase;">Event Details</p>
      <p style="margin:6px 0;font-size:14px;color:#222222;"><strong>Date:</strong> Friday, 1st May 2026</p>
      <p style="margin:6px 0;font-size:14px;color:#222222;"><strong>Time:</strong> 7:30 PM onwards</p>
      <p style="margin:6px 0;font-size:14px;color:#222222;"><strong>Venue:</strong> Alakananda Ground</p>
    </td></tr>
    </table>
  </td></tr>

  <!-- Coupon Summary -->
  <tr><td style="padding:24px 40px 0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#111111;border-radius:4px;">
    <tr><td style="padding:18px 24px;">
      <p style="margin:0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888888;">Your Food Coupon</p>
      <p style="margin:8px 0 0 0;font-size:20px;font-weight:700;color:#ffffff;">
        1 Coupon &nbsp;—&nbsp; <span style="color:${isNonVeg ? '#ff9999' : '#99dd99'};">${food_type}</span>
      </p>
      <p style="margin:6px 0 0 0;font-size:13px;color:#aaaaaa;">Roll No: ${rollNo}</p>
    </td></tr>
    </table>
  </td></tr>

  <!-- Menu -->
  <tr><td style="padding:24px 40px 0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-left:4px solid ${borderColor};border-radius:0 4px 4px 0;">
    <tr><td style="padding:18px 22px;">
      <p style="margin:0 0 14px 0;font-size:10px;letter-spacing:2px;color:#999;text-transform:uppercase;">Your Menu (${food_type})</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${menuRows}
      </table>
    </td></tr>
    </table>
  </td></tr>

  <!-- QR Code -->
  <tr><td style="padding:24px 24px 0 24px;">
    <p style="margin:0 0 12px 16px;font-size:14px;color:#444444;line-height:1.8;">
      Show the QR below at food collection. It is for <strong>one meal</strong> and can only be scanned once.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:10px; text-align:center; vertical-align:top;">
          <table cellpadding="0" cellspacing="0" style="border:2px solid ${borderColor}; border-radius:10px; overflow:hidden; margin:0 auto;">
            <tr>
              <td style="background:${bgColor}; padding:12px; text-align:center;">
                <img src="cid:qr-main" width="200" height="200" style="display:block;" alt="${label}" />
              </td>
            </tr>
            <tr>
              <td style="background:${labelBg}; padding:10px 16px; text-align:center;">
                <p style="margin:0; font-size:14px; font-weight:700; color:#ffffff; letter-spacing:0.5px;">
                  ${label}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Warning -->
  <tr><td style="padding:20px 40px 0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border-left:4px solid #cc0000;">
    <tr><td style="padding:14px 18px;">
      <p style="margin:0;font-size:13px;color:#880000;line-height:1.7;">
        <strong>Important:</strong> This QR code can be used only once. Do not share it.
        If it has already been scanned, it will not be accepted at entry.
      </p>
    </td></tr>
    </table>
  </td></tr>

  <!-- Sign-off -->
  <tr><td style="padding:28px 40px 32px 40px;">
    <p style="margin:0;font-size:14px;color:#444444;line-height:1.8;">
      Get ready for a night full of good vibes, delicious food, and fun memories with your friends!<br><br>
      Looking forward to seeing you all there!
    </p>
    <p style="margin:20px 0 0 0;font-size:14px;color:#111111;"><strong>Best wishes,</strong><br>Alakananda Council</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f0f0f0;padding:16px 40px;text-align:center;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#aaaaaa;">This is an automated email. Please do not reply to this message.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
    };

    const sendBatch = async (batch, batchNumber) => {
      log(`📤 Sending batch ${batchNumber} (${batch.length} emails)...`);

      for (const person of batch) {
        const { name, email, rollNo, food_type, uuid, qrBuffer } = person;

        const attachments = [
          {
            filename: `${food_type.replace('-', '_')}_Coupon.png`,
            content: qrBuffer,
            encoding: 'base64',
            cid: 'qr-main',
          },
        ];

        try {
          await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: email,
            subject: `Alakananda Hostel Nite 2026 — Your Entry Coupon (${food_type})`,
            text: `Hello ${name} (${rollNo}), Greetings from Alakananda Hostel! You have 1 ${food_type} coupon for Alakananda Hostel Nite 2026 on Friday, 1st May 2026, 7:30 PM at Alakananda Ground. Your QR code is attached — it can be used only once. Do not share it. Get ready for a night full of good vibes and fun! Best wishes, Alakananda Council`,
            html: buildEmailHTML(person),
            attachments,
          });
          log(`✅ MAIL SENT | ${email} (${name} / ${rollNo}) — ${food_type}`);
        } catch (mailErr) {
          log(`❌ MAIL FAIL | ${email} (${name}) — ${mailErr.message}`);
        }
      }

      log(`✅ Batch ${batchNumber} complete`);
    };

    for (let i = 0; i < allPersonData.length; i += batchSize) {
      const batch = allPersonData.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      await sendBatch(batch, batchNumber);

      if (i + batchSize < allPersonData.length) {
        log(`⏳ Waiting before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
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
