module.exports = {
  apps: [
    {
      name: "smart-money-tracker",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        SMT_PROFILE_URL: "https://www.binance.com/en-TR/smart-money/profile/5042407904790565889",
        SMT_INTERVAL_MS: "8000"
      },
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      time: true
    }
  ]
};
