# Deployment Guide

## Overview

This guide covers deployment of the User Authentication API to various environments including development, staging, and production.

## Prerequisites

- Node.js 16.0.0 or higher
- PostgreSQL 12.0 or higher
- Redis 6.0 or higher (for rate limiting)
- SSL certificate (for production)
- Domain name (for production)

## Environment Configuration

### Required Environment Variables

Create a `.env` file in the project root:

```env
# Application
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=auth_db_prod
DB_USER=auth_user
DB_PASSWORD=secure_database_password

# JWT Secrets (generate strong secrets)
JWT_ACCESS_SECRET=your_jwt_access_secret_minimum_32_characters
JWT_REFRESH_SECRET=your_jwt_refresh_secret_minimum_32_characters
JWT_ACCESS_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Session Security
SESSION_SECRET=your_session_secret_minimum_32_characters

# OAuth2 Configuration
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_CALLBACK_URL=https://yourdomain.com/oauth/google/callback

GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
GITHUB_CALLBACK_URL=https://yourdomain.com/oauth/github/callback

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_specific_password
EMAIL_FROM=noreply@yourdomain.com

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Security
BCRYPT_ROUNDS=12
CORS_ORIGIN=https://yourdomain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# File Uploads
MAX_FILE_SIZE=5242880
UPLOAD_PATH=/var/www/uploads/avatars

# Frontend URL
FRONTEND_URL=https://yourdomain.com
```

## Database Setup

### 1. Create Database and User

```sql
-- Connect to PostgreSQL as superuser
CREATE DATABASE auth_db_prod;
CREATE USER auth_user WITH PASSWORD 'secure_database_password';
GRANT ALL PRIVILEGES ON DATABASE auth_db_prod TO auth_user;
```

### 2. Run Migrations

```bash
# Set database URL for migrations
export DATABASE_URL="postgresql://auth_user:secure_database_password@localhost:5432/auth_db_prod"

# Run all migrations
node -e "
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrations = [
  '001_create_users.sql',
  '002_create_email_tokens.sql',
  '003_create_refresh_tokens.sql',
  '004_create_oauth_providers.sql'
];

(async () => {
  for (const migration of migrations) {
    const sql = fs.readFileSync(\`src/database/migrations/\${migration}\`, 'utf8');
    await pool.query(sql);
    console.log(\`Migration \${migration} completed\`);
  }
  await pool.end();
})();
"
```

## Deployment Options

### 1. Docker Deployment

#### Dockerfile

```dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create uploads directory
RUN mkdir -p uploads/avatars

# Set permissions
RUN chown -R node:node /app
USER node

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start application
CMD ["npm", "start"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - REDIS_HOST=redis
    depends_on:
      - postgres
      - redis
    volumes:
      - ./uploads:/app/uploads
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: auth_db_prod
      POSTGRES_USER: auth_user
      POSTGRES_PASSWORD: secure_database_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass your_redis_password
    volumes:
      - redis_data:/data
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
      - ./uploads:/var/www/uploads
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### 2. Nginx Configuration

#### nginx.conf

```nginx
events {
    worker_connections 1024;
}

http {
    upstream app {
        server app:3000;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/s;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name yourdomain.com www.yourdomain.com;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name yourdomain.com www.yourdomain.com;

        # SSL configuration
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;

        # API routes with rate limiting
        location /auth/ {
            limit_req zone=auth burst=10 nodelay;
            proxy_pass http://app;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /user/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://app;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # OAuth routes
        location /oauth/ {
            proxy_pass http://app;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Health check
        location /health {
            proxy_pass http://app;
            access_log off;
        }

        # Static files
        location /uploads/ {
            alias /var/www/uploads/;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

### 3. Systemd Service (Linux)

#### /etc/systemd/system/auth-api.service

```ini
[Unit]
Description=User Authentication API
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/auth-api
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/var/www/auth-api/.env

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/auth-api/uploads

[Install]
WantedBy=multi-user.target
```

#### Enable and start service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable auth-api
sudo systemctl start auth-api
sudo systemctl status auth-api
```

### 4. PM2 Deployment

#### Install PM2:

```bash
npm install -g pm2
```

#### ecosystem.config.js:

```javascript
module.exports = {
  apps: [{
    name: 'auth-api',
    script: 'server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024'
  }]
};
```

#### Deploy with PM2:

```bash
# Start application
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
```

## Security Considerations

### 1. SSL/TLS Configuration

- Use valid SSL certificates (Let's Encrypt recommended)
- Enforce HTTPS redirects
- Use TLS 1.2 or higher
- Implement proper cipher suites

### 2. Database Security

- Use strong database passwords
- Enable SSL connections to database
- Limit database user permissions
- Regular database backups

### 3. Application Security

- Keep dependencies updated
- Use environment variables for secrets
- Implement proper logging and monitoring
- Regular security audits

### 4. Network Security

- Configure firewall rules
- Use VPN for admin access
- Implement DDoS protection
- Monitor for suspicious activity

## Monitoring and Logging

### 1. Application Monitoring

#### health.js:

```javascript
const healthCheck = async (req, res) => {
  try {
    // Check database connection
    const dbResult = await pool.query('SELECT NOW()');

    // Check Redis connection
    await redisClient.ping();

    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database: 'connected',
      redis: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
};
```

### 2. Log Management

Configure structured logging with different levels:

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}
```

### 3. Backup Strategy

#### Database Backup Script:

```bash
#!/bin/bash
# backup-db.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/auth-api"
DB_NAME="auth_db_prod"
DB_USER="auth_user"

# Create backup directory
mkdir -p $BACKUP_DIR

# Create database backup
pg_dump -h localhost -U $DB_USER -d $DB_NAME | gzip > $BACKUP_DIR/backup_$DATE.sql.gz

# Remove backups older than 30 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +30 -delete

echo "Backup completed: backup_$DATE.sql.gz"
```

#### Add to crontab:

```bash
# Daily backup at 2 AM
0 2 * * * /var/www/auth-api/scripts/backup-db.sh
```

## Performance Optimization

### 1. Database Optimization

```sql
-- Add indexes for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_user_active ON refresh_tokens(user_id, is_active) WHERE is_active = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oauth_providers_lookup ON oauth_providers(provider_name, provider_id);

-- Analyze tables for query optimization
ANALYZE users;
ANALYZE refresh_tokens;
ANALYZE oauth_providers;
```

### 2. Caching Strategy

- Redis for rate limiting
- Cache frequently accessed user data
- Implement CDN for static assets

### 3. Load Balancing

- Use multiple app instances
- Configure Nginx load balancing
- Implement health checks

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Check database credentials
   - Verify database is running
   - Check network connectivity

2. **Redis Connection Errors**
   - Verify Redis is running
   - Check Redis credentials
   - Test Redis connectivity

3. **JWT Token Issues**
   - Verify JWT secrets are set
   - Check token expiration
   - Validate token format

4. **Rate Limiting Issues**
   - Check Redis connection
   - Verify Redis storage
   - Monitor rate limit hits

### Log Analysis

```bash
# View application logs
tail -f logs/combined.log

# View error logs
tail -f logs/error.log

# Search for specific errors
grep "ERROR" logs/combined.log

# Monitor rate limiting
grep "Rate limit" logs/combined.log
```

## Scaling

### Horizontal Scaling

1. **Multiple Application Instances**
   - Use load balancer
   - Session-less architecture
   - Shared database and Redis

2. **Database Scaling**
   - Read replicas for read operations
   - Database sharding for large datasets
   - Connection pooling

3. **Redis Scaling**
   - Redis cluster for high availability
   - Redis persistence configuration
   - Memory optimization

## Maintenance

### Regular Tasks

1. **Security Updates**
   - Update Node.js dependencies
   - Apply security patches
   - Review security configurations

2. **Database Maintenance**
   - Regular backups
   - Index optimization
   - Log cleanup

3. **Monitoring**
   - Check application health
   - Monitor resource usage
   - Review error logs

### Rolling Updates

1. **Zero-downtime Deployment**
   - Use multiple instances
   - Gradual instance replacement
   - Health checks during deployment

2. **Database Migrations**
   - Test migrations on staging
   - Backup before migration
   - Rollback plan ready

This deployment guide provides comprehensive instructions for deploying the User Authentication API in production environments with proper security, monitoring, and scaling considerations.