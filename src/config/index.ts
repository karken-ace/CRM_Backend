import dotenv from 'dotenv';

dotenv.config();

export const config = {
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '8000', 10),
  },
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/acesmaster',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-jwt-secret-here',
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    accessTokenTTL: parseInt(process.env.ACCESS_TTL_MINUTES || '30', 10),
    refreshTokenTTL: parseInt(process.env.REFRESH_TTL_MINUTES || '43200', 10), // 30 days
  },
  email: {
    smtpServer: process.env.SMTP_SERVER || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpUser: process.env.SMTP_USER || '',
    smtpPassword: process.env.SMTP_PASSWORD || '',
  },
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
  agent: {
    baseUrl: process.env.AGENT_BASE_URL || 'http://localhost:9000',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },
};

