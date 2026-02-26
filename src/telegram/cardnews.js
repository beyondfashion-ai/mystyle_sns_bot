import { getCardNewsData } from '../templates.js';
import { generateCardNewsCover } from '../imageGen.js';
import { generateAndUploadCardNews } from '../cardNews.js';
import { postThread, postCarousel } from '../bot.js';

import { pendingCardNews, updateCardNewsStatus } from './state.js';
import { makeCnKeyboard } from './keyboards.js';
import { clearButtons } from './helpers.js';

/**
 * 카드뉴스 타입 선택 콜백 처리
 */
export async function handleCardNewsTypeSelect(bot, query, chatId, action) {
    const cnType = action.replace('cn_type_', '');
    await bot.answerCallbackQuery(query.id, { text: '카드뉴스 생성 중...' });

    const cardData = getCardNewsData(cnType);
    if (!cardData) {
        await bot.sendMessage(chatId, '❌ 카드뉴스 데이터를 찾을 수 없습니다.');
        return;
    }

    await bot.sendMessage(chatId, '📰 카드뉴스 생성 중...\n카버 이미지 Recraft V3 생성 + 슬라이드 렌더링 중');

    try {
        // 커버 이미지 생성 (Recraft V3)
        let coverImageUrl = null;
        try {
            coverImageUrl = await generateCardNewsCover({
                title: cardData.title,
                artist: cardData.artist,
                type: cnType,
            });
        } catch (err) {
            console.warn('[CardNews] Recraft V3 카버 이미지 생성 실패:', err.message);
        }

        cardData.coverImageUrl = coverImageUrl;

        // 슬라이드 생성 + Firebase 업로드
        const imageUrls = await generateAndUploadCardNews(cardData);

        // 텔레그램에 앨범으로 미리보기 전송
        const mediaGroup = imageUrls.map((url, i) => ({
            type: 'photo',
            media: url,
            ...(i === 0 ? { caption: `📰 *${cardData.title}*\n\n${cardData.caption || ''}\n\n슬라이드 ${imageUrls.length}장`, parse_mode: 'Markdown' } : {}),
        }));

        await bot.sendMediaGroup(chatId, mediaGroup);

        // 승인 버튼
        const sent = await bot.sendMessage(chatId, '⬆️ 카드뉴스 미리보기 완료. 게시 플랫폼을 선택하세요:', {
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
        await bot.sendMessage(chatId, `❌ 카드뉴스 생성 실패: ${err.message}`);
    }
}

/**
 * 카드뉴스 승인/재생성 콜백 처리
 */
export async function handleCardNewsCallback(bot, query, chatId, messageId, action) {
    const cnData = pendingCardNews.get(messageId);
    if (!cnData) {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ 카드뉴스 데이터를 찾을 수 없습니다.' });
        return;
    }

    switch (action) {
        case 'approve_cn_x': {
            await bot.answerCallbackQuery(query.id, { text: 'X 스레드 게시 중...' });
            await clearButtons(bot, chatId, messageId);

            try {
                const threadItems = cnData.imageUrls.map((url, i) => ({
                    text: i === 0 ? cnData.caption : `[${i}/${cnData.imageUrls.length - 1}]`,
                    imageUrls: [url],
                }));

                const result = await postThread(threadItems);

                if (result.success) {
                    const firstTweetId = result.tweets[0].id;
                    await bot.sendMessage(chatId,
                        `✅ X 스레드 게시 완료! (${result.tweets.length}개 트윗)\n🔗 https://x.com/i/status/${firstTweetId}`
                    );
                } else {
                    await bot.sendMessage(chatId, `❌ X 스레드 게시 실패: ${result.error}`);
                }
            } catch (err) {
                await bot.sendMessage(chatId, `❌ X 스레드 게시 중 오류: ${err.message}`);
            }

            await updateCardNewsStatus(messageId, 'approved', { approvedPlatform: 'x' });
            break;
        }

        case 'approve_cn_ig': {
            await bot.answerCallbackQuery(query.id, { text: 'IG 캐러셀 게시 중...' });
            await clearButtons(bot, chatId, messageId);

            try {
                const result = await postCarousel({
                    text: cnData.caption,
                    imageUrls: cnData.imageUrls,
                });

                if (result.success) {
                    await bot.sendMessage(chatId, `✅ Instagram 캐러셀 게시 완료! (ID: ${result.id})`);
                } else {
                    await bot.sendMessage(chatId, `❌ IG 캐러셀 게시 실패: ${result.error}`);
                }
            } catch (err) {
                await bot.sendMessage(chatId, `❌ IG 캐러셀 게시 중 오류: ${err.message}`);
            }

            await updateCardNewsStatus(messageId, 'approved', { approvedPlatform: 'instagram' });
            break;
        }

        case 'regenerate_cn': {
            await bot.answerCallbackQuery(query.id, { text: '카드뉴스 다시 생성 중...' });
            await updateCardNewsStatus(messageId, 'rejected');
            await clearButtons(bot, chatId, messageId);

            // 같은 타입으로 재생성
            await handleCardNewsTypeSelect(bot, query, chatId, `cn_type_${cnData.type}`);
            break;
        }
    }
}
