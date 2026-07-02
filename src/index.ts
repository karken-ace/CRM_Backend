import express, { Express } from 'express';
import cors from 'cors';
import { config } from './config';
import { connectDB } from './db';
import { securityHeaders, requestLogging, generalRateLimiter, authRateLimiter } from './middleware';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import agentRoutes from './routes/agents';
import adAccountRoutes from './routes/ad-accounts';
import commandRoutes from './routes/commands';
import metricRoutes from './routes/metrics';
import metaRoutes from './routes/meta';
import healthRoutes from './routes/health';
import adSetRuleRoutes from './routes/ad-set-rules';
import campaignInsightsRoutes from './routes/campaign-insights';
import optimizationInsightsRoutes from './routes/optimization-insights';
import notificationRoutes from './routes/notifications';
import cloneWinnerRoutes from './routes/clone-winner';
import syncRoutes from './routes/sync';
import aiChatRoutes from './routes/ai-chat';
import portfolioRoutes from './routes/portfolio';
import { startBackgroundTasks } from './tasks';

const app: Express = express();

// Middleware
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Authorization'],
}));
app.use(express.json());
app.use(securityHeaders);
app.use(requestLogging);
app.use(generalRateLimiter);

// Routes
app.use('/healthz', healthRoutes);
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/ad-accounts', adAccountRoutes);
app.use('/api/commands', commandRoutes);
app.use('/api/ingest', metricRoutes);
app.use('/api/ad-set-rules', adSetRuleRoutes);
app.use('/api/campaign-insights', campaignInsightsRoutes);
app.use('/api/optimization-insights', optimizationInsightsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/clone-winner', cloneWinnerRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/ai-chat', aiChatRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/meta', metaRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ detail: 'Internal server error' });
});

// Start server
const startServer = async () => {
  try {
    await connectDB();
    startBackgroundTasks();
    
    app.listen(config.app.port, () => {
      console.log(`🚀 Server running on port ${config.app.port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;

