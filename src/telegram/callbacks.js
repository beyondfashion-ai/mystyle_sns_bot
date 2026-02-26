import { postToSNS } from '../bot.js';
import { getRandomDraft } from '../templates.js';
import { generateImageForDraft } from '../imageGen.js';
import { getRandomFormatDraft } from '../formatManager.js';
import { refineDraftWithAI } from '../contentGenerator.js';
import { getFormatName, getTodaySchedule, getDayName } from '../contentCalendar.js';
import { db } from '../firebase.js';

import { pendingDrafts, editMode, updateDraftStatus } from './state.js';
import { clearButtons, sendDraftPreview, createIsAdmin } from './helpers.js';
import { handleCardNewsTypeSelect, handleCardNewsCallback } from './cardnews.js';
import { isSchedulerPaused, pauseScheduler, resumeScheduler } from './schedulerControl.js';
import { queueApprovedDraft } from './draftQueue.js';
import { regenerateForSlot } from './scheduled.js';

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
                case 'menu_scheduler': await commandHandlers.handleScheduler({ chat: { id: chatId } }); break;
                case 'menu_history': await commandHandlers.handleHistory({ chat: { id: chatId } }); break;
            }
            return;
        }

        // 섹션 구분선 버튼 (no-op)
        if (action.startsWith('section_')) {
            await bot.answerCallbackQuery(query.id);
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

        // 스케줄러 관리 콜백
        if (action.startsWith('scheduler_')) {
            await handleSchedulerCallback(bot, query, chatId, action);
            return;
        }

        // 히스토리 조회 콜백
        if (action.startsWith('history_')) {
            await handleHistoryCallback(bot, query, chatId, action);
            return;
        }

        // 일반 초안 콜백
        const draft = pendingDrafts.get(messageId);
        if (!draft) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ 초안을 찾을 수 없습니다.' });
            return;
        }

        switch (action) {
            case 'approve_scheduled':
                await handleApproveScheduled(bot, query, chatId, messageId, draft);
                break;

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
                editMode.set(chatId, { messageId, mode: 'edit' });
                await bot.sendMessage(chatId, '✏️ 수정할 텍스트를 보내주세요:');
                break;

            case 'ai_refine':
                await bot.answerCallbackQuery(query.id, { text: 'AI 수정 모드' });
                editMode.set(chatId, { messageId, mode: 'ai_refine' });
                await bot.sendMessage(chatId, '💬 *AI 수정 모드*\n\n수정 방향을 자유롭게 알려주세요.\n\n예시:\n• "좀 더 짧게"\n• "해시태그 더 추가해줘"\n• "톤을 좀 더 캐주얼하게"\n• "뉴진스 하니 언급 추가"\n• "CTA를 더 강하게"', { parse_mode: 'Markdown' });
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
                if (draft.slotKey) {
                    // 예약 초안: 거부 → 자동 재생성
                    await bot.answerCallbackQuery(query.id, { text: '새로 생성 중...' });
                    await updateDraftStatus(messageId, 'rejected');
                    await clearButtons(bot, chatId, messageId);
                    const platformLabel = draft.platform === 'instagram' ? 'IG' : 'X';
                    await bot.sendMessage(chatId, `🔄 ${draft.scheduledHour}:00 ${platformLabel} 초안을 새로 생성합니다...`);
                    try {
                        await regenerateForSlot(bot, chatId, draft.slotKey, draft.platform, draft.category, draft.scheduledHour);
                    } catch (err) {
                        console.error('[Callbacks] 예약 초안 재생성 실패:', err.message);
                        await bot.sendMessage(chatId, `❌ 재생성 실패: ${err.message}`);
                    }
                } else {
                    // 수동 초안: 그냥 폐기
                    await bot.answerCallbackQuery(query.id, { text: '초안 폐기됨' });
                    await updateDraftStatus(messageId, 'rejected');
                    await clearButtons(bot, chatId, messageId);
                    await bot.sendMessage(chatId, '🗑️ 초안이 폐기되었습니다.');
                }
                break;
        }
    });

    // ===== 수정 모드: 사용자 메시지 수신 =====
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(chatId)) return;
        if (!msg.text || msg.text.startsWith('/')) return;
        if (!editMode.has(chatId)) return;

        const entry = editMode.get(chatId);
        const originalMessageId = typeof entry === 'object' ? entry.messageId : entry;
        const mode = typeof entry === 'object' ? entry.mode : 'edit';
        const originalDraft = pendingDrafts.get(originalMessageId);
        editMode.delete(chatId);

        if (!originalDraft) {
            await bot.sendMessage(chatId, '⚠️ 원본 초안을 찾을 수 없습니다.');
            return;
        }

        // 예약 정보 보존용
        const scheduleFields = originalDraft.slotKey
            ? { slotKey: originalDraft.slotKey, scheduledHour: originalDraft.scheduledHour }
            : {};

        if (mode === 'ai_refine') {
            // AI 수정 모드: Gemini Flash로 피드백 반영
            await bot.sendMessage(chatId, '🤖 AI가 피드백을 반영하여 수정 중...');
            try {
                const refinedText = await refineDraftWithAI(originalDraft, msg.text);
                await clearButtons(bot, chatId, originalMessageId);
                pendingDrafts.delete(originalMessageId);

                const refinedDraft = {
                    text: refinedText,
                    category: originalDraft.category,
                    type: originalDraft.type,
                    platform: originalDraft.platform,
                    imageUrl: originalDraft.imageUrl,
                    artist: originalDraft.artist,
                    imageDirection: originalDraft.imageDirection,
                    ...scheduleFields,
                };
                const prefix = originalDraft.slotKey
                    ? `⏰${originalDraft.scheduledHour}:00 AI수정 `
                    : 'AI 수정 ';
                await sendDraftPreview(bot, chatId, refinedDraft, prefix);
            } catch (err) {
                console.error('[Callbacks] AI 수정 실패:', err.message);
                await bot.sendMessage(chatId, `❌ AI 수정 실패: ${err.message}\n\n원본 초안이 유지됩니다. 다시 시도하거나 직접 수정해주세요.`);
            }
        } else {
            // 일반 수정 모드: 사용자 텍스트로 직접 교체
            await clearButtons(bot, chatId, originalMessageId);
            pendingDrafts.delete(originalMessageId);

            const editedDraft = {
                text: msg.text,
                category: originalDraft.category,
                type: originalDraft.type,
                platform: originalDraft.platform,
                imageUrl: originalDraft.imageUrl,
                artist: originalDraft.artist,
                imageDirection: originalDraft.imageDirection,
                ...scheduleFields,
            };
            await sendDraftPreview(bot, chatId, editedDraft);
        }
    });
}

// ===== 콜백 핸들러 함수들 =====

/**
 * 예약 초안 승인 → 큐에 저장, 예약 시간에 자동 게시
 */
async function handleApproveScheduled(bot, query, chatId, messageId, draft) {
    if (!draft.slotKey) {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ 예약 정보 없음' });
        return;
    }

    const platformLabel = draft.platform === 'instagram' ? 'IG' : 'X';
    await bot.answerCallbackQuery(query.id, { text: `${draft.scheduledHour}:00 게시 예약` });
    await clearButtons(bot, chatId, messageId);

    queueApprovedDraft(draft.slotKey, draft);
    await updateDraftStatus(messageId, 'approved', {
        approvedPlatform: draft.platform === 'instagram' ? 'instagram' : 'x',
        scheduledHour: draft.scheduledHour,
        slotKey: draft.slotKey,
    });

    await bot.sendMessage(chatId,
        `✅ *${draft.scheduledHour}:00 ${platformLabel} 게시 예약 완료*\n\n예약 시간에 자동으로 게시됩니다.`,
        { parse_mode: 'Markdown' });
}

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

// ===== 스케줄러 관리 콜백 =====

async function handleSchedulerCallback(bot, query, chatId, action) {
    switch (action) {
        case 'scheduler_pause': {
            await pauseScheduler();
            await bot.answerCallbackQuery(query.id, { text: '스케줄러 일시정지' });
            await bot.sendMessage(chatId, '⏸️ 스케줄러가 *일시정지* 되었습니다.\n자동 초안 생성이 중단됩니다. (에디토리얼 진화는 계속 실행)', { parse_mode: 'Markdown' });
            break;
        }
        case 'scheduler_resume': {
            await resumeScheduler();
            await bot.answerCallbackQuery(query.id, { text: '스케줄러 재개' });
            await bot.sendMessage(chatId, '▶️ 스케줄러가 *재개* 되었습니다.\n자동 초안 생성이 다시 시작됩니다.', { parse_mode: 'Markdown' });
            break;
        }
        case 'scheduler_next': {
            await bot.answerCallbackQuery(query.id);
            const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
            const currentHour = kstNow.getHours();
            const schedule = getTodaySchedule();
            const dayName = getDayName(kstNow.getDay());

            const nextX = schedule.x.find(s => s.hour > currentHour);
            const nextIG = schedule.ig.find(s => s.hour > currentHour);
            const paused = isSchedulerPaused();

            const lines = [`📋 *다음 예정 작업* (${dayName}요일)`, ''];
            if (paused) lines.push('⚠️ 스케줄러 일시정지 중 — 아래 작업은 재개 후 실행됩니다.', '');
            if (nextX) lines.push(`X: ${nextX.hour}:00 KST — ${getFormatName(nextX.format)}`);
            if (nextIG) lines.push(`IG: ${nextIG.hour}:00 KST — ${getFormatName(nextIG.format)}`);
            if (!nextX && !nextIG) lines.push('오늘 남은 예정 작업이 없습니다.');

            await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
            break;
        }
    }
}

// ===== 히스토리 조회 콜백 =====

async function handleHistoryCallback(bot, query, chatId, action) {
    await bot.answerCallbackQuery(query.id);

    if (!db) {
        await bot.sendMessage(chatId, '⚠️ Firestore 미연결. 이력 조회가 불가합니다.');
        return;
    }

    const status = action === 'history_approved' ? 'approved' : 'rejected';
    const label = status === 'approved' ? '승인' : '거부';

    try {
        const snapshot = await db.collection('telegram_drafts')
            .where('status', '==', status)
            .orderBy('updatedAt', 'desc')
            .limit(5)
            .get();

        if (snapshot.empty) {
            await bot.sendMessage(chatId, `📜 최근 ${label}된 초안이 없습니다.`);
            return;
        }

        const lines = [`📜 *최근 ${label} 초안 (${snapshot.size}건)*`, ''];
        let idx = 1;
        snapshot.forEach(doc => {
            const d = doc.data();
            const date = d.updatedAt?.toDate?.() || d.createdAt?.toDate?.() || new Date();
            const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
            const platform = d.platform === 'instagram' ? 'IG' : 'X';
            const extra = d.approvedPlatform === 'both' ? ' (X+IG)' : '';
            const preview = (d.text || '').replace(/\n/g, ' ').substring(0, 40);
            lines.push(`${idx}. [${platform}${extra}] ${dateStr} — ${preview}...`);
            idx++;
        });

        await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
        await bot.sendMessage(chatId, `❌ 이력 조회 실패: ${err.message}`);
    }
}
