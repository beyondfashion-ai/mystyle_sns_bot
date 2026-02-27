import express from 'express';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { createTelegramBot } from './telegram.js';
import { startScheduler } from './scheduler.js';
import { validateEnv } from './config.js';

// Load .env.local first if it exists, otherwise fall back to .env
if (existsSync('.env.local')) {
    dotenv.config({ path: '.env.local' });
} else {
    dotenv.config();
}

validateEnv();

const app = express();
const PORT = process.env.PORT || 3000;

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'mystyleKPOP SNS Bot' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// 텔레그램 봇 + 스케줄러 시작
const bot = createTelegramBot();
if (bot) {
    startScheduler(bot);
}

const server = app.listen(PORT, () => {
    console.log(`[Server] mystyleKPOP SNS Bot 서버 시작 (port: ${PORT})`);
});

// ===== Graceful Shutdown =====
function shutdown(signal) {
    console.log(`[Server] ${signal} 수신, 서버 종료 중...`);
    if (bot) {
        bot.stopPolling();
        console.log('[Server] 텔레그램 봇 polling 중지');
    }
    server.close(() => {
        console.log('[Server] HTTP 서버 종료 완료');
        process.exit(0);
    });
    // 10초 후 강제 종료
    setTimeout(() => {
        console.error('[Server] 강제 종료 (타임아웃 10초)');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
