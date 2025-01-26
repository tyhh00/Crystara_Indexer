module.exports = {
  apps: [
    {
      name: 'indexer',
      script: 'npm',
      args: 'run dev:indexer',
      env: {
        NODE_ENV: 'development',
        DEBUG: '*',
      },
      max_memory_restart: '1G',
      log_file: 'logs/combined.log',
      time: true,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env_file: '.env',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_type: 'raw',
      
      // Disable PM2 metrics
      metrics: false,
      deep_metrics: false,
      trace: false,
      disable_metrics: true,
      axm_options: {
        metrics: {
          transaction: false
        }
      }
    }
  ]
} 