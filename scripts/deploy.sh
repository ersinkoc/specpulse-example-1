#!/bin/bash

# Production Deployment Script for Authentication Service
# This script automates the deployment process including backups, migrations, and health checks

set -euo pipefail

# Configuration
PROJECT_NAME="auth-service"
DEPLOY_USER="deploy"
BACKUP_DIR="/backups"
LOG_FILE="/var/log/${PROJECT_NAME}-deploy.log"
HEALTH_CHECK_URL="http://localhost:3000/health"
MAX_RETRIES=30
RETRY_INTERVAL=10

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "This script should not be run as root"
        exit 1
    fi
}

# Load environment variables
load_env() {
    if [[ -f .env.production ]]; then
        export $(cat .env.production | grep -v '^#' | xargs)
        log_success "Environment variables loaded from .env.production"
    else
        log_error "Environment file .env.production not found"
        exit 1
    fi
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi

    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed or not in PATH"
        exit 1
    fi

    # Check environment variables
    required_vars=(
        "DB_PASSWORD"
        "JWT_ACCESS_SECRET"
        "JWT_REFRESH_SECRET"
        "SESSION_SECRET"
    )

    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            log_error "Required environment variable $var is not set"
            exit 1
        fi
    done

    log_success "Prerequisites check passed"
}

# Create backup directory
create_backup_dir() {
    local backup_date=$(date +%Y%m%d_%H%M%S)
    BACKUP_PATH="${BACKUP_DIR}/${PROJECT_NAME}_${backup_date}"

    mkdir -p "$BACKUP_PATH"
    log_success "Backup directory created: $BACKUP_PATH"
    echo "$BACKUP_PATH"
}

# Backup database
backup_database() {
    local backup_path=$1
    log "Starting database backup..."

    if docker ps | grep -q "auth_postgres"; then
        docker exec auth_postgres pg_dump -U "${DB_USER}" "${DB_NAME}" > "${backup_path}/database.sql"

        if [[ $? -eq 0 ]]; then
            log_success "Database backup completed"
        else
            log_error "Database backup failed"
            return 1
        fi
    else
        log_warning "Database container not running, skipping backup"
    fi
}

# Backup application data
backup_app_data() {
    local backup_path=$1
    log "Starting application data backup..."

    # Backup uploads directory if it exists
    if [[ -d "./uploads" ]]; then
        tar -czf "${backup_path}/uploads.tar.gz" ./uploads
        log_success "Application data backup completed"
    else
        log_warning "No uploads directory found, skipping data backup"
    fi

    # Backup configuration files
    cp .env.production "${backup_path}/"
    cp docker-compose.prod.yml "${backup_path}/"
    log_success "Configuration backup completed"
}

# Stop existing services
stop_services() {
    log "Stopping existing services..."

    cd "$(dirname "$0")/.."

    if docker-compose -f docker-compose.prod.yml ps -q | grep -q .; then
        docker-compose -f docker-compose.prod.yml down
        log_success "Services stopped"
    else
        log_warning "No services were running"
    fi
}

# Pull latest images
pull_images() {
    log "Pulling latest Docker images..."

    cd "$(dirname "$0")/.."

    docker-compose -f docker-compose.prod.yml pull
    log_success "Images pulled successfully"
}

# Build application image
build_image() {
    log "Building application image..."

    cd "$(dirname "$0")/.."

    docker-compose -f docker-compose.prod.yml build auth_app
    log_success "Application image built successfully"
}

# Start services
start_services() {
    log "Starting services..."

    cd "$(dirname "$0")/.."

    docker-compose -f docker-compose.prod.yml up -d

    log_success "Services started"
}

# Wait for services to be healthy
wait_for_health() {
    local retries=0

    log "Waiting for services to be healthy..."

    while [[ $retries -lt $MAX_RETRIES ]]; do
        if curl -f -s "$HEALTH_CHECK_URL" > /dev/null 2>&1; then
            log_success "Services are healthy"
            return 0
        fi

        retries=$((retries + 1))
        log "Health check attempt $retries/$MAX_RETRIES..."
        sleep $RETRY_INTERVAL
    done

    log_error "Services failed to become healthy after $MAX_RETRIES attempts"
    return 1
}

# Run database migrations
run_migrations() {
    log "Running database migrations..."

    cd "$(dirname "$0")/.."

    # Wait for database to be ready
    local db_retries=0
    while [[ $db_retries -lt 10 ]]; do
        if docker exec auth_postgres pg_isready -U "${DB_USER}" -d "${DB_NAME}" > /dev/null 2>&1; then
            break
        fi
        db_retries=$((db_retries + 1))
        sleep 5
    done

    # Run migrations
    docker exec auth_postgres psql -U "${DB_USER}" -d "${DB_NAME}" -f /docker-entrypoint-initdb.d/001_create_users.sql

    if [[ $? -eq 0 ]]; then
        log_success "Database migrations completed"
    else
        log_error "Database migrations failed"
        return 1
    fi
}

# Verify deployment
verify_deployment() {
    log "Verifying deployment..."

    # Check application health
    local health_response=$(curl -s "$HEALTH_CHECK_URL" || echo "")

    if [[ $health_response == *"\"status\":\"OK\""* ]]; then
        log_success "Application health check passed"
    else
        log_error "Application health check failed"
        return 1
    fi

    # Check database connectivity
    if docker exec auth_postgres pg_isready -U "${DB_USER}" -d "${DB_NAME}" > /dev/null 2>&1; then
        log_success "Database connectivity check passed"
    else
        log_error "Database connectivity check failed"
        return 1
    fi

    # Check Redis connectivity
    if docker exec auth_redis redis-cli ping > /dev/null 2>&1; then
        log_success "Redis connectivity check passed"
    else
        log_error "Redis connectivity check failed"
        return 1
    fi

    log_success "Deployment verification completed successfully"
}

# Cleanup old backups
cleanup_backups() {
    log "Cleaning up old backups (keeping last 7 days)..."

    find "$BACKUP_DIR" -name "${PROJECT_NAME}_*" -type d -mtime +7 -exec rm -rf {} \;
    log_success "Old backups cleaned up"
}

# Rollback function
rollback() {
    local backup_path=$1
    log_error "Deployment failed, initiating rollback..."

    cd "$(dirname "$0")/.."

    # Stop failed deployment
    docker-compose -f docker-compose.prod.yml down

    # Restore database if backup exists
    if [[ -f "${backup_path}/database.sql" ]]; then
        log "Restoring database from backup..."
        docker-compose -f docker-compose.prod.yml up -d postgres

        # Wait for database to be ready
        local retries=0
        while [[ $retries -lt 10 ]]; do
            if docker exec auth_postgres pg_isready -U "${DB_USER}" -d "${DB_NAME}" > /dev/null 2>&1; then
                break
            fi
            retries=$((retries + 1))
            sleep 5
        done

        docker exec -i auth_postgres psql -U "${DB_USER}" -d "${DB_NAME}" < "${backup_path}/database.sql"
        log_success "Database restored from backup"
    fi

    # Restore application data if backup exists
    if [[ -f "${backup_path}/uploads.tar.gz" ]]; then
        log "Restoring application data from backup..."
        tar -xzf "${backup_path}/uploads.tar.gz"
        log_success "Application data restored"
    fi

    # Start previous version (assuming it's available)
    # This is a simplified rollback - in production, you might want to tag images
    docker-compose -f docker-compose.prod.yml up -d

    log_warning "Rollback completed. Please verify the system is working correctly."
}

# Main deployment function
deploy() {
    log "Starting deployment process..."

    # Create backup
    local backup_path=$(create_backup_dir)

    # Perform backups
    backup_database "$backup_path" || true
    backup_app_data "$backup_path" || true

    # Deployment steps
    stop_services || { rollback "$backup_path"; exit 1; }
    pull_images || { rollback "$backup_path"; exit 1; }
    build_image || { rollback "$backup_path"; exit 1; }
    start_services || { rollback "$backup_path"; exit 1; }
    run_migrations || { rollback "$backup_path"; exit 1; }
    wait_for_health || { rollback "$backup_path"; exit 1; }
    verify_deployment || { rollback "$backup_path"; exit 1; }

    # Cleanup
    cleanup_backups

    log_success "Deployment completed successfully!"
    log "Backup stored at: $backup_path"
    log "Application is running at: $HEALTH_CHECK_URL"
}

# Display usage information
usage() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  deploy    Deploy the application (default)"
    echo "  backup    Create backup only"
    echo "  rollback  Rollback to previous backup"
    echo "  status    Show deployment status"
    echo "  logs      Show application logs"
    echo "  help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 deploy    # Deploy the application"
    echo "  $0 backup    # Create backup only"
    echo "  $0 status    # Show current status"
}

# Show deployment status
show_status() {
    log "Checking deployment status..."

    cd "$(dirname "$0")/.."

    echo "=== Docker Containers Status ==="
    docker-compose -f docker-compose.prod.yml ps

    echo ""
    echo "=== Application Health ==="
    if curl -f -s "$HEALTH_CHECK_URL" > /dev/null 2>&1; then
        local health_response=$(curl -s "$HEALTH_CHECK_URL")
        echo "$health_response" | python3 -m json.tool 2>/dev/null || echo "$health_response"
    else
        echo "Application is not responding"
    fi

    echo ""
    echo "=== Recent Logs ==="
    if [[ -f "$LOG_FILE" ]]; then
        tail -n 20 "$LOG_FILE"
    else
        echo "No log file found"
    fi
}

# Show application logs
show_logs() {
    log "Showing application logs..."

    cd "$(dirname "$0")/.."

    echo "=== Application Logs ==="
    docker-compose -f docker-compose.prod.yml logs -f --tail=100 auth_app
}

# Main script execution
main() {
    check_root

    local command=${1:-deploy}

    case "$command" in
        deploy)
            load_env
            check_prerequisites
            deploy
            ;;
        backup)
            load_env
            local backup_path=$(create_backup_dir)
            backup_database "$backup_path"
            backup_app_data "$backup_path"
            log_success "Backup completed: $backup_path"
            ;;
        rollback)
            echo "Available backups:"
            ls -la "$BACKUP_DIR" | grep "^d" | grep "$PROJECT_NAME" | tail -5
            echo ""
            read -p "Enter backup directory to rollback to: " backup_dir
            if [[ -d "$backup_dir" ]]; then
                rollback "$backup_dir"
            else
                log_error "Backup directory not found: $backup_dir"
                exit 1
            fi
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs
            ;;
        help|--help|-h)
            usage
            ;;
        *)
            log_error "Unknown command: $command"
            usage
            exit 1
            ;;
    esac
}

# Trap to handle interruption
trap 'log_warning "Deployment interrupted by user"; exit 1' INT TERM

# Execute main function
main "$@"