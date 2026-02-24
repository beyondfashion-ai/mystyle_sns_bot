import TelegramBot from 'node-telegram-bot-api';
import { postToSNS, postThread, postCarousel, getRateLimitStatus } from './bot.js';
import { getRandomDraft, getTemplateList, getCardNewsData } from './templates.js';
import { generateImageForDraft, generateCardNewsCover } from './imageGen.js';
import { generateAndUploadCardNews } from './cardNews.js';
import { getTrendWeightsPrompt } from './trendAnalyzer.js';
import { getExternalTrendPrompt } from './trendScraper.js';
import { addFormat, getFormats, deleteFormat, getRandomFormatDraft } from './formatManager.js';
import { brainstormFormat } from './aiBrainstorm.js';

// 초안 상태 관리
const pendingDrafts = new Map();   // messageId -> { text, category, type, platform, imageUrl, artist }
const pendingCardNews = new Map(); // messageId -> { type, title, imageUrls, caption }
const editMode = new Map();        // chatId -> messageId

// 플랫폼별 인라인 버튼
const X_DRAFT_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '\u2705 X \uac8c\uc2dc', callback_data: 'approve_x' },
            { text: '\u270f\ufe0f \uc218\uc815', callback_data: 'edit' },
        ],
        [
            { text: '\ud83d\udd04 \ub2e4\uc2dc \uc0dd\uc131', callback_data: 'regenerate_x' },
            { text: '\u274c \uac70\ubd80', callback_data: 'reject' },
        ],
    ],
};

const IG_DRAFT_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '\u2705 IG \uac8c\uc2dc', callback_data: 'approve_ig' },
            { text: '\u270f\ufe0f \uc218\uc815', callback_data: 'edit' },
        ],
        [
            { text: '\ud83d\uddbc\ufe0f \uc774\ubbf8\uc9c0 \uc7ac\uc0dd\uc131', callback_data: 'regenerate_image' },
            { text: '\ud83d\udd04 \ub2e4\uc2dc \uc0dd\uc131', callback_data: 'regenerate_ig' },
        ],
        [
            { text: '\u274c \uac70\ubd80', callback_data: 'reject' },
        ],
    ],
};

function makeCnKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '\u2705 X \uc2a4\ub808\ub4dc \uac8c\uc2dc', callback_data: 'approve_cn_x' },
                { text: '\u2705 IG \uce90\ub7ec\uc140 \uac8c\uc2dc', callback_data: 'approve_cn_ig' },
            ],
            [
                { text: '\ud83d\udd04 \ub2e4\uc2dc \uc0dd\uc131', callback_data: 'regenerate_cn' },
                { text: '\u274c \uac70\ubd80', callback_data: 'reject' },
            ],
        ],
    };
}

const CN_TYPE_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '\ud83d\udcca \ud2b8\ub80c\ub4dc TOP 5', callback_data: 'cn_type_trend_top5' },
        ],
        [
            { text: '\ud83d\udcf8 \ub8e9\ubd81 \ubd84\uc11d', callback_data: 'cn_type_lookbook' },
        ],
        [
            { text: '\ud83d\udc61 \uc2a4\ud0c0\uc77c \ud301', callback_data: 'cn_type_style_tip' },
        ],
    ],
};

function formatDraftPreview(draft, prefix = '') {
    const platformLabel = draft.platform === 'instagram' ? '[IG]' : '[X]';
    const imageLabel = draft.imageUrl ? '\ud83d\uddbc\ufe0f \uc774\ubbf8\uc9c0 \ud3ec\ud568' : '\ud83d\udcdd \ud14d\uc2a4\ud2b8\ub9cc';
    return `\ud83d\udcdd *${prefix}${platformLabel} \ucd08\uc548 \ubbf8\ub9ac\ubcf4\uae30* ${imageLabel}\n\n${draft.text}\n\n---\n\ud83d\udcc1 \uce74\ud14c\uace0\ub9ac: \`${draft.category}\`\n\ud83c\udff7\ufe0f \ud0c0\uc785: \`${draft.type || 'custom'}\``;
}

/**
 * 텔레그램 봇을 생성하고 명령어/콜백 핸들러를 등록한다.
 */
export function createTelegramBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

    if (!token) {
        console.error('[Telegram] TELEGRAM_BOT_TOKEN\uc774 \uc124\uc815\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.');
        return null;
    }

    if (!adminChatId) {
        console.error('[Telegram] TELEGRAM_ADMIN_CHAT_ID\uac00 \uc124\uc815\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.');
        return null;
    }

    const bot = new TelegramBot(token, { polling: true });

    function isAdmin(chatId) {
        return String(chatId) === String(adminChatId);
    }

    /**
     * 초안 미리보기 전송 (이미지 있으면 사진, 없으면 텍스트)
     */
    async function sendDraftPreview(chatId, draft, prefix = '') {
        const preview = formatDraftPreview(draft, prefix);
        const keyboard = draft.platform === 'instagram' ? IG_DRAFT_KEYBOARD : X_DRAFT_KEYBOARD;

        let sent;
        if (draft.imageUrl) {
            // 텔레그램 캡션 1024자 제한 처리
            const caption = preview.length > 1024 ? preview.substring(0, 1021) + '...' : preview;
            sent = await bot.sendPhoto(chatId, draft.imageUrl, {
                caption,
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
        } else {
            sent = await bot.sendMessage(chatId, preview, {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
        }
        pendingDrafts.set(sent.message_id, draft);
        return sent;
    }

    // ===== 명령어 핸들러 =====

    // /start - 봇 소개
    bot.onText(/\/start/, (msg) => {
        if (!isAdmin(msg.chat.id)) return;
        const welcome = [
            '\ud83e\udd16 *mystyleKPOP SNS Bot*',
            '',
            'AI \ud328\uc158 K-POP \ub9e4\uac70\uc9c4 \ucf58\ud150\uce20 \uad00\ub9ac \ubd07\uc785\ub2c8\ub2e4.',
            '',
            '*\uba85\ub839\uc5b4:*',
            '/dx - X \ucd08\uc548 \uc0dd\uc131 (\ubaa8\ub4e0 \ud15c\ud50c\ub9bf)',
            '/di - IG \ucd08\uc548 \uc0dd\uc131 (\uc774\ubbf8\uc9c0 \ud544\uc218)',
            '/cn - \uce74\ub4dc\ub274\uc2a4 \uc0dd\uc131',
            '/post <\ud14d\uc2a4\ud2b8> - X \uc9c1\uc811 \uc791\uc131',
            '/status - \uac8c\uc2dc \ud604\ud669 \ud655\uc778',
            '/templates - \ud15c\ud50c\ub9bf \ubaa9\ub85d',
            '',
            '*\ud3ec\ub9f7 \uad00\ub9ac (-db)*',
            '/listformat - \ub3d9\uc801 \ud3ec\ub9f7 \ubaa9\ub85d \ud655\uc778',
            '/delformat <ID> - \ud3ec\ub9f7 \uc0ad\uc81c',
            '/addformat <x|instagram|both> <\ud3ec\ub9f7\uba85> (Enter)\n<\ud504\ub86c\ud504\ud2b8/\ud14d\uc2a4\ud2b8 \ub0b4\uc6a9> - \uc0c8 \ud3ec\ub9f7 \ucd94\uac00',
            '/askai <\uc694\uccad\uc0ac\ud56d> - AI\uc640 \uc0c8 \ud3ec\ub9f7 \uc544\uc774\ub514\uc5b4 \uae30\ud68d\ud558\uae30'
        ].join('\n');
        bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'Markdown' });
    });

    // /dx - X 초안 생성
    bot.onText(/\/dx/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        let draft = await getRandomFormatDraft('x');
        if (!draft) draft = getRandomDraft(); // fallback

        if (!draft) {
            bot.sendMessage(msg.chat.id, '\u274c \ud15c\ud50c\ub9bf\uc744 \ub85c\ub4dc\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');
            return;
        }

        const trendPrompt = await getTrendWeightsPrompt();
        const externalPrompt = await getExternalTrendPrompt();
        const prompts = [trendPrompt, externalPrompt].filter(Boolean).join('\n');
        if (prompts) {
            draft.text = `${prompts}\n\n${draft.text}`;
        }

        draft.platform = 'x';
        draft.imageUrl = null;

        // editorial/fashion_report 또는 DB 커스텀 포맷 → 이미지 생성
        const imageTypes = ['editorial', 'fashion_report'];
        if (imageTypes.includes(draft.type) || draft.type.startsWith('fmt_')) {
            try {
                await bot.sendMessage(msg.chat.id, '\ud83c\udfa8 \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc911...');
                draft.imageUrl = await generateImageForDraft(draft);
            } catch (err) {
                console.error('[Telegram] X \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc2e4\ud328:', err.message);
                await bot.sendMessage(msg.chat.id, `\u26a0\ufe0f \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc2e4\ud328 (\ud14d\uc2a4\ud2b8\ub9cc \ucd08\uc548): ${err.message}`);
            }
        }

        await sendDraftPreview(msg.chat.id, draft);
    });

    // /di - IG 초안 생성 (이미지 필수)
    bot.onText(/\/di/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        // IG는 이미지 필수 카테고리만
        let draft = await getRandomFormatDraft('instagram');
        if (!draft) draft = getRandomDraft(['editorial', 'fashion_report']);

        if (!draft) {
            bot.sendMessage(msg.chat.id, '\u274c \ud15c\ud50c\ub9bf\uc744 \ub85c\ub4dc\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');
            return;
        }

        const trendPrompt = await getTrendWeightsPrompt();
        const externalPrompt = await getExternalTrendPrompt();
        const prompts = [trendPrompt, externalPrompt].filter(Boolean).join('\n');
        if (prompts) {
            draft.text = `${prompts}\n\n${draft.text}`;
        }

        draft.platform = 'instagram';

        try {
            await bot.sendMessage(msg.chat.id, '\ud83c\udfa8 \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc911...');
            draft.imageUrl = await generateImageForDraft(draft);
        } catch (err) {
            console.error('[Telegram] IG \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc2e4\ud328:', err.message);
            await bot.sendMessage(msg.chat.id, `\u274c IG\ub294 \uc774\ubbf8\uc9c0\uac00 \ud544\uc218\uc785\ub2c8\ub2e4. \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc2e4\ud328: ${err.message}`);
            return;
        }

        if (!draft.imageUrl) {
            await bot.sendMessage(msg.chat.id, '\u274c IG\ub294 \uc774\ubbf8\uc9c0\uac00 \ud544\uc218\uc785\ub2c8\ub2e4. \uc774\ubbf8\uc9c0 \uc0dd\uc131\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.');
            return;
        }

        await sendDraftPreview(msg.chat.id, draft);
    });

    // /cn - 카드뉴스 생성
    bot.onText(/\/cn/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;
        await bot.sendMessage(msg.chat.id, '\ud83d\udcf0 \uce74\ub4dc\ub274\uc2a4 \ud0c0\uc785\uc744 \uc120\ud0dd\ud558\uc138\uc694:', {
            reply_markup: CN_TYPE_KEYBOARD,
        });
    });

    // /post <텍스트> - X 직접 작성
    bot.onText(/\/post (.+)/s, async (msg, match) => {
        if (!isAdmin(msg.chat.id)) return;
        const text = match[1].trim();
        const draft = { text, category: 'custom', type: 'custom', platform: 'x', imageUrl: null };
        await sendDraftPreview(msg.chat.id, draft);
    });

    // /status - rate limit 현황
    bot.onText(/\/status/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        const status = getRateLimitStatus();
        const statusText = [
            '\ud83d\udcca *\uac8c\uc2dc \ud604\ud669*',
            '',
            `\u23f0 \uc2dc\uac04\ub2f9: ${status.hourlyCount}/${status.hourlyLimit}`,
            `\ud83d\udcc5 \uc77c\uc77c: ${status.dailyCount}/${status.dailyLimit}`,
            '',
            `\u23f3 \uc2dc\uac04\ub2f9 \ub9ac\uc14b: ${status.hourlyResetIn}`,
            `\u23f3 \uc77c\uc77c \ub9ac\uc14b: ${status.dailyResetIn}`,
        ].join('\n');

        bot.sendMessage(msg.chat.id, statusText, { parse_mode: 'Markdown' });
    });

    // /templates - 하드코딩된 템플릿 목록 (레거시)
    bot.onText(/\/templates/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        const list = getTemplateList();
        const lines = ['\ud83d\udccb *\uae30\ubcf8 \ud15c\ud50c\ub9bf (JSON)*', ''];
        for (const [cat, count] of Object.entries(list)) {
            lines.push(`\u2022 ${cat}: ${count}\uac1c`);
        }
        bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
    });

    // /addformat <platform> <name> \n <text>
    bot.onText(/\/addformat (\w+) ([^\n]+)\n([\s\S]+)/, async (msg, match) => {
        if (!isAdmin(msg.chat.id)) return;
        const platform = match[1].toLowerCase();
        const name = match[2].trim();
        const text = match[3].trim();

        if (!['x', 'instagram', 'both'].includes(platform)) {
            bot.sendMessage(msg.chat.id, '\u274c \ud50c\ub7ab\ud3fc\uc740 x, instagram, both \uc911 \ud558\ub098\uc5ec\uc57c \ud569\ub2c8\ub2e4. \uc608: `/addformat x \ucef4\ubc31\ud3ec\ub9f7`', { parse_mode: 'Markdown' });
            return;
        }

        try {
            const added = await addFormat(platform, name, text);
            bot.sendMessage(msg.chat.id, `\u2705 \uc0c8\ub85c\uc6b4 DB \ud3ec\ub9f7\uc774 \ucd94\uac00\ub418\uc5c8\uc2b5\ub2c8\ub2e4!\nID: \`${added.id}\`\nName: ${added.name}`, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(msg.chat.id, `\u274c \ucd94\uac00 \uc2e4\ud328: ${err.message}`);
        }
    });

    // /listformat
    bot.onText(/\/listformat/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;
        try {
            const formats = await getFormats();
            if (formats.length === 0) {
                bot.sendMessage(msg.chat.id, '\ud83d\udcc1 \ud604\uc7ac \ub4f1\ub85d\ub41c DB \ud3ec\ub9f7\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. 기본 JSON 템플릿으로 떨어집니다.');
                return;
            }

            const lines = ['\ud83d\udccb *DB \ub3d9\uc801 \ud3ec\ub9f7 \ubaa9\ub85d*\n'];
            formats.forEach((f, i) => {
                lines.push(`\u2022 *[${f.platform}]* ${f.name} (\`${f.id}\`)`);
            });
            bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(msg.chat.id, `\u274c \uc624\ub958: ${err.message}`);
        }
    });

    // /delformat <id>
    bot.onText(/\/delformat (.+)/, async (msg, match) => {
        if (!isAdmin(msg.chat.id)) return;
        const id = match[1].trim();
        try {
            const success = await deleteFormat(id);
            if (success) {
                bot.sendMessage(msg.chat.id, `\u2705 포맷 (\`${id}\`)이(가) 삭제되었습니다.`, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(msg.chat.id, `\u274c 해당 ID(\`${id}\`)의 포맷을 찾을 수 없습니다.`, { parse_mode: 'Markdown' });
            }
        } catch (err) {
            bot.sendMessage(msg.chat.id, `\u274c \uc624\ub958: ${err.message}`);
        }
    });

    // /askai <요청사항> - 제미나이 AI와 포맷 브레인스토밍
    bot.onText(/\/askai (.+)/s, async (msg, match) => {
        if (!isAdmin(msg.chat.id)) return;
        const requestText = match[1].trim();

        await bot.sendMessage(msg.chat.id, '\ud83e\udd16 AI 에디터가 기획을 고민 중입니다... \n(이 결과물을 바로 적용하려면 `/addformat` 명령어를 쓰세요)');

        try {
            const result = await brainstormFormat('Both(통합)', requestText);
            bot.sendMessage(msg.chat.id, result, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(msg.chat.id, `\u274c AI \uc694\uccad \uc2e4\ud328: ${err.message}`);
        }
    });

    // ===== 콜백 핸들러 =====
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        if (!isAdmin(chatId)) return;

        const messageId = query.message.message_id;
        const action = query.data;

        // 카드뉴스 타입 선택 콜백
        if (action.startsWith('cn_type_')) {
            await handleCardNewsTypeSelect(bot, query, chatId, action);
            return;
        }

        // 카드뉴스 승인/거부
        if (action.startsWith('approve_cn_') || action === 'regenerate_cn') {
            await handleCardNewsCallback(bot, query, chatId, messageId, action);
            return;
        }

        // 일반 초안 콜백
        const draft = pendingDrafts.get(messageId);
        if (!draft) {
            await bot.answerCallbackQuery(query.id, { text: '\u26a0\ufe0f \ucd08\uc548\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.' });
            return;
        }

        switch (action) {
            case 'approve_x':
                await handleApproveX(bot, query, chatId, messageId, draft);
                break;

            case 'approve_ig':
                await handleApproveIG(bot, query, chatId, messageId, draft);
                break;

            case 'edit':
                await bot.answerCallbackQuery(query.id, { text: '\uc218\uc815 \ubaa8\ub4dc' });
                editMode.set(chatId, messageId);
                await bot.sendMessage(chatId, '\u270f\ufe0f \uc218\uc815\ud560 \ud14d\uc2a4\ud2b8\ub97c \ubcf4\ub0b4\uc8fc\uc138\uc694:');
                break;

            case 'regenerate_x':
                await handleRegenerate(bot, query, chatId, messageId, draft, 'x');
                break;

            case 'regenerate_ig':
                await handleRegenerate(bot, query, chatId, messageId, draft, 'instagram');
                break;

            case 'regenerate_image':
                await handleRegenerateImage(bot, query, chatId, messageId, draft);
                break;

            case 'reject':
                await bot.answerCallbackQuery(query.id, { text: '\ucd08\uc548 \ud3d0\uae30\ub428' });
                pendingDrafts.delete(messageId);
                await clearButtons(bot, chatId, messageId);
                await bot.sendMessage(chatId, '\ud83d\uddd1\ufe0f \ucd08\uc548\uc774 \ud3d0\uae30\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
                break;
        }
    });

    // ===== 수정 모드: 사용자 메시지 수신 =====
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(chatId)) return;
        if (!msg.text || msg.text.startsWith('/')) return;
        if (!editMode.has(chatId)) return;

        const originalMessageId = editMode.get(chatId);
        const originalDraft = pendingDrafts.get(originalMessageId);
        editMode.delete(chatId);

        if (!originalDraft) {
            await bot.sendMessage(chatId, '\u26a0\ufe0f \uc6d0\ubcf8 \ucd08\uc548\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');
            return;
        }

        await clearButtons(bot, chatId, originalMessageId);
        pendingDrafts.delete(originalMessageId);

        const editedDraft = {
            text: msg.text,
            category: originalDraft.category,
            type: originalDraft.type,
            platform: originalDraft.platform,
            imageUrl: originalDraft.imageUrl,
            artist: originalDraft.artist,
        };
        await sendDraftPreview(chatId, editedDraft);
    });

    console.log('[Telegram] \ubd07\uc774 \uc2dc\uc791\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
    return bot;
}

// ===== 콜백 핸들러 함수들 =====

async function clearButtons(bot, chatId, messageId) {
    try {
        await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
        );
    } catch (_) {
        // 이미 제거된 경우 무시
    }
}

async function handleApproveX(bot, query, chatId, messageId, draft) {
    await bot.answerCallbackQuery(query.id, { text: 'X \uac8c\uc2dc \uc911...' });
    await clearButtons(bot, chatId, messageId);

    try {
        const imageUrls = draft.imageUrl ? [draft.imageUrl] : [];
        const result = await postToSNS({
            platforms: ['x'],
            text: draft.text,
            imageUrls,
        });

        if (result.x && result.x.success) {
            await bot.sendMessage(chatId, `\u2705 X\uc5d0 \uac8c\uc2dc \uc644\ub8cc!\n\ud83d\udd17 https://x.com/i/status/${result.x.id}`);
        } else {
            const error = result.x ? result.x.error : '\uc54c \uc218 \uc5c6\ub294 \uc624\ub958';
            await bot.sendMessage(chatId, `\u274c \uac8c\uc2dc \uc2e4\ud328: ${error}`);
        }
    } catch (err) {
        await bot.sendMessage(chatId, `\u274c \uac8c\uc2dc \uc911 \uc624\ub958: ${err.message}`);
    }

    pendingDrafts.delete(messageId);
}

async function handleApproveIG(bot, query, chatId, messageId, draft) {
    if (!draft.imageUrl) {
        await bot.answerCallbackQuery(query.id, { text: '\u274c \uc774\ubbf8\uc9c0\uac00 \uc5c6\uc2b5\ub2c8\ub2e4' });
        return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'IG \uac8c\uc2dc \uc911...' });
    await clearButtons(bot, chatId, messageId);

    try {
        const result = await postToSNS({
            platforms: ['instagram'],
            text: draft.text,
            imageUrls: [draft.imageUrl],
        });

        if (result.instagram && result.instagram.success) {
            await bot.sendMessage(chatId, `\u2705 Instagram\uc5d0 \uac8c\uc2dc \uc644\ub8cc! (ID: ${result.instagram.id})`);
        } else {
            const error = result.instagram ? result.instagram.error : '\uc54c \uc218 \uc5c6\ub294 \uc624\ub958';
            await bot.sendMessage(chatId, `\u274c IG \uac8c\uc2dc \uc2e4\ud328: ${error}`);
        }
    } catch (err) {
        await bot.sendMessage(chatId, `\u274c IG \uac8c\uc2dc \uc911 \uc624\ub958: ${err.message}`);
    }

    pendingDrafts.delete(messageId);
}

async function handleRegenerate(bot, query, chatId, messageId, draft, platform) {
    await bot.answerCallbackQuery(query.id, { text: '\ub2e4\uc2dc \uc0dd\uc131 \uc911...' });
    pendingDrafts.delete(messageId);
    await clearButtons(bot, chatId, messageId);

    const categoryFilter = platform === 'instagram'
        ? ['editorial', 'fashion_report']
        : (draft.type !== 'custom' ? draft.type : null);

    let newDraft = await getRandomFormatDraft(platform);
    if (!newDraft) newDraft = getRandomDraft(categoryFilter);

    if (!newDraft) {
        await bot.sendMessage(chatId, '\u274c \uc0c8 \ucd08\uc548 \uc0dd\uc131\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.');
        return;
    }

    newDraft.platform = platform;
    newDraft.imageUrl = null;

    // 이미지 필요 여부 판단
    const needsImage = platform === 'instagram' ||
        (platform === 'x' && (['editorial', 'fashion_report'].includes(newDraft.type) || newDraft.type.startsWith('fmt_')));

    if (needsImage) {
        try {
            await bot.sendMessage(chatId, '\ud83c\udfa8 \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc911...');
            newDraft.imageUrl = await generateImageForDraft(newDraft);
        } catch (err) {
            if (platform === 'instagram') {
                await bot.sendMessage(chatId, `\u274c IG \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc2e4\ud328: ${err.message}`);
                return;
            }
            await bot.sendMessage(chatId, `\u26a0\ufe0f \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc2e4\ud328 (\ud14d\uc2a4\ud2b8\ub9cc \ucd08\uc548): ${err.message}`);
        }
    }

    await sendDraftPreview(chatId, newDraft);
}

async function handleRegenerateImage(bot, query, chatId, messageId, draft) {
    await bot.answerCallbackQuery(query.id, { text: '\uc774\ubbf8\uc9c0 \uc7ac\uc0dd\uc131 \uc911...' });

    try {
        await bot.sendMessage(chatId, '\ud83c\udfa8 \uc774\ubbf8\uc9c0 \uc7ac\uc0dd\uc131 \uc911...');
        const newImageUrl = await generateImageForDraft(draft);
        if (!newImageUrl) {
            await bot.sendMessage(chatId, '\u274c \uc774\ubbf8\uc9c0 \uc7ac\uc0dd\uc131\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.');
            return;
        }

        pendingDrafts.delete(messageId);
        await clearButtons(bot, chatId, messageId);

        draft.imageUrl = newImageUrl;
        await sendDraftPreview(chatId, draft);
    } catch (err) {
        await bot.sendMessage(chatId, `\u274c \uc774\ubbf8\uc9c0 \uc7ac\uc0dd\uc131 \uc2e4\ud328: ${err.message}`);
    }
}

// ===== 카드뉴스 핸들러 =====

async function handleCardNewsTypeSelect(bot, query, chatId, action) {
    const cnType = action.replace('cn_type_', '');
    await bot.answerCallbackQuery(query.id, { text: '\uce74\ub4dc\ub274\uc2a4 \uc0dd\uc131 \uc911...' });

    const cardData = getCardNewsData(cnType);
    if (!cardData) {
        await bot.sendMessage(chatId, '\u274c \uce74\ub4dc\ub274\uc2a4 \ub370\uc774\ud130\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');
        return;
    }

    await bot.sendMessage(chatId, '\ud83d\udcf0 \uce74\ub4dc\ub274\uc2a4 \uc0dd\uc131 \uc911...\n\uce74\ubc84 \uc774\ubbf8\uc9c0 Recraft V3 \uc0dd\uc131 + \uc2ac\ub77c\uc774\ub4dc \ub80c\ub354\ub9c1 \uc911');

    try {
        // 커버 이미지 생성 (Recraft V3 - 타이포그래피/포스터 특화)
        let coverImageUrl = null;
        try {
            coverImageUrl = await generateCardNewsCover({
                title: cardData.title,
                artist: cardData.artist,
                type: cnType,
            });
        } catch (err) {
            console.warn('[CardNews] Recraft V3 \uce74\ubc84 \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc2e4\ud328:', err.message);
        }

        cardData.coverImageUrl = coverImageUrl;

        // 슬라이드 생성 + Firebase 업로드
        const imageUrls = await generateAndUploadCardNews(cardData);

        // 텔레그램에 앨범으로 미리보기 전송
        const mediaGroup = imageUrls.map((url, i) => ({
            type: 'photo',
            media: url,
            ...(i === 0 ? { caption: `\ud83d\udcf0 *${cardData.title}*\n\n${cardData.caption || ''}\n\n\uc2ac\ub77c\uc774\ub4dc ${imageUrls.length}\uc7a5`, parse_mode: 'Markdown' } : {}),
        }));

        await bot.sendMediaGroup(chatId, mediaGroup);

        // 승인 버튼
        const sent = await bot.sendMessage(chatId, '\u2b06\ufe0f \uce74\ub4dc\ub274\uc2a4 \ubbf8\ub9ac\ubcf4\uae30 \uc644\ub8cc. \uac8c\uc2dc \ud50c\ub7ab\ud3fc\uc744 \uc120\ud0dd\ud558\uc138\uc694:', {
            reply_markup: makeCnKeyboard(),
        });

        pendingCardNews.set(sent.message_id, {
            type: cnType,
            title: cardData.title,
            caption: cardData.caption || cardData.title,
            imageUrls,
            artist: cardData.artist,
        });
    } catch (err) {
        await bot.sendMessage(chatId, `\u274c \uce74\ub4dc\ub274\uc2a4 \uc0dd\uc131 \uc2e4\ud328: ${err.message}`);
    }
}

async function handleCardNewsCallback(bot, query, chatId, messageId, action) {
    const cnData = pendingCardNews.get(messageId);
    if (!cnData) {
        await bot.answerCallbackQuery(query.id, { text: '\u26a0\ufe0f \uce74\ub4dc\ub274\uc2a4 \ub370\uc774\ud130\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.' });
        return;
    }

    switch (action) {
        case 'approve_cn_x': {
            await bot.answerCallbackQuery(query.id, { text: 'X \uc2a4\ub808\ub4dc \uac8c\uc2dc \uc911...' });
            await clearButtons(bot, chatId, messageId);

            try {
                // 첫 트윗에 커버 이미지 + 텍스트, 나머지는 이미지만
                const threadItems = cnData.imageUrls.map((url, i) => ({
                    text: i === 0 ? cnData.caption : `[${i}/${cnData.imageUrls.length - 1}]`,
                    imageUrls: [url],
                }));

                const result = await postThread(threadItems);

                if (result.success) {
                    const firstTweetId = result.tweets[0].id;
                    await bot.sendMessage(chatId,
                        `\u2705 X \uc2a4\ub808\ub4dc \uac8c\uc2dc \uc644\ub8cc! (${result.tweets.length}\uac1c \ud2b8\uc717)\n\ud83d\udd17 https://x.com/i/status/${firstTweetId}`
                    );
                } else {
                    await bot.sendMessage(chatId, `\u274c X \uc2a4\ub808\ub4dc \uac8c\uc2dc \uc2e4\ud328: ${result.error}`);
                }
            } catch (err) {
                await bot.sendMessage(chatId, `\u274c X \uc2a4\ub808\ub4dc \uac8c\uc2dc \uc911 \uc624\ub958: ${err.message}`);
            }

            pendingCardNews.delete(messageId);
            break;
        }

        case 'approve_cn_ig': {
            await bot.answerCallbackQuery(query.id, { text: 'IG \uce90\ub7ec\uc140 \uac8c\uc2dc \uc911...' });
            await clearButtons(bot, chatId, messageId);

            try {
                const result = await postCarousel({
                    text: cnData.caption,
                    imageUrls: cnData.imageUrls,
                });

                if (result.success) {
                    await bot.sendMessage(chatId, `\u2705 Instagram \uce90\ub7ec\uc140 \uac8c\uc2dc \uc644\ub8cc! (ID: ${result.id})`);
                } else {
                    await bot.sendMessage(chatId, `\u274c IG \uce90\ub7ec\uc140 \uac8c\uc2dc \uc2e4\ud328: ${result.error}`);
                }
            } catch (err) {
                await bot.sendMessage(chatId, `\u274c IG \uce90\ub7ec\uc140 \uac8c\uc2dc \uc911 \uc624\ub958: ${err.message}`);
            }

            pendingCardNews.delete(messageId);
            break;
        }

        case 'regenerate_cn': {
            await bot.answerCallbackQuery(query.id, { text: '\uce74\ub4dc\ub274\uc2a4 \ub2e4\uc2dc \uc0dd\uc131 \uc911...' });
            pendingCardNews.delete(messageId);
            await clearButtons(bot, chatId, messageId);

            // 같은 타입으로 재생성
            await handleCardNewsTypeSelect(bot, query, chatId, `cn_type_${cnData.type}`);
            break;
        }
    }
}

// ===== 스케줄러용 export 함수들 =====

/**
 * X 자동 초안 생성 (스케줄러에서 호출)
 */
export async function sendScheduledDraftX(bot) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    let draft = await getRandomFormatDraft('x');
    if (!draft) draft = getRandomDraft();

    if (!draft) return;

    const trendPrompt = await getTrendWeightsPrompt();
    const externalPrompt = await getExternalTrendPrompt();
    const prompts = [trendPrompt, externalPrompt].filter(Boolean).join('\n');
    if (prompts) {
        draft.text = `${prompts}\n\n${draft.text}`;
    }

    draft.platform = 'x';
    draft.imageUrl = null;

    // editorial/fashion_report 또는 DB 커스텀 포맷 → 이미지 생성
    if (['editorial', 'fashion_report'].includes(draft.type) || draft.type.startsWith('fmt_')) {
        try {
            draft.imageUrl = await generateImageForDraft(draft);
        } catch (err) {
            console.error('[Scheduler] X \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc2e4\ud328:', err.message);
        }
    }

    const preview = formatDraftPreview(draft, '[\uc790\ub3d9] ');
    const keyboard = X_DRAFT_KEYBOARD;

    let sent;
    if (draft.imageUrl) {
        const caption = preview.length > 1024 ? preview.substring(0, 1021) + '...' : preview;
        sent = await bot.sendPhoto(adminChatId, draft.imageUrl, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    } else {
        sent = await bot.sendMessage(adminChatId, preview, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    }
    pendingDrafts.set(sent.message_id, draft);
}

/**
 * IG 자동 초안 생성 (스케줄러에서 호출, 항상 이미지 포함)
 */
export async function sendScheduledDraftIG(bot) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    // IG는 이미지 필수 카테고리만
    let draft = await getRandomFormatDraft('instagram');
    if (!draft) draft = getRandomDraft(['editorial', 'fashion_report']);

    if (!draft) return;

    const trendPrompt = await getTrendWeightsPrompt();
    const externalPrompt = await getExternalTrendPrompt();
    const prompts = [trendPrompt, externalPrompt].filter(Boolean).join('\n');
    if (prompts) {
        draft.text = `${prompts}\n\n${draft.text}`;
    }

    draft.platform = 'instagram';

    try {
        draft.imageUrl = await generateImageForDraft(draft);
    } catch (err) {
        console.error('[Scheduler] IG \uc774\ubbf8\uc9c0 \uc0dd\uc131 \uc2e4\ud328:', err.message);
        return; // IG는 이미지 필수이므로 중단
    }

    if (!draft.imageUrl) return;

    const preview = formatDraftPreview(draft, '[\uc790\ub3d9] ');
    const caption = preview.length > 1024 ? preview.substring(0, 1021) + '...' : preview;

    const sent = await bot.sendPhoto(adminChatId, draft.imageUrl, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: IG_DRAFT_KEYBOARD,
    });
    pendingDrafts.set(sent.message_id, draft);
}

/**
 * 하위 호환성: 기존 sendScheduledDraft → X 초안으로 동작
 */
export async function sendScheduledDraft(bot) {
    return sendScheduledDraftX(bot);
}
