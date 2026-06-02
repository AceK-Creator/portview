# PortView — 아빠의 주식 포트폴리오 앱

> 가족 해커톤에서 바이브코딩으로 만든 개인 주식 포트폴리오 관리 PWA

---

## 앱 소개

국내 주식 보유 현황을 실시간으로 확인하고, 배당·실현손익을 기록·관리하는 **모바일 우선 웹앱**입니다.  
Vercel에 배포되어 있어 별도 서버 없이 어디서나 접속 가능합니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **실시간 현황** | 보유 종목의 현재가·등락·평가금액 자동 조회 (네이버 시세 기반) |
| **전체 계좌 손익** | 총투입금액, 예수금, 총자산, 수익률 한눈에 확인 |
| **배당 관리** | 종목별 배당 수령 기록 및 누계 합산 |
| **실현손익 관리** | 매도 후 실현된 손익 기록 |
| **시크릿 모드** | 버튼 한 번으로 금액·수익 수치 전체 블러 처리 (타인 시선 차단) |
| **백업·복원** | JSON 파일로 데이터 내보내기/불러오기 |
| **비밀번호 보호** | 앱 진입 시 비밀번호 인증 |
| **PWA 설치** | 홈 화면에 추가하여 앱처럼 사용 가능 |

---

## 기술 스택

- **Frontend:** React 19 + TypeScript + Vite
- **스타일:** CSS (커스텀, 반응형)
- **아이콘:** lucide-react
- **시세 API:** Vercel Serverless Function → 네이버 금융 크롤링
- **배포:** Vercel
- **데이터 저장:** 브라우저 LocalStorage (서버 DB 없음)
- **PWA:** vite-plugin-pwa

---

## 프로젝트 구조

```
src/
├── App.tsx          # 메인 UI 컴포넌트 (화면 전체)
├── api.ts           # 주식 시세 조회 함수
├── portfolioMath.ts # 수익률·평가금액 등 계산 로직
├── storage.ts       # LocalStorage 저장·불러오기·백업
├── types.ts         # TypeScript 타입 정의
└── styles.css       # 전체 스타일

api/
└── quote.js         # Vercel Serverless Function (시세 API)
```

---

## 개발 이력 (주요 마일스톤)

- 기본 포트폴리오 뷰 구현
- 실시간 시세 자동 조회
- 배당·실현손익 관리 탭 추가
- 시크릿 모드 구현 (자산/수익/배당 블러)
- PWA 설치 지원
- Vercel 독립 배포 (나니아 서버 의존성 제거)

---

## AI와 함께 개발하는 법

이 앱은 바이브코딩(AI 협업 개발)으로 만들어졌습니다.  
Claude Code나 ChatGPT에게 이 레포 URL을 알려주고 아래처럼 시작하면 됩니다:

```
"이 앱은 아빠의 주식 포트폴리오 관리 PWA야.
GitHub: https://github.com/AceK-Creator/portview
React + TypeScript + Vite 구조이고,
데이터는 LocalStorage에 저장돼.
[원하는 작업 설명]"
```

---

## 배포

- **운영 URL:** Vercel 자동 배포 (main 브랜치 push 시 자동 반영)
- **시세 API:** `api/quote.js` (Vercel Serverless Function)
