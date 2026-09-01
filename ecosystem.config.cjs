module.exports = {
  apps: [
    {
      name: 'my-app',
      script: process.env.ComSpec || 'cmd.exe',
      args: '/c npm run start',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};