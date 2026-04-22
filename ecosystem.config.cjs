module.exports = {
  apps: [
    {
      name: 'dispatch',
      script: 'src/server.js',
      cwd: __dirname,
      env_file: '.env',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      kill_timeout: 5000,
      out_file: 'logs/out.log',
      error_file: 'logs/err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
