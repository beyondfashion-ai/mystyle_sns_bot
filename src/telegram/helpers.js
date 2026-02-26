import { pendingDrafts } from './state.js';
import { getDraftKeyboard, formatDraftPreview } from './keyboards.js';

/**
 * Admin 체크 함수 생성
 */
export function createIsAdmin(adminChatId) {
    return (chatId) => String(chatId) === String(adminChatId);
}

/**
 * 인라인 키보드 버튼 제거
 */
export async function clearButtons(bot, chatId, messageId) {
    try {
        await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
        );
    } catch (_) {
        // 이미 제거된 경우 무시
    }
}

/**
 * 초안 미리보기 전송 (이미지 있으면 사진, 없으면 텍스트)
 */
export async function sendDraftPreview(bot, chatId, draft, prefix = '') {
    const preview = formatDraftPreview(draft, prefix);
    const keyboard = getDraftKeyboard(draft);

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
