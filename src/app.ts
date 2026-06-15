import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import authRoutes from './routes/authRoutes';
import builderRoutes from './routes/builderRoutes';
import customerRoutes from './routes/customerRoutes';
import cpRoutes from './routes/cpRoutes';
import aiRoutes from './routes/aiRoutes';
import adminRoutes from './routes/adminRoutes';

dotenv.config();

const app = express();

// Behind a TLS-terminating proxy (e.g. AWS ALB) req.protocol must resolve to https,
// otherwise generated upload URLs are http:// and blocked as mixed content.
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : true,            // allow all in dev / when not set
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
// morgan is noisy in tests, maybe skip it or use a different format
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
}

// Basic health check
app.get('/api/health', (req, res) => {
        res.json({status: 'OK', message: 'Dealio Backend is running'});
    }
);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/builder', builderRoutes);
app.use('/api/portal', builderRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/cp', cpRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);

export default app;
