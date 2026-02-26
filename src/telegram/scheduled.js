import { getRandomDraft } from '../templates.js';
import { generateImageForDraft } from '../imageGen.js';
import { getTrendWeightsPrompt } from '../trendAnalyzer.js';
import { getExternalTrendPrompt } from '../trendScraper.js';
import { getRandomFormatDraft } from '../formatManager.js';
import { getEditorialDirectionPrompt } from '../editorialEvolution.js';
import { generateSNSContent } from '../contentGenerator.js';
import { postToSNS } from '../bot.js';
import { getTodaySchedule, getFormatName } from '../contentCalendar.js';

import { pendingDrafts } from './state.js';
import { makeScheduledDraftKeyboard, formatDraftPreview } from './keyboards.js';
import { getApprovedDraft, removeFromQueue, clearDailyQueue } from './draftQueue.js';

// ===== 단일 슬롯 초안 생성 (내부 + regenerateForSlot에서 재사용) =====

/**
 * 특정 슬롯의 초안을 생성하고 텔레그램 미리보기를 전송한다.
 * @param {object} bot
 * @param {string} chatId
 * @param {string} slotKey - 예: "x_10", "ig_12"
 * @param {string} platform - "x" | "instagram"
 * @param {string} formatKey - 콘텐츠 캘린더 포맷 키
 * @param {number} scheduledHour - 예약 게시 시간 (KST)
 */
async function generateAndSendSlotDraft(bot, chatId, slotKey, platform, formatKey, scheduledHour) {
    const formatName = getFormatName(formatKey);

    // 1. 콘텐츠 생성 (Hybrid LLM)
    let draft = await generateSNSContent({ platform, formatKey });

    // Fallback: LLM 실패 시 기존 방식
    if (!draft) {
        draft = platform === 'instagram'
            ? await getRandomFormatDraft('instagram') || getRandomDraft(['editorial', 'fashion_report'])
            : await getRandomFormatDraft('x') || getRandomDraft();

        if (!draft) throw new Error('초안 생성 실패 — 모든 fallback 소진');

        const editorialPrompt = await getEditorialDirectionPrompt();
        const trendPrompt = await getTrendWeightsPrompt();
        const externalPrompt = await getExternalTrendPrompt();
        const prompts = [editorialPrompt, trendPrompt, externalPrompt].filter(Boolean).join('\n');
        if (prompts) {
            draft.text = `${prompts}\n\n${draft.text}`;
        }
    }

    draft.platform = platform;
    draft.imageUrl = draft.imageUrl || null;

    // 2. 이미지 생성
    if (platform === 'instagram') {
        // IG는 이미지 필수
        draft.imageUrl = await generateImageForDraft(draft);
        if (!draft.imageUrl) throw new Error('IG 이미지 생성 실패');
    } else {
        // X: fan_discussion 제외하고 이미지 생성 시도
        const noImageFormats = ['fan_discussion'];
        if (!noImageFormats.includes(formatKey)) {
            try {
                draft.imageUrl = await generateImageForDraft(draft);
            } catch (err) {
                console.error(`[Scheduled] ${slotKey} 이미지 생성 실패:`, err.message);
            }
        }
    }

    // 3. 예약 정보 태그
    draft.slotKey = slotKey;
    draft.scheduledHour = scheduledHour;

    // 4. 텔레그램 미리보기 전송
    const platformLabel = platform === 'instagram' ? 'IG' : 'X';
    const keyboard = makeScheduledDraftKeyboard(scheduledHour, platform);
    const preview = formatDraftPreview(draft, `⏰${scheduledHour}:00 ${platformLabel} `);

    let sent;
    if (draft.imageUrl) {
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
}

// ===== 공개 함수 =====

/**
 * 9AM에 오늘의 초안을 일괄 생성하여 관리자에게 검수 요청한다.
 */
export async function generateDailyDrafts(bot) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    // 전날 잔여 큐 초기화
    clearDailyQueue();

    const schedule = getTodaySchedule();
    const totalSlots = schedule.x.length + schedule.ig.length;

    await bot.sendMessage(adminChatId,
        `🌅 *오늘의 컨텐츠 초안 생성을 시작합니다* (${totalSlots}건)\n\n` +
        `검수 후 승인하면 예약 시간에 자동 게시됩니다.\n거부하면 새 초안이 자동 생성됩니다.`,
        { parse_mode: 'Markdown' });

    let successCount = 0;

    // X 초안 생성
    for (const slot of schedule.x) {
        const slotKey = `x_${slot.hour}`;
        try {
            await generateAndSendSlotDraft(bot, adminChatId, slotKey, 'x', slot.format, slot.hour);
            successCount++;
        } catch (err) {
            console.error(`[Scheduled] ${slotKey} 생성 실패:`, err.message);
            await bot.sendMessage(adminChatId, `❌ X ${slot.hour}:00 (${getFormatName(slot.format)}) 생성 실패: ${err.message}`);
        }
    }

    // IG 초안 생성
    for (const slot of schedule.ig) {
        const slotKey = `ig_${slot.hour}`;
        try {
            await generateAndSendSlotDraft(bot, adminChatId, slotKey, 'instagram', slot.format, slot.hour);
            successCount++;
        } catch (err) {
            console.error(`[Scheduled] ${slotKey} 생성 실패:`, err.message);
            await bot.sendMessage(adminChatId, `❌ IG ${slot.hour}:00 (${getFormatName(slot.format)}) 생성 실패: ${err.message}`);
        }
    }

    await bot.sendMessage(adminChatId,
        `✅ 초안 생성 완료 (${successCount}/${totalSlots}건)\n위 초안들을 검수해주세요!`);
}

/**
 * 예약 시간에 승인된 초안을 게시한다.
 * @param {string} slotKey - 예: "x_10", "ig_12"
 */
export async function postScheduledSlot(bot, slotKey) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    const entry = getApprovedDraft(slotKey);
    if (!entry) {
        const [platform, hour] = slotKey.split('_');
        const platformLabel = platform === 'ig' ? 'IG' : 'X';
        await bot.sendMessage(adminChatId,
            `⚠️ *${hour}:00 ${platformLabel}* 게시물이 아직 미승인입니다.\n텔레그램에서 해당 초안을 검수해주세요.`,
            { parse_mode: 'Markdown' });
        return;
    }

    const { draft } = entry;
    const apiPlatform = draft.platform === 'instagram' ? 'instagram' : 'x';
    const platformLabel = draft.platform === 'instagram' ? 'IG' : 'X';

    try {
        const imageUrls = draft.imageUrl ? [draft.imageUrl] : [];
        const result = await postToSNS({
            platforms: [apiPlatform],
            text: draft.text,
            imageUrls,
        });

        const platformResult = result[apiPlatform];
        if (platformResult?.success) {
            const link = apiPlatform === 'x'
                ? `\n🔗 https://x.com/i/status/${platformResult.id}`
                : ` (ID: ${platformResult.id})`;
            await bot.sendMessage(adminChatId,
                `⚡ *예약 게시 완료* [${platformLabel} ${draft.scheduledHour}:00]${link}`,
                { parse_mode: 'Markdown' });
        } else {
            const error = platformResult?.error || '알 수 없는 오류';
            await bot.sendMessage(adminChatId, `❌ 예약 게시 실패 [${platformLabel} ${draft.scheduledHour}:00]: ${error}`);
        }
    } catch (err) {
        await bot.sendMessage(adminChatId, `❌ 예약 게시 중 오류 [${slotKey}]: ${err.message}`);
    }

    removeFromQueue(slotKey);
}

/**
 * 거부된 초안을 동일 슬롯으로 재생성한다.
 */
export async function regenerateForSlot(bot, chatId, slotKey, platform, formatKey, scheduledHour) {
    await generateAndSendSlotDraft(bot, chatId, slotKey, platform, formatKey, scheduledHour);
}

// ===== 하위 호환성 (수동 /dx, /di에서 직접 호출되는 경우 대비) =====

export async function sendScheduledDraftX(bot, formatKey) {
    // 레거시 호환: 직접 호출 시 기존 동작 유지
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;
    await generateAndSendSlotDraft(bot, adminChatId, null, 'x', formatKey, null);
}

export async function sendScheduledDraftIG(bot, formatKey) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;
    await generateAndSendSlotDraft(bot, adminChatId, null, 'instagram', formatKey, null);
}

export async function sendScheduledDraft(bot) {
    return sendScheduledDraftX(bot);
}
