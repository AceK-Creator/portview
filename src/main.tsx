import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { installClientErrorLogger } from './errorLogger';
import './styles.css';

installClientErrorLogger();

// pinch-zoom + pull-to-refresh 차단
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
let touchStartY = 0;
document.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  // 멀티터치(핀치줌) 무조건 차단
  if (e.touches.length > 1) { e.preventDefault(); return; }
  // 최상단에서 아래로 당기는 pull-to-refresh 차단
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
  if (scrollTop === 0 && e.touches[0].clientY > touchStartY) e.preventDefault();
}, { passive: false });

// 새 버전 감지 시 즉시 적용
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true);
  },
  onOfflineReady() {},
});

if ('serviceWorker' in navigator) {
  // 새 SW가 제어권을 가져오면 페이지 새로고침
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  // 앱이 화면에 보일 때마다 (홈화면에서 열 때 포함) 업데이트 체크
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.ready.then(reg => reg.update());
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
