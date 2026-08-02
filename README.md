# PortView — 가족용 주식 포트폴리오 PWA

> 국내·해외 주식의 잔고, 자산, 배당, 실현손익, 성장 기록을 브라우저에서 관리하는 모바일 우선 웹앱

**현재 문서 기준:** Beta v0.9 · 2026-07-31

## 1분 만에 프로젝트 파악하기

- React 19 + TypeScript + Vite로 만든 단일 화면 PWA입니다.
- 모든 사용자 자산 데이터는 서버 DB가 아니라 **현재 브라우저의 LocalStorage**에 저장됩니다.
- PIN을 설정하면 전체 데이터가 `crypto-js` AES로 암호화되어 저장됩니다.
- 국내·해외 계좌는 프로필마다 별도로 관리합니다.
- 서버는 주식 시세, 시장 지수, 환율, 예상 배당 정보 조회와 브라우저 오류 수집만 담당합니다.
- 운영 배포는 Vercel을 사용하고, 이 작업공간에서는 `server.js`로 동일 기능을 검증할 수 있습니다.
- 화면 대부분이 `src/App.tsx` 한 파일에 모여 있어 UI 수정 시 영향 범위를 넓게 확인해야 합니다.

## 주요 기능

| 영역 | 기능 |
| --- | --- |
| 잔고 | 종목 추가·수정·삭제, 현재가 갱신, 정렬, CSV 가져오기 |
| 자산 | 투입금·예수금·평가금액·손익·비중 확인 |
| 배당 | 배당 기록, 예상 배당, 월별 기록, CSV 가져오기 |
| 손익 | 실현손익 기록·필터·CSV 가져오기 |
| 성장 | 투자 기간, 자산 추이, 목표 배당, 연도별 최고 기록 |
| 계좌 | 국내/해외 분리, 해외 USD/KRW 표시 전환 |
| 프로필 | PIN 해제 후 여러 프로필 선택·추가·이름 변경·삭제 |
| 데이터 | JSON 백업·복원, PIN 기반 암호화 저장 |
| 편의 | 시크릿 모드, PWA 설치, 자동 업데이트 |

## 기술 구성

| 구분 | 내용 |
| --- | --- |
| 프론트엔드 | React 19, TypeScript, Vite |
| UI | 커스텀 CSS, lucide-react |
| PWA | vite-plugin-pwa, 커스텀 `public/sw.js` |
| 저장소 | LocalStorage, crypto-js AES |
| 로컬 검증 서버 | Express + HTTPS (`server.js`) |
| 운영 API | Vercel Serverless Functions (`api/`) |
| 외부 데이터 | 네이버 금융/증권, 해외 배당 조회 시 Yahoo Finance 보조 |
| 테스트 | Vitest |

## 핵심 데이터 흐름

```text
App.tsx
  ├─ api.ts ───────────────> /api/quote, /api/dividend-info
  ├─ portfolioMath.ts ─────> 보유 종목·계좌 합계 계산
  └─ storage.ts ───────────> LocalStorage v1/v2 → v3 마이그레이션
                               └─ PIN 설정 시 v3:enc로 암호화

개발 서버: server.js가 API와 dist 정적 파일을 함께 제공
운영 배포: api/*.js가 API를, Vercel이 dist를 제공
```

주의: `server.js`와 `api/quote.js`에는 시세 조회 로직이 각각 구현되어 있습니다. 시세 조회 방식을 수정할 때는 두 경로의 동작이 달라지지 않았는지 함께 확인해야 합니다.

## 프로젝트 구조

```text
.
├── src/
│   ├── App.tsx                 # 전체 화면, 상태, 사용자 동작
│   ├── api.ts                  # 프론트엔드 API 클라이언트
│   ├── errorLogger.ts          # 전역 브라우저 오류 전송
│   ├── portfolioMath.ts        # 평가금액·수익률·계좌 합계 계산
│   ├── portfolioMath.test.ts   # 계산 로직 단위 테스트
│   ├── storage.ts              # 저장, 암호화, 마이그레이션, 백업
│   ├── styles.css              # 전체 반응형 스타일
│   └── types.ts                # 공유 타입
├── api/
│   ├── quote.js                # Vercel 시세·지수·환율 API
│   ├── dividend-info.js        # Vercel 예상 배당 API
│   └── client-error.js         # Vercel 브라우저 오류 수집
├── public/
│   └── sw.js                   # PWA Service Worker 원본
├── 앱설명페이지/               # 별도 정적 소개 페이지
├── server.js                   # 작업공간 검증용 HTTPS/Express 서버
├── start_server.sh             # 빌드 후 검증 서버 재시작
├── vite.config.ts              # 실제 Vite/PWA 설정 원본
└── vercel.json                 # 운영 빌드·라우팅 설정
```

`vite.config.js`, `vite.config.d.ts`, `*.tsbuildinfo`, `dist/`는 생성 결과이거나 빌드 산출물입니다. 설정 변경은 `vite.config.ts`에서 시작하세요.

## 개발 및 검증

```bash
npm install
npm test
npm run build
npm run lint
```

서버를 포함한 실제 동작 확인은 프로젝트 루트의 `start_server.sh`를 사용합니다. 이 스크립트는 빌드 후 이 프로젝트의 HTTPS 서버를 재시작합니다.

### 2026-07-31 기준 검증 상태

| 명령 | 상태 | 메모 |
| --- | --- | --- |
| `npm run build` | 통과 | TypeScript 검사와 Vite/PWA 빌드 성공 |
| `npm test` | 실패 1건 | `cashRatio` 테스트 기대값이 현재 제품 정의와 불일치 |
| `npm run lint` | 오류 20, 경고 8 | Node/Service Worker 전역 설정 및 `App.tsx` 규칙 위반 포함 |

현금 비중의 제품 정의는 `예수금 ÷ 자산평가액`입니다. 여기서 자산평가액은 `보유종목 평가금액 + 예수금`이며 현재 구현은 이 정의와 일치합니다. 실패하는 단위 테스트의 기대값이 오래된 상태입니다.

## 저장 데이터와 백업 주의사항

- 일반 저장 키는 `dad-portfolio-pwa:v3`, 암호화 저장 키는 `dad-portfolio-pwa:v3:enc`입니다.
- 기존 v1/v2 데이터는 읽을 때 v3의 프로필 구조로 마이그레이션됩니다.
- PIN은 서버 계정 인증이 아닙니다. 브라우저 안의 데이터를 암호화·해제하는 용도입니다.
- LocalStorage를 지우거나 다른 브라우저/기기로 이동하면 데이터가 자동 복구되지 않습니다.
- 데이터 관련 수정 전에는 앱의 JSON 내보내기로 백업하는 것이 안전합니다.
- 스키마를 바꿀 때는 `types.ts`, `storage.ts`의 마이그레이션, 백업 검증을 함께 수정해야 합니다.

## 디버깅 시작 순서

1. `git status --short --branch`로 미커밋 변경과 원격 차이를 확인합니다.
2. `browser_errors.log`와 `server.log`의 최신 항목을 확인합니다.
3. `npm test`, `npm run build`로 기존 기준선과 새 오류를 구분합니다.
4. UI 버그는 국내/해외 계좌, 여러 프로필, PIN 유무를 함께 확인합니다.
5. 저장 버그는 LocalStorage 키와 v1/v2/v3 마이그레이션 여부를 확인합니다.
6. API 버그는 작업공간 서버의 `server.js`와 운영용 `api/` 양쪽을 비교합니다.
7. PWA 캐시 문제는 `public/sw.js`, 생성된 `dist/sw.js`, 기존 Service Worker 등록 범위를 확인합니다.

### 현재 알려진 점검 항목

- 단위 테스트의 `cashRatio` 기대값이 제품 정의와 불일치
- 린트 기준선 미정리
- `server.js`와 `api/quote.js`의 중복 구현으로 인한 동작 불일치 위험
- 과거 `browser_errors.log`에 `/sw.js`, `/portview/sw.js`의 MIME/갱신 오류 기록 존재
- `App.tsx`가 약 5천 줄인 단일 대형 컴포넌트라 작은 변경도 회귀 확인 필요

## 버그 제보 메모 양식

다음 방문 때 아래 형식으로 남기면 바로 재현을 시작할 수 있습니다.

```text
현상:
재현 순서:
기대한 결과:
실제 결과:
발생 환경: (모바일/PC, 브라우저, 설치형 PWA 여부)
계좌/화면: (국내/해외, 잔고/자산/배당/손익/성장)
항상 발생 여부:
마지막 정상 시점:
스크린샷 또는 콘솔 오류:
```

## 최근 주요 변경

- 다중 프로필과 프로필 관리
- 국내/해외 계좌 및 USD/KRW 전환
- 자산 성장 그래프와 성장 기록
- 잔고·배당·실현손익 CSV 가져오기
- 종목명 클릭으로 보유 종목 수정 팝업 열기
- 매입가 입력의 3자리 콤마 표시

## Git 푸시 작업 규칙

- 이 프로젝트는 나니아 서버의 현재 작업공간에서 독립적으로 실행되므로, **Git 푸시만을 위해 서버를 재시작하지 않습니다.** 코드 변경의 실제 실행 검증이 필요한 경우에만 `start_server.sh`를 사용합니다.
- 원격 저장소 인증이 필요하면 사용자가 프로젝트 루트에 `token.txt`를 직접 올립니다.
- `token.txt`는 Git 인증에만 일시적으로 사용하며, 토큰 내용을 README, 로그, 명령 출력 또는 답변에 노출하지 않습니다.
- `token.txt`와 `token.txt.txt`는 `.gitignore`에 등록되어 있습니다. 푸시 전에 Git 추적 대상에 포함되지 않았는지 다시 확인하고 절대 커밋하지 않습니다.
- 푸시가 성공하거나 인증 시도가 끝나면 프로젝트 루트의 `token.txt`를 즉시 삭제합니다. 삭제 후 파일이 남아 있지 않은지 확인합니다.

## 배포

- `main` 브랜치 변경은 Vercel 운영 배포 대상으로 사용합니다.
- 운영 정적 결과는 `dist/`, 서버리스 API는 `api/`에서 생성·실행됩니다.
- 배포 전 최소 확인 항목은 `npm test`, `npm run build`, 주요 API 응답, PWA 갱신, 백업·복원입니다.
- 저장 데이터는 배포 서버에 없으므로 새 배포만으로 사용자 LocalStorage 데이터가 이전되거나 복구되지는 않습니다.
