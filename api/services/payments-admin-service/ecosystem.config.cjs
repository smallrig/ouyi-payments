/** PM2：payments-admin-service（本机监听，由 Nginx API 域名反代）
 *  正式：PM2_APP_NAME=payments-admin-service（默认）→ :3025
 *  测试：PM2_APP_NAME=payments-admin-service-sandbox → :3026（PORT 以目录下 .env 为准）
 */
const appName = process.env.PM2_APP_NAME || 'payments-admin-service';

module.exports = {
  apps: [
    {
      name: appName,
      cwd: __dirname,
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: `/www/wwwlogs/${appName}-error.log`,
      out_file: `/www/wwwlogs/${appName}-out.log`,
      merge_logs: true,
      time: true
    }
  ]
};
