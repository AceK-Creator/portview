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
  if (e.touches.length === 1) touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  // 멀티터치(핀치줌) 무조건 차단
  if (e.touches.length > 1) { e.preventDefault(); return; }

  // 문서가 아니라 내부 스크롤 영역이 실제로 움직일 수 있는지 확인
  const target = e.target instanceof Element ? e.target : null;
  let innerCanScrollUp = false;

  for (let node = target; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    const allowsVerticalScroll = /(auto|scroll|overlay)/.test(style.overflowY);
    if (allowsVerticalScroll && node.scrollHeight > node.clientHeight && node.scrollTop > 0) {
      innerCanScrollUp = true;
      break;
    }
  }

  const documentScrollTop = document.documentElement.scrollTop || document.body.scrollTop;
  const isPullingDown = e.touches[0].clientY > touchStartY;

  // 문서와 내부 스크롤 영역이 모두 최상단일 때만 pull-to-refresh 동작을 차단
  if (isPullingDown && documentScrollTop === 0 && !innerCanScrollUp) e.preventDefault();
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
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
