import { pool } from '../utils/db.js';

export const scanQrCode = async (req, res) => {
  try {
    const { uuid } = req.body;
    console.log('Received QR:', uuid);

    if (!uuid) {
      return res.status(400).json({ error: 'UUID required' });
    }

    // ✅ Check if QR exists
    const result = await pool.query(
      'SELECT * FROM qr_codes WHERE uuid = $1',
      [uuid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    const record = result.rows[0];

    if (record.used) {
      return res.status(410).json({ error: 'QR code already used/expired' });
    }

    // ✅ Mark as used
    await pool.query(
      'UPDATE qr_codes SET used = true WHERE uuid = $1',
      [uuid]
    );

    // ✅ Return verified details — name, roll_no, food preference
    res.json({
      message: 'QR verified successfully',
      user: {
        name:      record.name,
        roll_no:   record.roll_no,
        food_type: record.food_type,   // 'Non-Veg' or 'Veg'
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
