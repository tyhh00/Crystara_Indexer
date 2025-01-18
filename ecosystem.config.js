module.exports = {
  apps: [
    {
      name: 'indexer',
      script: 'npm',
      args: 'run indexer',
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '1G',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      time: true,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env_file: '.env'
    }
  ]
} 