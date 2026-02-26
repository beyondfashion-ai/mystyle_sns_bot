import express from 'express';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { createTelegramBot } from './telegram.js';
import { startScheduler } from './scheduler.js';

// Load .env.local first if it exists, otherwise fall back to .env
if (existsSync('.env.local')) {
    dotenv.config({ path: '.env.local' });
} else {
    dotenv.config();
}

// ===== 환경변수 검증 =====
function validateEnv() {
    const required = [
        { key: 'TELEGRAM_BOT_TOKEN', desc: '텔레그램 봇 제어' },
        { key: 'TELEGRAM_ADMIN_CHAT_ID', desc: '관리자 알림 수신' },
    ];
    const optional = [
        { key: 'FIREBASE_SERVICE_ACCOUNT_KEY_PATH', desc: 'Firestore 분석/포맷 저장' },
        { key: 'FAL_AI_KEY', desc: 'AI 이미지 생성 (fal.ai)' },
        { key: 'GEMINI_API_KEY', desc: 'AI 브레인스토밍 (Gemini)' },
        { key: 'X_API_KEY', desc: 'X(Twitter) 게시' },
        { key: 'X_API_SECRET_KEY', desc: 'X(Twitter) 게시' },
        { key: 'X_ACCESS_TOKEN', desc: 'X(Twitter) 게시' },
        { key: 'X_ACCESS_TOKEN_SECRET', desc: 'X(Twitter) 게시' },
        { key: 'INSTAGRAM_BUSINESS_ACCOUNT_ID', desc: 'Instagram 게시' },
        { key: 'INSTAGRAM_ACCESS_TOKEN', desc: 'Instagram 게시' },
    ];

    const missing = required.filter(e => !process.env[e.key]);
    if (missing.length > 0) {
        console.error('[Server] 필수 환경변수가 누락되었습니다:');
        missing.forEach(e => console.error(`  - ${e.key}: ${e.desc}`));
        console.error('[Server] .env.local 파일을 확인하세요. (.env.example 참고)');
        process.exit(1);
    }

    const missingOptional = optional.filter(e => !process.env[e.key]);
    if (missingOptional.length > 0) {
        console.warn('[Server] 선택 환경변수 누락 (해당 기능 비활성화):');
        missingOptional.forEach(e => console.warn(`  - ${e.key}: ${e.desc}`));
    }
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
