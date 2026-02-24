import TelegramBot from 'node-telegram-bot-api';
import { postToSNS, postThread, getRateLimitStatus } from './bot.js';
import { getRandomDraft, getTemplateList } from './templates.js';
import { getTrendWeightsPrompt } from './trendAnalyzer.js';

// 초안 상태 관리
const pendingDrafts = new Map(); // messageId -> { text, category, type }
const editMode = new Map(); // chatId -> messageId

const DRAFT_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '✅ 승인', callback_data: 'approve' },
            { text: '✏️ 수정', callback_data: 'edit' },
        ],
        [
            { text: '🔄 다시 생성', callback_data: 'regenerate' },
            { text: '❌ 거부', callback_data: 'reject' },
        ],
    ],
};

function formatDraftPreview(draft, prefix = '') {
    return `📝 *${prefix}초안 미리보기*\n\n${draft.text}\n\n---\n📁 카테고리: \`${draft.category}\`\n🏷️ 타입: \`${draft.type || 'custom'}\``;
}

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

    function isAdmin(chatId) {
        return String(chatId) === String(adminChatId);
    }

    async function sendDraftPreview(chatId, draft, prefix = '') {
        const preview = formatDraftPreview(draft, prefix);
        const sent = await bot.sendMessage(chatId, preview, {
            parse_mode: 'Markdown',
            reply_markup: DRAFT_KEYBOARD,
        });
        pendingDrafts.set(sent.message_id, draft);
        return sent;
    }

    // /start - 봇 소개
    bot.onText(/\/start/, (msg) => {
        if (!isAdmin(msg.chat.id)) return;
        const welcome = [
            '🤖 *mystyleKPOP SNS Bot*',
            '',
            'AI 패션 K-POP 매거진 콘텐츠 관리 봇입니다.',
            '',
            '*명령어:*',
            '/draft - 새 초안 생성',
            '/post <텍스트> - 직접 작성 초안',
            '/status - 게시 현황 확인',
            '/templates - 템플릿 목록',
        ].join('\n');
        bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'Markdown' });
    });

    // /draft - 랜덤 초안 생성
    bot.onText(/\/draft/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        const draft = getRandomDraft();
        if (!draft) {
            bot.sendMessage(msg.chat.id, '❌ 템플릿을 로드할 수 없습니다.');
            return;
        }

        const trendPrompt = await getTrendWeightsPrompt();
        if (trendPrompt) {
            draft.text = `${trendPrompt}\n\n${draft.text}`;
        }

        await sendDraftPreview(msg.chat.id, draft);
    });

    // /post <텍스트> - 직접 작성
    bot.onText(/\/post (.+)/s, async (msg, match) => {
        if (!isAdmin(msg.chat.id)) return;
        const text = match[1].trim();
        const draft = { text, category: 'custom', type: 'custom' };
        await sendDraftPreview(msg.chat.id, draft);
    });

    // /status - rate limit 현황
    bot.onText(/\/status/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        const status = getRateLimitStatus();
        const statusText = [
            '📊 *게시 현황*',
            '',
            `⏰ 시간당: ${status.hourlyCount}/${status.hourlyLimit}`,
            `📅 일일: ${status.dailyCount}/${status.dailyLimit}`,
            '',
            `⏳ 시간당 리셋: ${status.hourlyResetIn}`,
            `⏳ 일일 리셋: ${status.dailyResetIn}`,
        ].join('\n');

        bot.sendMessage(msg.chat.id, statusText, { parse_mode: 'Markdown' });
    });

    // /templates - 템플릿 목록
    bot.onText(/\/templates/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        const list = getTemplateList();
        const lines = ['📋 *템플릿 목록*', ''];
        for (const [cat, count] of Object.entries(list)) {
            lines.push(`• ${cat}: ${count}개`);
        }
        bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
    });

    // 인라인 버튼 콜백
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        if (!isAdmin(chatId)) return;

        const messageId = query.message.message_id;
        const action = query.data;
        const draft = pendingDrafts.get(messageId);

        if (!draft) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ 초안을 찾을 수 없습니다.' });
            return;
        }

        switch (action) {
            case 'approve': {
                await bot.answerCallbackQuery(query.id, { text: '게시 중...' });
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: messageId }
                );

                try {
                    const result = await postToSNS({
                        platforms: ['x'],
                        text: draft.text,
                        imageUrls: [],
                    });

                    if (result.x && result.x.success) {
                        await bot.sendMessage(
                            chatId,
                            `✅ X에 게시 완료!\n🔗 https://x.com/i/status/${result.x.id}`
                        );
                    } else {
                        const error = result.x ? result.x.error : '알 수 없는 오류';
                        await bot.sendMessage(chatId, `❌ 게시 실패: ${error}`);
                    }
                } catch (err) {
                    await bot.sendMessage(chatId, `❌ 게시 중 오류: ${err.message}`);
                }

                pendingDrafts.delete(messageId);
                break;
            }

            case 'edit': {
                await bot.answerCallbackQuery(query.id, { text: '수정 모드' });
                editMode.set(chatId, messageId);
                await bot.sendMessage(chatId, '✏️ 수정할 텍스트를 보내주세요:');
                break;
            }

            case 'regenerate': {
                await bot.answerCallbackQuery(query.id, { text: '다시 생성 중...' });
                const draftType = draft.type !== 'custom' ? draft.type : null;
                pendingDrafts.delete(messageId);
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: messageId }
                );

                const newDraft = getRandomDraft(draftType);
                if (newDraft) {
                    await sendDraftPreview(chatId, newDraft);
                } else {
                    await bot.sendMessage(chatId, '❌ 새 초안 생성에 실패했습니다.');
                }
                break;
            }

            case 'reject': {
                await bot.answerCallbackQuery(query.id, { text: '초안 폐기됨' });
                pendingDrafts.delete(messageId);
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: messageId }
                );
                await bot.sendMessage(chatId, '🗑️ 초안이 폐기되었습니다.');
                break;
            }
        }
    });

    // 수정 모드: 사용자 메시지 수신
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(chatId)) return;
        if (!msg.text || msg.text.startsWith('/')) return;
        if (!editMode.has(chatId)) return;

        const originalMessageId = editMode.get(chatId);
        const originalDraft = pendingDrafts.get(originalMessageId);
        editMode.delete(chatId);

        if (!originalDraft) {
            await bot.sendMessage(chatId, '⚠️ 원본 초안을 찾을 수 없습니다.');
            return;
        }

        // 원본 메시지 버튼 제거
        try {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: chatId, message_id: originalMessageId }
            );
        } catch (_) {
            // 이미 제거된 경우 무시
        }
        pendingDrafts.delete(originalMessageId);

        // 수정된 텍스트로 새 초안 생성
        const editedDraft = {
            text: msg.text,
            category: originalDraft.category,
            type: originalDraft.type,
        };
        await sendDraftPreview(chatId, editedDraft);
    });

    console.log('[Telegram] 봇이 시작되었습니다.');
    return bot;
}

/**
 * 스케줄러에서 호출: 자동 초안을 생성하여 관리자에게 전송한다.
 */
export async function sendScheduledDraft(bot) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    const draft = getRandomDraft();
    if (!draft) return;

    const trendPrompt = await getTrendWeightsPrompt();
    if (trendPrompt) {
        draft.text = `${trendPrompt}\n\n${draft.text}`;
    }

    const preview = formatDraftPreview(draft, '[자동] ');
    const sent = await bot.sendMessage(adminChatId, preview, {
        parse_mode: 'Markdown',
        reply_markup: DRAFT_KEYBOARD,
    });
    pendingDrafts.set(sent.message_id, draft);
}
