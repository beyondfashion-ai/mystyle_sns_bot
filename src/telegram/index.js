import TelegramBot from 'node-telegram-bot-api';
import { setupTTLCleanup, restoreStateFromFirestore } from './state.js';
import { registerCommands } from './commands.js';
import { registerCallbacks } from './callbacks.js';
import { restoreSchedulerState } from './schedulerControl.js';

/**
 * 텔레그램 봇을 생성하고 명령어/콜백 핸들러를 등록한다.
 */
export function createTelegramBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

    if (!token) {
        console.error('[Telegram] TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.');
        return null;
    }

    if (!adminChatId) {
        console.error('[Telegram] TELEGRAM_ADMIN_CHAT_ID가 설정되지 않았습니다.');
        return null;
    }

    const bot = new TelegramBot(token, { polling: true });

    // Polling/에러 핸들러
    bot.on('polling_error', (err) => {
        console.error('[Telegram] Polling error:', err.message);
    });
    bot.on('error', (err) => {
        console.error('[Telegram] Bot error:', err.message);
    });

    // TTL 정리 + Firestore 인터셉터 설정
    setupTTLCleanup();

    // Firestore에서 대기 초안 + 스케줄러 상태 복구 (비동기, 실패해도 봇 동작에 영향 없음)
    Promise.all([
        restoreStateFromFirestore(),
        restoreSchedulerState(),
    ]).catch(err => {
        console.error('[Telegram] Firestore 상태 복구 실패:', err.message);
    });

    // 봇 메뉴(명령어 힌트) 설정
    bot.setMyCommands([
        { command: '/start', description: '메인 메뉴 + 오늘 편성표' },
        { command: '/dx', description: 'X 초안 (Hybrid LLM)' },
        { command: '/di', description: 'IG 화보 (Hybrid LLM)' },
        { command: '/cn', description: '카드뉴스 스튜디오' },
        { command: '/askai', description: 'AI 기획 회의' },
        { command: '/status', description: 'API 호출 현황' },
        { command: '/report', description: '주간 성과 리포트' },
        { command: '/listformat', description: 'DB 포맷 목록' },
        { command: '/schedule', description: '오늘 콘텐츠 편성표' },
        { command: '/scheduler', description: '스케줄러 관리 (일시정지/재개)' },
        { command: '/history', description: '최근 초안 이력' },
        { command: '/help', description: '전체 명령어 가이드' },
    ]).catch(err => console.error('[Telegram] setMyCommands 실패:', err.message));

    // 명령어 핸들러 등록 (핸들러 참조 반환)
    const commandHandlers = registerCommands(bot, adminChatId);

    // 콜백 쿼리 + 수정 모드 핸들러 등록
    registerCallbacks(bot, adminChatId, commandHandlers);

    console.log('[Telegram] 봇이 시작되었습니다.');
    return bot;
}

// 스케줄러용 re-export
export { sendScheduledDraftX, sendScheduledDraftIG, sendScheduledDraft } from './scheduled.js';
