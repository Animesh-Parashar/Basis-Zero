/**
 * Basis-Zero Backend Entry Point
 * 
 * This is the main server that orchestrates:
 * - Yellow Network Nitrolite sessions for off-chain betting on Polygon
 * - Pyth oracle integration for market resolution
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { YellowSessionService } from './yellow/session-service';
import { MarketResolver } from './markets/resolver';
import { ammRouter } from './amm/router';
import { sessionsRouter } from './sessions/router';

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize services
const yellowSession = new YellowSessionService();
const marketResolver = new MarketResolver();

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Yellow Network routes  
app.use('/api/session', yellowSession.router);

// Sessions Management routes (Testing)
app.use('/api/sessions', sessionsRouter);
console.log('🟢 Sessions management routes enabled');

// AMM Market routes (Internal Logic)
app.use('/api/amm', ammRouter);
console.log('🟢 AMM Market routes enabled');

// Market Resolver routes (Oracles)
app.use('/api/markets', marketResolver.router);

app.listen(PORT, () => {
  console.log(`🚀 Basis-Zero Backend running on port ${PORT}`);
  console.log(`   📍 Health: http://localhost:${PORT}/health`);
  console.log(`   📍 Sessions: http://localhost:${PORT}/api/session`);
  console.log(`   📍 Sessions Management: http://localhost:${PORT}/api/sessions`);
  console.log(`   📍 AMM: http://localhost:${PORT}/api/amm`);
  console.log(`   📍 Markets: http://localhost:${PORT}/api/markets`);
});

export { app };
