import { fal } from '@fal-ai/client';
import admin from 'firebase-admin';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { existsSync } from 'fs';

if (existsSync('.env.local')) {
    dotenv.config({ path: '.env.local' });
} else {
    dotenv.config();
}

// fal.ai 클라이언트 설정
fal.config({ credentials: process.env.FAL_AI_KEY });

const FAL_MODEL_FLUX = process.env.FAL_MODEL || 'fal-ai/flux-pro/v1.1-ultra';
const FAL_MODEL_RECRAFT = 'fal-ai/recraft-v3';

// Vibe-Alike 정책 프리픽스 (모든 이미지 프롬프트에 자동 삽입)
const VIBE_ALIKE_PREFIX =
    'AI virtual fashion model (NOT a real person, NOT a face clone), ' +
    'inspired by K-POP idol aesthetic vibes. ' +
    'High-fashion magazine quality, professional studio lighting. ';

// 카테고리별 프롬프트 매핑 (에디토리얼 전략 반영)
const CATEGORY_PROMPTS = {
    comeback_lookbook:
        'High-end fashion magazine cover, dramatic chiaroscuro lighting, ' +
        'bold avant-garde silhouette with structured shoulders, ' +
        'dark studio backdrop with single color accent, editorial composition. ' +
        'Shot on medium format camera, shallow depth of field.',
    style_editorial:
        'Cinematic fashion editorial, desaturated color grading with warm highlights, ' +
        'haute couture layering with mixed textures (satin, mesh, leather), ' +
        'full body shot showing silhouette proportions, luxury brand aesthetic.',
    vibe_alike:
        'Clean studio fashion photoshoot, seamless white or grey backdrop, ' +
        'contemporary K-POP inspired streetwear styling, ' +
        'oversized outerwear with slim bottom contrast, ' +
        'single statement accessory, natural pose.',
    stage_look:
        'Concert stage performance atmosphere, dramatic spotlight with lens flare, ' +
        'metallic and sequin costume details catching light, ' +
        'three different fabric textures visible, dynamic pose.',
    weekly_trend:
        'Minimalist fashion flat lay composition on dark surface, ' +
        'curated selection of trending items with clean spacing, ' +
        'overhead shot, muted color palette with one accent color, ' +
        'editorial product photography style.',
    airport_fashion:
        'Candid street style photography, natural daylight, ' +
        'minimal luxury outfit with oversized silhouette, ' +
        'designer carry-on bag detail visible, relaxed confident stance, ' +
        'urban terminal architecture background blurred.',
    mv_analysis:
        'Cinematic wide shot, music video color grading with vivid saturation, ' +
        'multiple outfit elements telling a visual narrative, ' +
        'dramatic backdrop with depth, storytelling composition.',
};

/**
 * draft 정보로 fal.ai 이미지 생성 프롬프트를 구성한다.
 */
export function buildImagePrompt(draft) {
    const categoryPrompt = CATEGORY_PROMPTS[draft.category] || CATEGORY_PROMPTS.style_editorial;
    const artistHint = draft.artist ? `Style inspired by ${draft.artist} aesthetic. ` : '';

    return `${VIBE_ALIKE_PREFIX}${artistHint}${categoryPrompt}`;
}

/**
 * fal.ai FLUX 모델로 이미지를 생성한다 (포토리얼리스틱 패션 이미지용).
 * @returns {{ url: string, width: number, height: number }}
 */
export async function generateImage(prompt, options = {}) {
    const {
        imageSize = 'portrait_4_3',
        numInferenceSteps = 28,
        enableSafetyChecker = true,
    } = options;

    const result = await fal.subscribe(FAL_MODEL_FLUX, {
        input: {
            prompt,
            image_size: imageSize,
            num_inference_steps: numInferenceSteps,
            enable_safety_checker: enableSafetyChecker,
            num_images: 1,
        },
    });

    const image = result.data.images[0];

    // NSFW 감지 시 에러
    if (result.data.has_nsfw_concepts && result.data.has_nsfw_concepts[0]) {
        throw new Error('NSFW content detected. Image generation rejected.');
    }

    return {
        url: image.url,
        width: image.width,
        height: image.height,
    };
}

/**
 * fal.ai Recraft V3로 이미지를 생성한다 (타이포그래피/그래픽/포스터 특화).
 * 한글·영문 텍스트 렌더링 최상급, 브랜드 포스터·앨범 커버 품질.
 * @param {string} prompt - 이미지 프롬프트
 * @param {object} options
 * @param {string} [options.imageSize='portrait_4_3'] - 이미지 사이즈 프리셋
 * @param {string} [options.style='realistic_image'] - 스타일 (realistic_image, digital_illustration, vector_illustration)
 * @param {Array<{r:number,g:number,b:number}>} [options.colors] - RGB 컬러 팔레트 (최대 5개)
 * @returns {{ url: string }}
 */
export async function generateImageRecraft(prompt, options = {}) {
    const {
        imageSize = 'portrait_4_3',
        style = 'realistic_image',
        colors,
    } = options;

    const input = {
        prompt,
        image_size: imageSize,
        style,
    };

    if (colors && colors.length > 0) {
        input.colors = colors.slice(0, 5);
    }

    const result = await fal.subscribe(FAL_MODEL_RECRAFT, { input });
    const image = result.data.images[0];

    return { url: image.url };
}

/**
 * 카드뉴스 커버용 이미지를 Recraft V3로 생성한다.
 * 타이포그래피와 브랜드 포스터 질감에 최적화.
 * @param {object} params
 * @param {string} params.title - 카드뉴스 제목 (한글 텍스트 렌더링)
 * @param {string} [params.artist] - 아티스트 이름
 * @param {string} [params.type] - 카드뉴스 타입 (trend_top5, lookbook, style_tip)
 * @returns {string} Firebase Storage 공개 URL
 */
export async function generateCardNewsCover({ title, artist, type }) {
    const artistHint = artist ? `featuring ${artist} K-POP aesthetic` : 'K-POP fashion';

    const prompt =
        `High-end fashion magazine cover poster design, ${artistHint}. ` +
        `Title text: "${title}". ` +
        'mystyleKPOP branding, sleek modern typography, ' +
        'luxurious gradient background, editorial layout, ' +
        'professional graphic design quality.';

    // 카드뉴스 타입별 컬러 테마
    const colorThemes = {
        trend_top5: [{ r: 102, g: 126, b: 234 }, { r: 118, g: 75, b: 162 }],
        lookbook: [{ r: 240, g: 147, b: 251 }, { r: 245, g: 87, b: 108 }],
        style_tip: [{ r: 79, g: 172, b: 254 }, { r: 0, g: 242, b: 254 }],
    };

    const image = await generateImageRecraft(prompt, {
        imageSize: 'portrait_4_3',
        style: 'digital_illustration',
        colors: colorThemes[type] || colorThemes.trend_top5,
    });

    const timestamp = Date.now();
    const safeArtist = (artist || 'kpop').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `cn_cover_${type}_${safeArtist}_${timestamp}.png`;

    return uploadToFirebaseStorage(image.url, filename);
}

/**
 * fal.ai 임시 URL에서 이미지를 다운로드하여 Firebase Storage에 업로드한다.
 * @returns {string} 공개 접근 가능한 URL
 */
export async function uploadToFirebaseStorage(imageUrl, filename) {
    const bucket = admin.storage().bucket();
    const destination = `bot-images/${filename}`;

    // 이미지 다운로드
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Content-Type 추론
    const contentType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

    // Firebase Storage 업로드
    const file = bucket.file(destination);
    await file.save(buffer, {
        metadata: { contentType },
    });
    await file.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${destination}`;

    // 1회 재시도 검증
    try {
        const check = await fetch(publicUrl, { method: 'HEAD' });
        if (!check.ok) throw new Error('Upload verification failed');
    } catch (err) {
        console.warn('[ImageGen] Upload verification failed, retrying...');
        await file.save(buffer, { metadata: { contentType } });
        await file.makePublic();
    }

    return publicUrl;
}

// 이미지가 필요한 카테고리
const IMAGE_CATEGORIES = new Set([
    'comeback_lookbook', 'style_editorial', 'vibe_alike', 'stage_look',
    'weekly_trend', 'airport_fashion', 'mv_analysis',
]);

/**
 * draft에 맞는 이미지를 생성하고 Firebase Storage URL을 반환한다.
 * editorial/fashion_report 카테고리만 이미지 생성, open_talk은 null 반환.
 * @returns {string|null} Firebase Storage 공개 URL 또는 null
 */
export async function generateImageForDraft(draft) {
    if (!IMAGE_CATEGORIES.has(draft.category)) {
        return null;
    }

    const prompt = buildImagePrompt(draft);
    const image = await generateImage(prompt);

    const timestamp = Date.now();
    const safeArtist = (draft.artist || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${draft.category}_${safeArtist}_${timestamp}.jpg`;

    return uploadToFirebaseStorage(image.url, filename);
}
