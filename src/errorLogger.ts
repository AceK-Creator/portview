import { logClientError } from './api';

export function installClientErrorLogger(): void {
  window.addEventListener('error', (event) => {
    void logClientError({
      type: 'error',
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
      at: new Date().toISOString(),
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    void logClientError({
      type: 'unhandledrejection',
      message: event.reason?.message || String(event.reason),
      stack: event.reason?.stack,
      at: new Date().toISOString(),
    });
  });
}
