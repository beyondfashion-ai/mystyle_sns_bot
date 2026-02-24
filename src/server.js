import express from 'express';
import dotenv from 'dotenv';
import { createTelegramBot } from './telegram.js';
import { startScheduler } from './scheduler.js';

dotenv.config();

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

app.listen(PORT, () => {
    console.log(`[Server] mystyleKPOP SNS Bot 서버 시작 (port: ${PORT})`);
});
