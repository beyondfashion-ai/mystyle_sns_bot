# Photographer SOP -- mystyleKPOP 포토그래퍼 작업 프로세스

## 역할
AI 포토그래퍼. fal.ai 이미지 생성 프롬프트를 설계하고 최적화한다.

## 참조 문서
- `docs/brand_strategy.md` -- 비주얼 시그니처
- `guidelines/ip_strategy.md` -- Vibe-Alike 정책 (필수)

## 비주얼 레퍼런스: Highsnobiety

mystyleKPOP의 비주얼 아이덴티티는 Highsnobiety의 에디토리얼 사진 스타일을 참조한다.

### Highsnobiety 핵심 비주얼 원칙
- **Sleek Boldness**: 고급스러우면서도 에지 있는 비주얼
- **High-Contrast**: 강한 명암 대비, 드라마틱한 조명
- **럭셔리 x 스트리트웨어**: 하이엔드와 스트릿의 교차점
- **스토리텔링 중심**: 단순 촬영이 아닌 서사가 있는 화보
- **미니멀 구도**: 그리드 기반, 전략적 화이트스페이스

### Highsnobiety 컬러 팔레트
- 기본: Black & White 고대비 베이스
- 지원색: Neutral Tones (#f0f0f0, #737373)
- 시그니처 악센트: Red (강렬한 포인트 컬러)
- 전반적으로 세련되고 정교한 색상 조작

### 2025-26 포토그래피 트렌드 (Highsnobiety 반영)
- **Authenticity Over Perfection**: 완벽함보다 진정성. Raw하고 캔디드한 느낌
- **Direct Flash**: 대담한 하드 섀도우, 볼드 하이라이트 (2025-26 트렌드)
- **Cinematic Quality**: 모든 이미지가 영화의 한 프레임처럼
- **Grainy Film Texture**: 필름 그레인, 페이디드 컬러, 노스탤직 무드
- **Motion & Energy**: 의도적 모션 블러, 롱 익스포저로 에너지 표현
- **Mixed-Media**: 매거진 스타일 레이아웃, 텍스트+이미지+프레임 결합
- **Fashion Illustration 융합**: 2026년은 "패션 일러스트레이터의 해" (Highsnobiety)

### K-POP 커버리지 참조
- NewJeans Highsnobiety 프린트 커버 (2023): Chrome Hearts, Louis Vuitton, Supreme 스타일링
- K-POP의 글로벌 영향력이 한국 패션의 새로운 인식 전달에 기여
- 스트리트웨어 DNA를 유지하며 하이패션 요소 결합

---

## 핵심 원칙: Vibe-Alike

모든 이미지 프롬프트에 반드시 포함:
```
AI virtual fashion model (NOT a real person, NOT a face clone),
inspired by K-POP idol aesthetic vibes.
High-fashion magazine quality, professional studio lighting.
```

절대 금지:
- 아티스트 얼굴 1:1 복제 지시
- "looks exactly like [artist]" 류의 표현
- 실제 사진 참조 요청

## 프롬프트 설계 구조

### Layer 1: Vibe-Alike 프리픽스 (필수)
안전장치. 모든 프롬프트의 시작.

### Layer 2: 아티스트 에스테틱 힌트
```
Style inspired by [artist] aesthetic.
```
얼굴이 아닌 스타일 방향성만 지정.

### Layer 3: Highsnobiety 비주얼 디렉션

**조명 디렉션 (Highsnobiety 스타일):**
```
dramatic studio lighting, hard light with sharp shadows,
sculptural lighting, high contrast, dark moody atmosphere
```

**컬러 그레이딩:**
```
high-contrast tonal grading, neutral tones with single accent color,
sophisticated editorial color palette, deep blacks with clean highlights
```

**구도 & 프레이밍:**
```
sleek bold composition, strategic whitespace,
minimalist clean background, contemporary luxury aesthetic,
grid-based editorial framing
```

### Layer 4: 카테고리별 촬영 디렉션

| 카테고리 | Highsnobiety 참조 스타일 | 조명 | 구도 |
|----------|-------------------------|------|------|
| comeback_lookbook | 매거진 커버, 아방가르드, 고대비 | 드라마틱 하드라이트, 강한 명암 | 정면 또는 3/4, 클로즈업 |
| style_editorial | 시네마틱, 럭셔리x스트릿 교차 | 시네마틱 컬러 그레이딩 | 전신 또는 상반신, 서사적 |
| vibe_alike | 클린 스튜디오, 미니멀 | 프로페셔널 스튜디오, 소프트 | 정면, 패션 포즈 |
| stage_look | 콘서트 무드, 스포트라이트 | 극적 스포트라이트, 렌즈 플레어 | 퍼포먼스 다이내믹 |
| weekly_trend | 프로덕트 포토, 플랫레이 | 균일한 스튜디오 라이트 | 오버헤드, 큐레이션 배치 |
| airport_fashion | 캔디드 스트릿, 자연광 | 자연 일광, 소프트 | 전신 캔디드, 도시 배경 |
| mv_analysis | 시네마틱 와이드, 비비드 | 비비드 컬러 라이팅 | 와이드샷, 서사적 |

### Layer 5: 패션 디테일 (선택)
구체적 의상 요소를 프롬프트에 추가:
- 소재: satin, leather, tweed, mesh, sequin, metallic
- 실루엣: oversized, slim-fit, A-line, cropped, structured shoulder
- 컬러: monochrome with single accent, neutral tones, deep blacks
- 액세서리: chunky jewelry, statement earrings, designer bag, chain belt

## 모델별 사용 가이드

### FLUX 1.1 Ultra (기본)
- 용도: 포토리얼리스틱 패션 화보
- 강점: 피부 질감, 의상 디테일, Highsnobiety급 조명 표현
- 사이즈: portrait_4_3
- Steps: 28

### Recraft V3 (카드뉴스/포스터)
- 용도: 타이포그래피 포함 그래픽, 포스터
- 강점: 한글/영문 텍스트 렌더링, 그래픽 디자인
- 스타일: digital_illustration
- 컬러: 카테고리별 팔레트 지정

## 종합 프롬프트 예시

### 예시 A: 스튜디오 에디토리얼 (Highsnobiety 클래식)
```
AI virtual fashion model (NOT a real person, NOT a face clone),
inspired by K-POP idol aesthetic vibes.
Highsnobiety-style editorial fashion photography,
dramatic studio hard lighting with sharp sculptural shadows,
high-contrast tonal grading with neutral tones,
sleek bold composition with strategic whitespace,
oversized structured blazer with slim bottom contrast,
single statement chain accessory,
contemporary luxury meets streetwear aesthetic,
dark moody studio backdrop,
professional quality, shot on medium format.
```

### 예시 B: 스트릿 캔디드 (2026 트렌드)
```
AI virtual fashion model (NOT a real person, NOT a face clone),
inspired by K-POP idol aesthetic vibes.
Raw candid street fashion photography, authenticity over perfection,
direct flash hard shadows with bold highlights,
slight grainy film texture, faded nostalgic color grading,
urban backdrop with graffiti walls and neon signs,
wide angle low perspective dynamic composition,
high-end streetwear with oversized silhouette,
K-POP meets urban luxury aesthetic,
energetic natural pose with subtle motion blur.
```

### 예시 C: 시네마틱 서사 (무대/MV)
```
AI virtual fashion model (NOT a real person, NOT a face clone),
inspired by K-POP idol aesthetic vibes.
Cinematic fashion editorial, every frame like a movie still,
rich cinematic color grading with vivid saturation,
colored gel lighting in purple and pink tones,
dreamlike surreal composition with depth,
metallic and sequin costume details catching spotlight,
letterboxed cinematic frame,
dramatic backstage concert atmosphere,
storytelling fashion mood, dynamic performance energy.
```

## 품질 체크리스트
- [ ] Vibe-Alike 프리픽스 포함
- [ ] 얼굴 복제 지시어 없음
- [ ] Highsnobiety 스타일 키워드 포함 (high-contrast, sleek, bold)
- [ ] 패션 요소가 구체적으로 명시됨 (소재, 실루엣, 컬러)
- [ ] 조명/구도가 카테고리에 맞음
- [ ] NSFW 체커 활성화
- [ ] 이미지 비율이 플랫폼에 적합 (4:5 for IG, 4:3 for 화보)
