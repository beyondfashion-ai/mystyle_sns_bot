import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let templates = null;

function loadTemplates() {
    if (!templates) {
        const filePath = join(__dirname, '..', 'data', 'templates.json');
        templates = JSON.parse(readFileSync(filePath, 'utf-8'));
    }
    return templates;
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function substituteVariables(text, variables) {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
        return variables[key] !== undefined ? variables[key] : match;
    });
}

/**
 * 랜덤 초안을 생성한다.
 * @param {string|null} categoryFilter - 'editorial', 'fashion_report', 'open_talk' 중 하나로 필터링
 */
export function getRandomDraft(categoryFilter = null) {
    const data = loadTemplates();

    const allCategories = ['editorial', 'fashion_report', 'open_talk'];
    const categories = categoryFilter ? [categoryFilter] : allCategories;

    const availableTemplates = [];
    for (const cat of categories) {
        if (data[cat]) {
            for (const tmpl of data[cat]) {
                availableTemplates.push({ ...tmpl, type: cat });
            }
        }
    }

    if (availableTemplates.length === 0) return null;

    const template = pickRandom(availableTemplates);
    const artist = pickRandom(data.artists);
    const emoji = pickRandom(data.emojis);
    const artistTag = artist.replace(/[^a-zA-Z0-9가-힣]/g, '_');

    const text = substituteVariables(template.text, {
        artist,
        emoji,
        artist_tag: artistTag,
    });

    return {
        text,
        category: template.category,
        type: template.type,
        artist,
    };
}

/**
 * 카테고리별 템플릿 수를 반환한다.
 */
export function getTemplateList() {
    const data = loadTemplates();
    const result = {};
    for (const cat of ['editorial', 'fashion_report', 'open_talk']) {
        if (data[cat]) {
            result[cat] = data[cat].length;
        }
    }
    return result;
}

/**
 * 템플릿 캐시를 초기화하고 다시 로드한다.
 */
export function reloadTemplates() {
    templates = null;
    loadTemplates();
}
