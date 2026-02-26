import { getRandomDraft } from '../templates.js';
import { generateImageForDraft } from '../imageGen.js';
import { getTrendWeightsPrompt } from '../trendAnalyzer.js';
import { getExternalTrendPrompt } from '../trendScraper.js';
import { getRandomFormatDraft } from '../formatManager.js';
import { getEditorialDirectionPrompt } from '../editorialEvolution.js';
import { generateSNSContent } from '../contentGenerator.js';
import { postToSNS } from '../bot.js';
import { getTodaySchedule, getFormatName, getDayName } from '../contentCalendar.js';

import { pendingDrafts, updateDraftStatus } from './state.js';
import { makeScheduledDraftKeyboard, formatDraftPreview } from './keyboards.js';
import { getApprovedDraft, removeFromQueue, clearQueueForDate } from './draftQueue.js';

// ===== KST 날짜 헬퍼 =====

function toKST(date) {
    return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

export function getKSTDateStr(date) {
    return toKST(date).toISOString().slice(0, 10);
}

/**
 * "2/28(수)" 형태의 짧은 날짜 라벨 생성
 */
export function makeDateLabel(date) {
    const kst = toKST(date);
    const m = kst.getMonth() + 1;
    const d = kst.getDate();
    const dayName = getDayName(kst.getDay());
    return `${m}/${d}(${dayName})`;
}

// ===== 단일 슬롯 초안 생성 (내부 + regenerateForSlot에서 재사용) =====

/**
 * 특정 슬롯의 초안을 생성하고 텔레그램 미리보기를 전송한다.
 * @param {object} bot
 * @param {string} chatId
 * @param {string} slotKey - 예: "2026-02-28_x_10"
 * @param {string} platform - "x" | "instagram"
 * @param {string} formatKey - 콘텐츠 캘린더 포맷 키
 * @param {number} scheduledHour - 예약 게시 시간 (KST)
 * @param {string} [dateLabel] - 미리보기 날짜 라벨 (예: "2/28(수)")
 */
async function generateAndSendSlotDraft(bot, chatId, slotKey, platform, formatKey, scheduledHour, dateLabel) {
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
    if (dateLabel) draft.dateLabel = dateLabel;

    // 4. 텔레그램 미리보기 전송
    const platformLabel = platform === 'instagram' ? 'IG' : 'X';
    const datePart = dateLabel ? `📅${dateLabel} ` : '';
    const keyboard = makeScheduledDraftKeyboard(scheduledHour, platform, dateLabel);
    const preview = formatDraftPreview(draft, `${datePart}⏰${scheduledHour}:00 ${platformLabel} `);

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
 * 9AM에 D+2(이틀 후)의 초안을 일괄 생성하여 관리자에게 검수 요청한다.
 * 2일 전에 미리 생성하여 여유롭게 검수할 수 있도록 함.
 */
export async function generateDailyDrafts(bot) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    // D+2 목표 날짜 계산
    const targetDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const dateStr = getKSTDateStr(targetDate);
    const dateLabel = makeDateLabel(targetDate);

    // 해당 날짜의 기존 큐만 초기화
    clearQueueForDate(dateStr);

    const schedule = getTodaySchedule(targetDate);
    const totalSlots = schedule.x.length + schedule.ig.length;

    await bot.sendMessage(adminChatId,
        `🌅 *${dateLabel} 컨텐츠 초안 생성을 시작합니다* (${totalSlots}건)\n\n` +
        `📅 D-2 사전 생성: 이틀 후 게시될 초안입니다.\n` +
        `검수 후 승인하면 ${dateLabel}에 자동 게시됩니다.\n거부하면 새 초안이 자동 생성됩니다.`,
        { parse_mode: 'Markdown' });

    let successCount = 0;

    // X 초안 생성
    for (const slot of schedule.x) {
        const slotKey = `${dateStr}_x_${slot.hour}`;
        try {
            await generateAndSendSlotDraft(bot, adminChatId, slotKey, 'x', slot.format, slot.hour, dateLabel);
            successCount++;
        } catch (err) {
            console.error(`[Scheduled] ${slotKey} 생성 실패:`, err.message);
            await bot.sendMessage(adminChatId, `❌ X ${slot.hour}:00 (${getFormatName(slot.format)}) 생성 실패: ${err.message}`);
        }
    }

    // IG 초안 생성
    for (const slot of schedule.ig) {
        const slotKey = `${dateStr}_ig_${slot.hour}`;
        try {
            await generateAndSendSlotDraft(bot, adminChatId, slotKey, 'instagram', slot.format, slot.hour, dateLabel);
            successCount++;
        } catch (err) {
            console.error(`[Scheduled] ${slotKey} 생성 실패:`, err.message);
            await bot.sendMessage(adminChatId, `❌ IG ${slot.hour}:00 (${getFormatName(slot.format)}) 생성 실패: ${err.message}`);
        }
    }

    await bot.sendMessage(adminChatId,
        `✅ ${dateLabel} 초안 생성 완료 (${successCount}/${totalSlots}건)\n위 초안들을 검수해주세요!`);
}

// ===== 슬롯 상태 조회 =====

/**
 * pendingDrafts에서 slotKey로 미승인 초안을 찾는다.
 */
export function findPendingDraftBySlotKey(slotKey) {
    for (const [messageId, draft] of pendingDrafts) {
        if (draft.slotKey === slotKey) {
            return { messageId, draft };
        }
    }
    return null;
}

/**
 * 특정 슬롯의 상태를 반환한다.
 * @returns {'approved' | 'pending' | 'missing'}
 */
export function getSlotStatus(slotKey) {
    if (getApprovedDraft(slotKey)) return 'approved';
    if (findPendingDraftBySlotKey(slotKey)) return 'pending';
    return 'missing';
}

/**
 * 특정 날짜의 전체 슬롯 검수 현황을 반환한다.
 */
export function getDayReviewStatus(dateStr, schedule) {
    const statuses = [];
    for (const slot of schedule.x) {
        const slotKey = `${dateStr}_x_${slot.hour}`;
        statuses.push({
            platform: 'X', hour: slot.hour,
            format: slot.format, status: getSlotStatus(slotKey),
        });
    }
    for (const slot of schedule.ig) {
        const slotKey = `${dateStr}_ig_${slot.hour}`;
        statuses.push({
            platform: 'IG', hour: slot.hour,
            format: slot.format, status: getSlotStatus(slotKey),
        });
    }
    return statuses;
}

// ===== 리마인더 =====

/**
 * 30분 전 미승인 슬롯 리마인더 (이미 승인된 경우 무시)
 */
export async function remindUnapprovedSlot(bot, slotKey) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    if (getApprovedDraft(slotKey)) return; // 이미 승인됨

    const parts = slotKey.split('_');
    const hour = parts[parts.length - 1];
    const platform = parts[parts.length - 2];
    const platformLabel = platform === 'ig' ? 'IG' : 'X';

    await bot.sendMessage(adminChatId,
        `⏰ *${hour}:00 ${platformLabel}* 게시 30분 전!\n` +
        `아직 미승인 상태입니다. 승인하지 않으면 *자동 게시*됩니다.`,
        { parse_mode: 'Markdown' });
}

/**
 * D-1 저녁: 내일 미승인 슬롯 일괄 리마인더
 */
export async function remindTomorrowUnapproved(bot) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateStr = getKSTDateStr(tomorrow);
    const dateLabel = makeDateLabel(tomorrow);
    const schedule = getTodaySchedule(tomorrow);

    const unapproved = [];
    for (const slot of schedule.x) {
        if (!getApprovedDraft(`${dateStr}_x_${slot.hour}`)) {
            unapproved.push(`X ${slot.hour}:00 — ${getFormatName(slot.format)}`);
        }
    }
    for (const slot of schedule.ig) {
        if (!getApprovedDraft(`${dateStr}_ig_${slot.hour}`)) {
            unapproved.push(`IG ${slot.hour}:00 — ${getFormatName(slot.format)}`);
        }
    }

    if (unapproved.length === 0) return;

    await bot.sendMessage(adminChatId,
        `🔔 *내일(${dateLabel}) 미승인 초안 ${unapproved.length}건*\n\n` +
        unapproved.map(s => `  ⚠️ ${s}`).join('\n') +
        `\n\n미승인 시 게시 시간에 자동 게시됩니다.`,
        { parse_mode: 'Markdown' });
}

// ===== 예약 게시 (미승인 시 자동 게시) =====

/**
 * 초안을 SNS에 게시하고 결과를 알린다 (공통 로직).
 * @returns {boolean} 성공 여부
 */
async function executePost(bot, adminChatId, draft, slotKey, label) {
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
                `${label} [${platformLabel} ${draft.scheduledHour}:00]${link}`,
                { parse_mode: 'Markdown' });
            return true;
        } else {
            const error = platformResult?.error || '알 수 없는 오류';
            await bot.sendMessage(adminChatId, `❌ 게시 실패 [${platformLabel} ${draft.scheduledHour}:00]: ${error}`);
            return false;
        }
    } catch (err) {
        await bot.sendMessage(adminChatId, `❌ 게시 중 오류 [${slotKey}]: ${err.message}`);
        return false;
    }
}

/**
 * 예약 시간에 초안을 게시한다.
 * 승인된 초안이 없으면 미승인 초안을 자동 게시한다.
 * @param {string} slotKey - 예: "2026-02-28_x_10"
 */
export async function postScheduledSlot(bot, slotKey) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    // 1. 승인된 초안이 있으면 정상 게시
    const entry = getApprovedDraft(slotKey);
    if (entry) {
        await executePost(bot, adminChatId, entry.draft, slotKey, '⚡ *예약 게시 완료*');
        removeFromQueue(slotKey);
        return;
    }

    // 2. 미승인 초안이 있으면 자동 게시
    const pending = findPendingDraftBySlotKey(slotKey);
    if (pending) {
        const { messageId, draft } = pending;
        const platformLabel = draft.platform === 'instagram' ? 'IG' : 'X';

        await bot.sendMessage(adminChatId,
            `🤖 *${draft.scheduledHour}:00 ${platformLabel}* 미승인 → 자동 게시 중...`,
            { parse_mode: 'Markdown' });

        const success = await executePost(bot, adminChatId, draft, slotKey, '🤖 *자동 게시 완료*');
        await updateDraftStatus(messageId, success ? 'auto_posted' : 'auto_post_failed');
        return;
    }

    // 3. 초안 자체가 없음
    const parts = slotKey.split('_');
    const hour = parts[parts.length - 1];
    const platform = parts[parts.length - 2];
    const platformLabel = platform === 'ig' ? 'IG' : 'X';
    await bot.sendMessage(adminChatId,
        `⚠️ *${hour}:00 ${platformLabel}* 게시할 초안이 없습니다.`,
        { parse_mode: 'Markdown' });
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
