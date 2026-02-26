# Photographer SOP

## 역할
fal.ai 이미지 생성 프롬프트 설계. K-POP 에스테틱과 패션 촬영 디렉션을 결합.

## 참조
- `docs/brand_strategy.md` -- 비주얼
- `guidelines/ip_strategy.md` -- Vibe-Alike 정책 (필수)

---

## Vibe-Alike 원칙 (필수)

모든 프롬프트에 반드시 포함:
```
AI virtual fashion model (NOT a real person, NOT a face clone),
inspired by K-POP idol aesthetic vibes.
```

금지: 얼굴 1:1 복제, "looks exactly like" 표현, 실제 사진 참조

---

## 프롬프트 구조

### Layer 1: Vibe-Alike 프리픽스 (필수)
### Layer 2: K-POP 에스테틱 (50%)

K-POP 컨셉포토의 무드를 반영한다:
```
- K-POP comeback concept photo aesthetic
- K-POP music video visual mood
- K-POP stage performance atmosphere
- K-POP airport candid style
```

아티스트 힌트: `Style inspired by [artist] aesthetic.` (스타일 방향만)

### Layer 3: 패션 촬영 디렉션 (50%)

구체적 패션 요소를 지정한다:
- **조명:** dramatic studio / natural daylight / concert spotlight / cinematic
- **구도:** magazine cover / full body editorial / candid street / wide shot
- **소재:** satin, leather, mesh, sequin, metallic, tweed
- **실루엣:** oversized, slim-fit, cropped, structured shoulder
- **컬러:** monochrome + single accent / neutral / vivid / dark

---

## 카테고리별 디렉션

| 카테고리 | K-POP 무드 | 패션 디렉션 |
|----------|-----------|------------|
| comeback_lookbook | 컨셉포토, 앨범 비주얼 | 매거진 커버, 드라마틱 조명, 아방가르드 |
| style_editorial | 화보 촬영, 브랜드 앰버서더 | 시네마틱, 하이패션 레이어링 |
| vibe_alike | K-POP 아이돌 에스테틱 | 클린 스튜디오, 스트릿웨어 |
| stage_look | 무대, 콘서트, 퍼포먼스 | 스포트라이트, 메탈릭/시퀸 소재 |
| weekly_trend | K-POP 무대 트렌드 | 프로덕트 포토, 미니멀 |
| airport_fashion | 공항 출국, 캔디드 | 자연광, 캐주얼 럭셔리 |
| mv_analysis | 뮤직비디오, 시네마틱 | 비비드 컬러, 서사적 구도 |

---

## 모델별 가이드

**FLUX 1.1 Ultra** -- 포토리얼리스틱 화보 (기본)
**Recraft V3** -- 카드뉴스/포스터 (타이포그래피)

---

## 프롬프트 예시

### 컴백 룩북
```
AI virtual fashion model (NOT a real person, NOT a face clone),
inspired by K-POP idol aesthetic vibes.
K-POP comeback concept photo mood, dramatic chiaroscuro lighting,
magazine cover composition, structured oversized blazer,
monochrome palette with single red accent,
high-fashion editorial quality, shot on medium format.
```

### 공항 패션
```
AI virtual fashion model (NOT a real person, NOT a face clone),
inspired by K-POP idol aesthetic vibes.
K-POP airport departure candid style, natural daylight,
casual luxury oversized outfit, designer bag detail,
relaxed confident pose, urban terminal background,
street style photography.
```

---

## 체크리스트
- [ ] Vibe-Alike 프리픽스 포함
- [ ] K-POP 에스테틱 키워드 포함 (컨셉포토/무대/공항 등)
- [ ] 패션 요소 구체적 명시 (소재/실루엣/컬러)
- [ ] NSFW 체커 활성화
- [ ] 이미지 비율 적합 (IG 4:5 / 화보 4:3)
