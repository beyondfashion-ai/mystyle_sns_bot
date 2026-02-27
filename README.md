# AI Fashion K-POP Magazine Bot (Standalone)

KALEI 브랜드를 **"글로벌 AI 패션 K-POP 매거진"**으로 포지셔닝하여, 아티스트 실명을 활용한 고유의 에디토리얼 콘텐츠를 자동으로 운영하기 위한 전용 프로젝트 폴더입니다.

## 📁 프로젝트 구조
- `src/bot.js`: 핵심 SNS 게시 로직 (X, Instagram 통합).
- `scripts/test.js`: 통합 테스트 스크립트.
- `guidelines/`: 기존 프로젝트에서 가져온 법률, IP, KPOP 전문가 상세 지침.
- `docs/`: 마스터 기획서, 콘텐츠 전략, 자동화 실행 계획서.

## 🚀 시작하기
1. **의존성 설치:**
   ```bash
   npm install
   ```
2. **환경 변수 설정:**
   - `.env.example` 파일을 복사하여 `.env.local` 파일을 생성하여 개인 설정을 관리합니다.
   - 각 SNS 플랫폼의 API 키를 입력합니다.
3. **테스트 실행:**
   ```bash
   node scripts/test.js
   ```

## 🛡️ 안전 가이드라인
본 프로젝트는 다음의 안전 장치를 포함하고 있습니다:
- **Rate Limiting:** X 자동 게시 속도 제한.
- **Bot Disclosure:** 모든 게시물에 AI 생성물임을 명시.
- **URL Validation:** 인스타그램용 공개 URL 검증.

## 🔗 참고 문서
상세한 운영 전략과 기술적 내용은 `docs/` 폴더 내의 MD 파일을 참고해 주세요.
