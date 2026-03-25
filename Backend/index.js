import express from 'express';
import cors from 'cors';        // import cors
import dotenv from 'dotenv';    // import dotenv
import qrRoutes from './Routes/routes.js';
import { pool } from './utils/db.js';

dotenv.config();                // Load .env

const app = express();
const PORT = process.env.PORT || 4000;

// enable CORS for all origins
app.use(cors());

// parse JSON bodies
app.use(express.json());

// Healthcheck route
app.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.send('QR Scanner Backend is running and Database is connected!');
  } catch (err) {
    res.status(500).send('QR Scanner Backend is running but Database connection failed!');
  }
});

// QR routes
app.use('/api/qr', qrRoutes);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
