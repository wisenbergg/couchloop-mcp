#!/bin/bash

# OAuth Service Monitoring Script
# Monitors the health, security, and performance of the OAuth service

set -euo pipefail

# Configuration
NAMESPACE="couchloop"
SERVICE_NAME="oauth-service"
METRICS_PORT="9090"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"  # seconds

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Metrics thresholds
CPU_THRESHOLD=80           # percentage
MEMORY_THRESHOLD=80         # percentage
ERROR_RATE_THRESHOLD=5     # percentage
LATENCY_THRESHOLD=1000      # milliseconds

log_info() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} ⚠️  $1"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} ❌ $1"
}

log_metric() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} 📊 $1"
}

check_deployment_status() {
    local ready_replicas=$(kubectl get deployment "${SERVICE_NAME}" -n "${NAMESPACE}" \
        -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    local desired_replicas=$(kubectl get deployment "${SERVICE_NAME}" -n "${NAMESPACE}" \
        -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")

    if [ "${ready_replicas}" -eq "${desired_replicas}" ] && [ "${ready_replicas}" -gt 0 ]; then
        log_info "Deployment status: ${ready_replicas}/${desired_replicas} replicas ready ✅"
        return 0
    else
        log_error "Deployment status: ${ready_replicas}/${desired_replicas} replicas ready"
        return 1
    fi
}

check_pod_health() {
    local unhealthy_pods=0
    local pod_list=$(kubectl get pods -n "${NAMESPACE}" -l app="${SERVICE_NAME}" \
        -o jsonpath='{.items[*].metadata.name}')

    for pod in ${pod_list}; do
        local ready=$(kubectl get pod "${pod}" -n "${NAMESPACE}" \
            -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')

        if [ "${ready}" != "True" ]; then
            log_error "Pod ${pod} is not ready"
            ((unhealthy_pods++))
        fi
    done

    if [ ${unhealthy_pods} -eq 0 ]; then
        log_info "All pods are healthy ✅"
        return 0
    else
        log_error "${unhealthy_pods} unhealthy pod(s) detected"
        return 1
    fi
}

check_resource_usage() {
    log_metric "Resource Usage:"

    kubectl top pods -n "${NAMESPACE}" -l app="${SERVICE_NAME}" --no-headers | while read -r line; do
        local pod=$(echo "${line}" | awk '{print $1}')
        local cpu=$(echo "${line}" | awk '{print $2}' | sed 's/m//')
        local memory=$(echo "${line}" | awk '{print $3}' | sed 's/Mi//')

        # Convert millicores to percentage (assuming 1000m = 1 CPU = 100%)
        local cpu_percent=$((cpu / 10))

        # Check thresholds
        if [ ${cpu_percent} -gt ${CPU_THRESHOLD} ]; then
            log_warn "Pod ${pod}: High CPU usage: ${cpu_percent}%"
        else
            log_metric "Pod ${pod}: CPU: ${cpu}m, Memory: ${memory}Mi"
        fi
    done
}

check_security_events() {
    local pod=$(kubectl get pod -n "${NAMESPACE}" -l app="${SERVICE_NAME}" \
        -o jsonpath='{.items[0].metadata.name}')

    if [ -z "${pod}" ]; then
        log_error "No pods found"
        return 1
    fi

    log_info "Checking security events..."

    # Check for recent security alerts in logs
    local security_events=$(kubectl logs "${pod}" -n "${NAMESPACE}" --since=1h 2>/dev/null | \
        grep -E "CRITICAL|HIGH|SECURITY|ALERT|BREACH|ATTACK" | wc -l)

    if [ "${security_events}" -gt 0 ]; then
        log_warn "Found ${security_events} security events in the last hour"

        # Show recent critical events
        kubectl logs "${pod}" -n "${NAMESPACE}" --since=1h 2>/dev/null | \
            grep -E "CRITICAL|BREACH|ATTACK" | head -5
    else
        log_info "No critical security events detected ✅"
    fi
}

fetch_metrics() {
    local pod=$(kubectl get pod -n "${NAMESPACE}" -l app="${SERVICE_NAME}" \
        -o jsonpath='{.items[0].metadata.name}')

    if [ -z "${pod}" ]; then
        log_error "No pods found"
        return 1
    }

    log_metric "Service Metrics:"

    # Port forward to metrics endpoint
    kubectl port-forward -n "${NAMESPACE}" "${pod}" 9090:${METRICS_PORT} > /dev/null 2>&1 &
    local port_forward_pid=$!
    sleep 2

    # Fetch key metrics
    if curl -s http://localhost:9090/metrics > /tmp/oauth_metrics.txt 2>/dev/null; then
        # Parse metrics
        local login_success=$(grep "oauth_login_success_total" /tmp/oauth_metrics.txt | \
            awk '{print $2}' | head -1)
        local login_failure=$(grep "oauth_login_failure_total" /tmp/oauth_metrics.txt | \
            awk '{print $2}' | head -1)
        local tokens_issued=$(grep "oauth_token_issued_total" /tmp/oauth_metrics.txt | \
            awk '{print $2}' | head -1)
        local anomalies=$(grep "oauth_anomaly_detected_total" /tmp/oauth_metrics.txt | \
            awk '{print $2}' | head -1)

        log_metric "Login Success: ${login_success:-0}"
        log_metric "Login Failures: ${login_failure:-0}"
        log_metric "Tokens Issued: ${tokens_issued:-0}"
        log_metric "Anomalies Detected: ${anomalies:-0}"

        # Calculate error rate
        if [ -n "${login_success}" ] && [ -n "${login_failure}" ]; then
            local total=$((${login_success%.*} + ${login_failure%.*}))
            if [ ${total} -gt 0 ]; then
                local error_rate=$((${login_failure%.*} * 100 / total))
                if [ ${error_rate} -gt ${ERROR_RATE_THRESHOLD} ]; then
                    log_warn "High error rate detected: ${error_rate}%"
                fi
            fi
        fi
    else
        log_warn "Could not fetch metrics"
    fi

    # Kill port forward
    kill ${port_forward_pid} 2>/dev/null || true
    rm -f /tmp/oauth_metrics.txt
}

check_database_connectivity() {
    local pod=$(kubectl get pod -n "${NAMESPACE}" -l app="${SERVICE_NAME}" \
        -o jsonpath='{.items[0].metadata.name}')

    if kubectl exec -n "${NAMESPACE}" "${pod}" -- \
        sh -c 'pg_isready -h $DATABASE_HOST -U $DATABASE_USER' &> /dev/null; then
        log_info "Database connectivity: OK ✅"
    else
        log_error "Database connectivity: FAILED"
    fi
}

check_redis_connectivity() {
    local pod=$(kubectl get pod -n "${NAMESPACE}" -l app="${SERVICE_NAME}" \
        -o jsonpath='{.items[0].metadata.name}')

    if kubectl exec -n "${NAMESPACE}" "${pod}" -- \
        sh -c 'redis-cli -u $REDIS_URL ping' 2>/dev/null | grep -q "PONG"; then
        log_info "Redis connectivity: OK ✅"
    else
        log_error "Redis connectivity: FAILED"
    fi
}

check_external_endpoints() {
    log_info "Checking external OAuth provider connectivity..."

    # Check Google OAuth
    if curl -s -o /dev/null -w "%{http_code}" https://accounts.google.com/.well-known/openid-configuration | \
        grep -q "200"; then
        log_info "Google OAuth: Reachable ✅"
    else
        log_warn "Google OAuth: Unreachable"
    fi

    # Check GitHub OAuth
    if curl -s -o /dev/null -w "%{http_code}" https://github.com/login/oauth/authorize | \
        grep -q "200\|302"; then
        log_info "GitHub OAuth: Reachable ✅"
    else
        log_warn "GitHub OAuth: Unreachable"
    fi
}

generate_report() {
    echo ""
    echo "═══════════════════════════════════════"
    echo "   OAuth Service Monitoring Report"
    echo "   $(date +'%Y-%m-%d %H:%M:%S')"
    echo "═══════════════════════════════════════"
    echo ""

    local all_checks_passed=true

    # Run all checks and collect results
    if ! check_deployment_status; then all_checks_passed=false; fi
    if ! check_pod_health; then all_checks_passed=false; fi

    check_resource_usage
    check_security_events
    fetch_metrics
    check_database_connectivity
    check_redis_connectivity
    check_external_endpoints

    echo ""
    echo "═══════════════════════════════════════"

    if [ "${all_checks_passed}" = true ]; then
        log_info "Overall Status: HEALTHY ✅"
    else
        log_error "Overall Status: ISSUES DETECTED"
    fi

    echo "═══════════════════════════════════════"
    echo ""
}

continuous_monitoring() {
    log_info "Starting continuous monitoring (interval: ${CHECK_INTERVAL}s)"
    log_info "Press Ctrl+C to stop"
    echo ""

    while true; do
        generate_report
        sleep "${CHECK_INTERVAL}"
    done
}

send_alert() {
    local severity="$1"
    local message="$2"

    # Send to webhook if configured
    if [ -n "${ALERT_WEBHOOK:-}" ]; then
        curl -X POST "${ALERT_WEBHOOK}" \
            -H "Content-Type: application/json" \
            -d "{\"severity\":\"${severity}\",\"message\":\"${message}\",\"service\":\"${SERVICE_NAME}\"}" \
            2>/dev/null || true
    fi

    # Log alert
    case "${severity}" in
        "critical")
            log_error "CRITICAL ALERT: ${message}"
            ;;
        "warning")
            log_warn "WARNING: ${message}"
            ;;
        *)
            log_info "INFO: ${message}"
            ;;
    esac
}

# Main execution
main() {
    case "${1:-}" in
        "once")
            generate_report
            ;;
        "continuous")
            continuous_monitoring
            ;;
        "alerts")
            # Check for critical conditions and send alerts
            if ! check_deployment_status; then
                send_alert "critical" "OAuth service deployment unhealthy"
            fi
            if ! check_pod_health; then
                send_alert "critical" "OAuth service pods unhealthy"
            fi
            check_security_events
            ;;
        *)
            echo "Usage: $0 [once|continuous|alerts]"
            echo "  once       - Run checks once and exit"
            echo "  continuous - Run checks continuously"
            echo "  alerts     - Check for critical conditions and send alerts"
            exit 1
            ;;
    esac
}

# Handle script termination
trap 'echo ""; log_info "Monitoring stopped"; exit 0' INT TERM

main "$@"