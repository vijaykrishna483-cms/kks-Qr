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

// Diagnostic logging
console.log('--- SERVER STARTING ---');
console.log('Environment:', process.env.NODE_ENV);
console.log('PORT:', PORT);
console.log('Working Directory:', process.cwd());
console.log('--- END DIAGNOSTICS ---');

// parse JSON bodies
app.use(express.json());

// Log incoming requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Simple test route
app.get('/test', (req, res) => {
  res.send('Server is reachable!');
});

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
