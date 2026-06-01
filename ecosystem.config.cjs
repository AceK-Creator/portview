module.exports = {
  apps: [
    {
      name: 'dad-portfolio',
      script: 'server.js',
      cwd: __dirname,
      env: {
        PORT: 18440,
        SSL_CERT: '/etc/letsencrypt/live/narnialab.duckdns.org/fullchain.pem',
        SSL_KEY: '/etc/letsencrypt/live/narnialab.duckdns.org/privkey.pem',
      },
      // 충돌 시 자동 재시작
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      // 로그
      out_file: './pm2.out.log',
      error_file: './pm2.err.log',
      merge_logs: true,
    },
  ],
};
