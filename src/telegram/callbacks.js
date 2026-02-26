import { postToSNS } from '../bot.js';
import { getRandomDraft } from '../templates.js';
import { generateImageForDraft } from '../imageGen.js';
import { getRandomFormatDraft } from '../formatManager.js';
import { getFormatName, getTodaySchedule, getDayName } from '../contentCalendar.js';

import { pendingDrafts, editMode, updateDraftStatus } from './state.js';
import { clearButtons, sendDraftPreview, createIsAdmin } from './helpers.js';
import { handleCardNewsTypeSelect, handleCardNewsCallback } from './cardnews.js';

/**
 * 콜백 쿼리 핸들러 + 수정 모드 핸들러를 등록한다.
 * @param {object} commandHandlers - registerCommands()에서 반환한 핸들러 참조
 */
export function registerCallbacks(bot, adminChatId, commandHandlers) {
    const isAdmin = createIsAdmin(adminChatId);

    // ===== 콜백 핸들러 =====
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        if (!isAdmin(chatId)) return;

        const messageId = query.message.message_id;
        const action = query.data;

        // 메인 메뉴 버튼 처리
        if (action.startsWith('menu_')) {
            await bot.answerCallbackQuery(query.id);
            const mockMsg = { chat: { id: chatId } };
            switch (action) {
                case 'menu_dx': await commandHandlers.handleDx(mockMsg); break;
                case 'menu_di': await commandHandlers.handleDi(mockMsg); break;
                case 'menu_cn': await commandHandlers.handleCn(mockMsg); break;
                case 'menu_status': await commandHandlers.handleStatus(mockMsg); break;
                case 'menu_listformat': await commandHandlers.handleListFormat(mockMsg); break;
                case 'menu_report': await commandHandlers.handleReport(mockMsg); break;
                case 'menu_askai': {
                    await bot.sendMessage(chatId, '🤖 AI에게 기획 아이디어를 물어보려면 텍스트와 함께 입력해주세요.\n\n예시:\n`/askai 뉴진스 컴백인데 Y2K 룩 기획해줘`', { parse_mode: 'Markdown' });
                    break;
                }
                case 'menu_schedule': await commandHandlers.handleSchedule({ chat: { id: chatId } }); break;
            }
            return;
        }

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
            await bot.answerCallbackQuery(query.id, { text: '⚠️ 초안을 찾을 수 없습니다.' });
            return;
        }

        switch (action) {
            case 'approve_x':
                await handleApproveX(bot, query, chatId, messageId, draft);
                break;

            case 'approve_ig':
                await handleApproveIG(bot, query, chatId, messageId, draft);
                break;

            case 'approve_both':
                await handleApproveBoth(bot, query, chatId, messageId, draft);
                break;

            case 'edit':
                await bot.answerCallbackQuery(query.id, { text: '수정 모드' });
                editMode.set(chatId, messageId);
                await bot.sendMessage(chatId, '✏️ 수정할 텍스트를 보내주세요:');
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
                await bot.answerCallbackQuery(query.id, { text: '초안 폐기됨' });
                await updateDraftStatus(messageId, 'rejected');
                await clearButtons(bot, chatId, messageId);
                await bot.sendMessage(chatId, '🗑️ 초안이 폐기되었습니다.');
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
            await bot.sendMessage(chatId, '⚠️ 원본 초안을 찾을 수 없습니다.');
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
        await sendDraftPreview(bot, chatId, editedDraft);
    });
}

// ===== 콜백 핸들러 함수들 =====

async function handleApproveX(bot, query, chatId, messageId, draft) {
    await bot.answerCallbackQuery(query.id, { text: 'X 게시 중...' });
    await clearButtons(bot, chatId, messageId);

    try {
        const imageUrls = draft.imageUrl ? [draft.imageUrl] : [];
        const result = await postToSNS({
            platforms: ['x'],
            text: draft.text,
            imageUrls,
        });

        if (result.x && result.x.success) {
            await bot.sendMessage(chatId, `✅ X에 게시 완료!\n🔗 https://x.com/i/status/${result.x.id}`);
        } else {
            const error = result.x ? result.x.error : '알 수 없는 오류';
            await bot.sendMessage(chatId, `❌ 게시 실패: ${error}`);
        }
    } catch (err) {
        await bot.sendMessage(chatId, `❌ 게시 중 오류: ${err.message}`);
    }

    await updateDraftStatus(messageId, 'approved', { approvedPlatform: 'x' });
}

async function handleApproveIG(bot, query, chatId, messageId, draft) {
    if (!draft.imageUrl) {
        await bot.answerCallbackQuery(query.id, { text: '❌ 이미지가 없습니다' });
        return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'IG 게시 중...' });
    await clearButtons(bot, chatId, messageId);

    try {
        const result = await postToSNS({
            platforms: ['instagram'],
            text: draft.text,
            imageUrls: [draft.imageUrl],
        });

        if (result.instagram && result.instagram.success) {
            await bot.sendMessage(chatId, `✅ Instagram에 게시 완료! (ID: ${result.instagram.id})`);
        } else {
            const error = result.instagram ? result.instagram.error : '알 수 없는 오류';
            await bot.sendMessage(chatId, `❌ IG 게시 실패: ${error}`);
        }
    } catch (err) {
        await bot.sendMessage(chatId, `❌ IG 게시 중 오류: ${err.message}`);
    }

    await updateDraftStatus(messageId, 'approved', { approvedPlatform: 'instagram' });
}

/**
 * X+IG 동시 게시 (크로스포스팅)
 */
async function handleApproveBoth(bot, query, chatId, messageId, draft) {
    if (!draft.imageUrl) {
        await bot.answerCallbackQuery(query.id, { text: '❌ IG는 이미지가 필요합니다' });
        return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'X+IG 동시 게시 중...' });
    await clearButtons(bot, chatId, messageId);

    try {
        const result = await postToSNS({
            platforms: ['x', 'instagram'],
            text: draft.text,
            imageUrls: [draft.imageUrl],
        });

        const messages = [];
        if (result.x?.success) {
            messages.push(`✅ X 게시 완료! 🔗 https://x.com/i/status/${result.x.id}`);
        } else if (result.x) {
            messages.push(`❌ X 게시 실패: ${result.x.error}`);
        }
        if (result.instagram?.success) {
            messages.push(`✅ Instagram 게시 완료! (ID: ${result.instagram.id})`);
        } else if (result.instagram) {
            messages.push(`❌ IG 게시 실패: ${result.instagram.error}`);
        }

        await bot.sendMessage(chatId, messages.join('\n'));
    } catch (err) {
        await bot.sendMessage(chatId, `❌ 동시 게시 중 오류: ${err.message}`);
    }

    await updateDraftStatus(messageId, 'approved', { approvedPlatform: 'both' });
}

async function handleRegenerate(bot, query, chatId, messageId, draft, platform) {
    await bot.answerCallbackQuery(query.id, { text: '다시 생성 중...' });
    await updateDraftStatus(messageId, 'rejected');
    await clearButtons(bot, chatId, messageId);

    const categoryFilter = platform === 'instagram'
        ? ['editorial', 'fashion_report']
        : (draft.type !== 'custom' ? draft.type : null);

    let newDraft = await getRandomFormatDraft(platform);
    if (!newDraft) newDraft = getRandomDraft(categoryFilter);

    if (!newDraft) {
        await bot.sendMessage(chatId, '❌ 새 초안 생성에 실패했습니다.');
        return;
    }

    newDraft.platform = platform;
    newDraft.imageUrl = null;

    // 이미지 필요 여부 판단
    const needsImage = platform === 'instagram' ||
        (platform === 'x' && (['editorial', 'fashion_report'].includes(newDraft.type) || newDraft.type.startsWith('fmt_')));

    if (needsImage) {
        try {
            await bot.sendMessage(chatId, '🎨 이미지 생성 중...');
            newDraft.imageUrl = await generateImageForDraft(newDraft);
        } catch (err) {
            if (platform === 'instagram') {
                await bot.sendMessage(chatId, `❌ IG 이미지 생성 실패: ${err.message}`);
                return;
            }
            await bot.sendMessage(chatId, `⚠️ 이미지 생성 실패 (텍스트만 초안): ${err.message}`);
        }
    }

    await sendDraftPreview(bot, chatId, newDraft);
}

async function handleRegenerateImage(bot, query, chatId, messageId, draft) {
    await bot.answerCallbackQuery(query.id, { text: '이미지 재생성 중...' });

    try {
        await bot.sendMessage(chatId, '🎨 이미지 재생성 중...');
        const newImageUrl = await generateImageForDraft(draft);
        if (!newImageUrl) {
            await bot.sendMessage(chatId, '❌ 이미지 재생성에 실패했습니다.');
            return;
        }

        pendingDrafts.delete(messageId);
        await clearButtons(bot, chatId, messageId);

        draft.imageUrl = newImageUrl;
        await sendDraftPreview(bot, chatId, draft);
    } catch (err) {
        await bot.sendMessage(chatId, `❌ 이미지 재생성 실패: ${err.message}`);
    }
}
