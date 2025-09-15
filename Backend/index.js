import express from 'express';
import cors from 'cors';        // import cors
import qrRoutes from './Routes/routes.js';

const app = express();

// enable CORS for all origins
app.use(cors());

// parse JSON bodies
app.use(express.json());

// QR routes
app.use('/api/qr', qrRoutes);

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
