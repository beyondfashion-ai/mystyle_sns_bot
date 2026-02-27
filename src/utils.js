/**
 * LLM 응답 텍스트에서 JSON을 추출하고 파싱한다.
 * ```json ... ``` 블록 또는 { ... } 패턴을 찾는다.
 *
 * @param {string} text - LLM 응답 원문
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function extractJSON(text) {
    if (!text || typeof text !== 'string') {
        return { ok: false, error: '입력 텍스트가 비어있거나 문자열이 아닙니다.' };
    }

    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
        return { ok: false, error: 'JSON 패턴을 찾을 수 없습니다.' };
    }

    try {
        const data = JSON.parse(jsonMatch[1]);
        return { ok: true, data };
    } catch (err) {
        return { ok: false, error: `JSON 파싱 실패: ${err.message}` };
    }
}
