import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { uploadToFirebaseStorage } from './imageGen.js';
import { PUPPETEER_RENDER_TIMEOUT_MS, SLIDE_WIDTH, SLIDE_HEIGHT } from './config.js';
import { createLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const log = createLogger('CardNews');

const TEMPLATES_DIR = join(__dirname, '..', 'data', 'cardnews-templates');

// 카테고리별 그래디언트 테마
const GRADIENTS = {
    trend_top5: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    lookbook: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    style_tip: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    default: 'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 100%)',
};

// ===== 브라우저 인스턴스 재사용 풀 =====
let _browser = null;

async function getBrowser() {
    if (_browser && _browser.isConnected()) return _browser;
    _browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    return _browser;
}

async function closeBrowser() {
    if (_browser) {
        await _browser.close().catch(() => {});
        _browser = null;
    }
}

/**
 * HTML 템플릿 파일을 읽어 변수를 치환한다.
 */
export function buildSlideHTML(templateType, slideData) {
    const templatePath = join(TEMPLATES_DIR, `${templateType}.html`);
    let html = readFileSync(templatePath, 'utf-8');

    // 변수 치환
    for (const [key, value] of Object.entries(slideData)) {
        html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }

    return html;
}

/**
 * Puppeteer로 HTML을 렌더링하여 PNG Buffer를 반환한다.
 * 브라우저 인스턴스를 재사용하여 성능을 최적화한다.
 */
export async function renderSlide(htmlContent) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.setViewport({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
        await page.setContent(htmlContent, {
            waitUntil: 'networkidle0',
            timeout: PUPPETEER_RENDER_TIMEOUT_MS,
        });
        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        return buffer;
    } finally {
        await page.close();
    }
}

/**
 * 카드뉴스 전체 슬라이드를 생성한다.
 * @param {object} cardNewsData
 * @param {string} cardNewsData.type - 'trend_top5' | 'lookbook' | 'style_tip'
 * @param {string} cardNewsData.title - 메인 제목
 * @param {string} cardNewsData.subtitle - 부제목
 * @param {string} [cardNewsData.coverImageUrl] - 커버 AI 이미지 URL
 * @param {Array<{title: string, description: string, imageUrl?: string}>} cardNewsData.items
 * @returns {Buffer[]} PNG 버퍼 배열
 */
export async function generateCardNews(cardNewsData) {
    const gradient = GRADIENTS[cardNewsData.type] || GRADIENTS.default;
    const slides = [];

    try {
        // 1. 커버 슬라이드
        const coverHTML = buildSlideHTML('cover', {
            title: cardNewsData.title,
            subtitle: cardNewsData.subtitle || '',
            imageUrl: cardNewsData.coverImageUrl || '',
            gradient,
        });
        slides.push(await renderSlide(coverHTML));

        // 2. 본문 슬라이드
        for (let i = 0; i < cardNewsData.items.length; i++) {
            const item = cardNewsData.items[i];
            const contentHTML = buildSlideHTML('content', {
                number: String(i + 1),
                title: item.title,
                description: item.description,
                imageUrl: item.imageUrl || '',
                imageClass: item.imageUrl ? '' : 'no-image',
                gradient,
            });
            slides.push(await renderSlide(contentHTML));
        }

        // 3. 아웃트로 슬라이드
        const outroHTML = buildSlideHTML('outro', { gradient });
        slides.push(await renderSlide(outroHTML));
    } catch (err) {
        // 렌더링 실패 시 브라우저 풀 리셋
        await closeBrowser();
        throw err;
    }

    return slides;
}

/**
 * 전체 파이프라인: 카드뉴스 데이터 → 슬라이드 생성 → Firebase 업로드 → URL 배열
 * @returns {string[]} 공개 접근 가능한 이미지 URL 배열
 */
export async function generateAndUploadCardNews(cardNewsData) {
    const slides = await generateCardNews(cardNewsData);
    const timestamp = Date.now();
    const urls = [];

    for (let i = 0; i < slides.length; i++) {
        const slideBuffer = slides[i];
        const filename = `cardnews_${cardNewsData.type}_${timestamp}_slide${i}.png`;

        const url = await uploadSlideToFirebase(slideBuffer, filename);
        urls.push(url);
    }

    return urls;
}

/**
 * 슬라이드 PNG Buffer를 Firebase Storage에 직접 업로드한다.
 */
async function uploadSlideToFirebase(buffer, filename) {
    const admin = (await import('firebase-admin')).default;
    const bucket = admin.storage().bucket();
    const destination = `bot-images/cardnews/${filename}`;

    const file = bucket.file(destination);
    await file.save(buffer, {
        metadata: { contentType: 'image/png' },
    });
    await file.makePublic();

    return `https://storage.googleapis.com/${bucket.name}/${destination}`;
}
