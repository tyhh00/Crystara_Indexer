module.exports = {
  apps: [
    {
      name: 'indexer',
      script: 'npm',
      args: 'run dev:indexer',
      env: {
        NODE_ENV: 'development'
      },
      max_memory_restart: '1G',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      time: true,
      instances: 1,
      autorestart: true,
      watch: true,
      max_restarts: 10,
      restart_delay: 5000,
      env_file: '.env'
    }
  ]
} 