module.exports = {
  apps: [
    {
      name: 'testnet-indexer',
      script: 'npm',
      args: 'run dev:indexer',
      env: {
        NODE_ENV: 'development',
        DEBUG: '*',
        PM2_NO_AUTOMATION: 'true',
        PM2_SILENT: 'true',
        PM2_METRICS: 'false'
      },
      max_memory_restart: '1G',
      time: true,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env_file: '.env',
      metrics: false,
      deep_metrics: false,
      trace: false,
      disable_metrics: true,
      axm_options: {
        metrics: false,
        human_info: false,
        transactions: false,
        http: false,
        v8: false,
        events: false
      }
    }
  ]
} 