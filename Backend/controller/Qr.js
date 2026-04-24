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
    //    email, name, "No. of Non veg coupons", "No. of veg coupons", "Total No.of coupons"
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

    // 3️⃣ Build per-person QR records and insert into DB
    const allPersonData = [];

    for (const row of sheetData) {
      const email = (row['email'] || '').trim();
      const name  = (row['name']  || '').trim();
      const nonVegCount = parseInt(row['No. of Non veg coupons']) || 0;
      const vegCount    = parseInt(row['No. of veg coupons'])     || 0;
      const totalCount  = parseInt(row['Total No.of coupons'])    || (nonVegCount + vegCount);

      if (!email || !name) {
        log(`⚠️  SKIP row — missing email or name (${JSON.stringify(row)})`);
        continue;
      }

      // Build individual QR records: non-veg first, then veg
      const qrs = [];

      for (let i = 0; i < nonVegCount; i++) {
        qrs.push({ uuid: uuidv4(), food_type: 'Non-Veg', index: i + 1 });
      }
      for (let i = 0; i < vegCount; i++) {
        qrs.push({ uuid: uuidv4(), food_type: 'Veg', index: i + 1 });
      }

      // Insert each QR as its own row in DB
      for (const qr of qrs) {
        try {
          const result = await pool.query(
            `INSERT INTO qr_codes (name, email, uuid, food_type, used)
             VALUES ($1, $2, $3, $4, false)
             ON CONFLICT (uuid) DO NOTHING
             RETURNING uuid`,
            [name, email, qr.uuid, qr.food_type]
          );

          if (result.rowCount === 0) {
            log(`⚠️  DB SKIP   | ${email} — UUID ${qr.uuid} already exists`);
          } else {
            log(`✅ DB INSERT | ${email} — ${qr.food_type} #${qr.index} — UUID ${qr.uuid}`);
          }
        } catch (dbErr) {
          log(`❌ DB ERROR  | ${email} — ${dbErr.message}`);
        }
      }

      allPersonData.push({ email, name, nonVegCount, vegCount, totalCount, qrs });
    }

    // 4️⃣ Generate QR images in parallel
    const limit = pLimit(10);

    await Promise.all(
      allPersonData.flatMap((person) =>
        person.qrs.map((qr) =>
          limit(async () => {
            const qrBuffer = await QRCode.toBuffer(`UUID:${qr.uuid}`, {
              type: 'png',
              width: 300,
              margin: 2,
            });
            qr.qrBuffer = qrBuffer;
          })
        )
      )
    );

    log(`🎨 QR images generated for all ${allPersonData.length} recipients`);

    // 5️⃣ Send Emails in batches
    const batchSize = 50;
    const delayBetweenBatches = 10000;

    const buildEmailHTML = ({ name, nonVegCount, vegCount, totalCount, qrs }) => {
      // Build QR code grid (2 per row)
      let qrRows = '';
      for (let i = 0; i < qrs.length; i += 2) {
        qrRows += `<tr>`;
        for (let j = i; j < Math.min(i + 2, qrs.length); j++) {
          const qr = qrs[j];
          const isNonVeg     = qr.food_type === 'Non-Veg';
          const borderColor  = isNonVeg ? '#CC0000' : '#2E7D32';
          const bgColor      = isNonVeg ? '#FFF5F5' : '#F1F8E9';
          const labelBg      = isNonVeg ? '#CC0000' : '#2E7D32';
          const label        = `${qr.food_type} Coupon ${qr.index}`;

          qrRows += `
            <td style="padding:10px; text-align:center; vertical-align:top; width:50%;">
              <table cellpadding="0" cellspacing="0" style="border:2px solid ${borderColor}; border-radius:10px; overflow:hidden; margin:0 auto;">
                <tr>
                  <td style="background:${bgColor}; padding:12px; text-align:center;">
                    <img src="cid:qr-${qr.uuid}" width="200" height="200" style="display:block;" alt="${label}" />
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
            </td>`;
        }
        // If only 1 item in a row, fill the second cell
        if (qrs.length % 2 !== 0 && i === qrs.length - 1) {
          qrRows += `<td style="width:50%;"></td>`;
        }
        qrRows += `</tr>`;
      }

      // Summary text
      const parts = [];
      if (nonVegCount > 0) parts.push(`<strong style="color:#CC0000;">${nonVegCount} Non-Veg</strong>`);
      if (vegCount > 0)    parts.push(`<strong style="color:#2E7D32;">${vegCount} Veg</strong>`);
      const summaryHtml = parts.join(' &nbsp;+&nbsp; ');

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Greeshma Sandhya '26 – Entry Coupons</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f0f0;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:30px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

  <!-- Header -->
  <tr><td style="background:#111111;padding:36px 40px;text-align:center;">
    <p style="margin:0;color:#999999;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Kerala Kala Samiti</p>
    <h1 style="margin:10px 0 0 0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:1px;">Greeshma Sandhya '26</h1>
    <p style="margin:8px 0 0 0;color:#cccccc;font-size:13px;">Friday, 24 April 2026 &nbsp;|&nbsp; SAC</p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:32px 40px 0 40px;">
    <p style="margin:0;font-size:16px;color:#111111;">Hello <strong>${name}</strong>,</p>
    <p style="margin:14px 0 0 0;font-size:14px;color:#444444;line-height:1.8;">
      Greetings from <strong>Kerala Kala Samiti!</strong><br><br>
      We're happy to invite you to <strong>Greeshma Sandhya '26</strong>. It's going to be a memorable evening with cultural programs and tasty food — a great chance to relax and enjoy together.
    </p>
  </td></tr>

  <!-- Event Details -->
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

  <!-- Coupon Summary -->
  <tr><td style="padding:24px 40px 0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#111111;border-radius:4px;">
    <tr><td style="padding:18px 24px;">
      <p style="margin:0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888888;">Your Food Coupons</p>
      <p style="margin:8px 0 0 0;font-size:20px;font-weight:700;color:#ffffff;">
        ${totalCount} Coupon${totalCount > 1 ? 's' : ''} Total &nbsp;—&nbsp; ${summaryHtml.replace(/<[^>]+>/g, (m) => m)}
      </p>
    </td></tr>
    </table>
  </td></tr>

  <!-- Instructions -->
  <tr><td style="padding:20px 40px 0 40px;">
    <p style="margin:0;font-size:14px;color:#444444;line-height:1.8;">
      Your QR codes are below — each one is for <strong>one meal</strong>.
      Show the matching QR (Non-Veg or Veg) at food collection. Each QR can only be scanned once.
    </p>
  </td></tr>

  <!-- QR Code Grid -->
  <tr><td style="padding:20px 24px 0 24px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${qrRows}
    </table>
  </td></tr>

  <!-- Warning -->
  <tr><td style="padding:20px 40px 0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border-left:4px solid #cc0000;">
    <tr><td style="padding:14px 18px;">
      <p style="margin:0;font-size:13px;color:#880000;line-height:1.7;">
        <strong>Important:</strong> Each QR code can be used only once. Do not share your QR codes.
        If a QR has already been scanned by someone else, it will not be accepted.
      </p>
    </td></tr>
    </table>
  </td></tr>

  <!-- Sign-off -->
  <tr><td style="padding:28px 40px 32px 40px;">
    <p style="margin:0;font-size:14px;color:#444444;line-height:1.8;">Hope to see you all there!</p>
    <p style="margin:20px 0 0 0;font-size:14px;color:#111111;"><strong>സ്നേഹപൂർവ്വം,</strong><br>കേരള കലാസമിതി</p>
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
        const { name, email, nonVegCount, vegCount, totalCount, qrs } = person;

        // Build CID attachments — one per QR code
        const attachments = qrs.map((qr) => ({
          filename: `${qr.food_type.replace('-', '_')}_Coupon_${qr.index}.png`,
          content: qr.qrBuffer,
          encoding: 'base64',
          cid: `qr-${qr.uuid}`,          // referenced as src="cid:qr-{uuid}" in HTML
        }));

        const summaryText = [
          nonVegCount > 0 ? `${nonVegCount} Non-Veg` : null,
          vegCount > 0    ? `${vegCount} Veg`         : null,
        ].filter(Boolean).join(', ');

        try {
          await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: email,
            subject: `Greeshma Sandhya '26 — Your ${totalCount} Entry Coupon${totalCount > 1 ? 's' : ''}`,
            text: `Hello ${name}, Greetings from Kerala Kala Samiti! You have ${totalCount} coupon(s) for Greeshma Sandhya '26 on 24 April 2026, 6:00 PM at SAC. Breakdown: ${summaryText}. Your QR codes are attached — each is for one meal. Do not share them; each QR can be used only once. Hope to see you there! സ്നേഹപൂർവ്വം, കേരള കലാസമിതി`,
            html: buildEmailHTML(person),
            attachments,
          });
          log(`✅ MAIL SENT | ${email} (${name}) — ${totalCount} QR(s): ${summaryText}`);
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
