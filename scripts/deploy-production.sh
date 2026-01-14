#!/bin/bash

# OAuth Service Production Deployment Script
# This script deploys the OAuth service to a Kubernetes cluster

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="couchloop"
SERVICE_NAME="oauth-service"
REGISTRY="couchloop"
VERSION="${1:-latest}"
ENVIRONMENT="${2:-production}"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl."
    fi

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Please install Docker."
    fi

    # Check cluster connection
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster. Check your kubeconfig."
    fi

    log_info "Prerequisites check passed."
}

validate_secrets() {
    log_info "Validating required secrets..."

    required_secrets=(
        "JWT_SECRET"
        "ENCRYPTION_KEY"
        "STATE_SECRET"
        "DATABASE_URL"
        "REDIS_URL"
        "GOOGLE_CLIENT_ID"
        "GOOGLE_CLIENT_SECRET"
        "GITHUB_CLIENT_ID"
        "GITHUB_CLIENT_SECRET"
    )

    for secret in "${required_secrets[@]}"; do
        if [ -z "${!secret:-}" ]; then
            log_error "Required secret $secret is not set"
        fi
    done

    log_info "All required secrets are set."
}

build_and_push() {
    log_info "Building Docker image..."

    docker build -f Dockerfile.oauth \
        --build-arg VERSION="${VERSION}" \
        --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
        --build-arg VCS_REF="$(git rev-parse HEAD)" \
        -t "${REGISTRY}/${SERVICE_NAME}:${VERSION}" \
        -t "${REGISTRY}/${SERVICE_NAME}:${ENVIRONMENT}" \
        -t "${REGISTRY}/${SERVICE_NAME}:latest" \
        .

    log_info "Pushing image to registry..."
    docker push "${REGISTRY}/${SERVICE_NAME}:${VERSION}"
    docker push "${REGISTRY}/${SERVICE_NAME}:${ENVIRONMENT}"
    docker push "${REGISTRY}/${SERVICE_NAME}:latest"

    log_info "Image pushed successfully."
}

create_namespace() {
    log_info "Creating namespace if not exists..."

    if kubectl get namespace "${NAMESPACE}" &> /dev/null; then
        log_info "Namespace ${NAMESPACE} already exists."
    else
        kubectl create namespace "${NAMESPACE}"
        kubectl label namespace "${NAMESPACE}" \
            name="${NAMESPACE}" \
            environment="${ENVIRONMENT}"
        log_info "Namespace ${NAMESPACE} created."
    fi
}

create_secrets() {
    log_info "Creating Kubernetes secrets..."

    # Delete existing secrets if they exist
    kubectl delete secret oauth-secrets -n "${NAMESPACE}" --ignore-not-found=true
    kubectl delete secret oauth-providers -n "${NAMESPACE}" --ignore-not-found=true

    # Create main secrets
    kubectl create secret generic oauth-secrets \
        --namespace="${NAMESPACE}" \
        --from-literal=jwt-secret="${JWT_SECRET}" \
        --from-literal=encryption-key="${ENCRYPTION_KEY}" \
        --from-literal=state-secret="${STATE_SECRET}" \
        --from-literal=database-url="${DATABASE_URL}" \
        --from-literal=redis-url="${REDIS_URL}" \
        --from-literal=security-webhook-url="${SECURITY_WEBHOOK_URL:-https://alerts.example.com}"

    # Create provider secrets
    kubectl create secret generic oauth-providers \
        --namespace="${NAMESPACE}" \
        --from-literal=google-client-id="${GOOGLE_CLIENT_ID}" \
        --from-literal=google-client-secret="${GOOGLE_CLIENT_SECRET}" \
        --from-literal=github-client-id="${GITHUB_CLIENT_ID}" \
        --from-literal=github-client-secret="${GITHUB_CLIENT_SECRET}"

    log_info "Secrets created successfully."
}

deploy_service() {
    log_info "Deploying OAuth service..."

    # Update image tag in deployment
    sed -i.bak "s|image: ${REGISTRY}/${SERVICE_NAME}:.*|image: ${REGISTRY}/${SERVICE_NAME}:${VERSION}|g" \
        k8s/oauth/deployment.yaml

    # Apply configurations
    kubectl apply -f k8s/oauth/config.yaml
    kubectl apply -f k8s/oauth/deployment.yaml
    kubectl apply -f k8s/oauth/ingress.yaml

    log_info "Waiting for deployment to be ready..."
    kubectl rollout status deployment/"${SERVICE_NAME}" -n "${NAMESPACE}" --timeout=600s

    log_info "OAuth service deployed successfully."
}

run_health_checks() {
    log_info "Running health checks..."

    # Get a pod name
    POD=$(kubectl get pod -n "${NAMESPACE}" -l app="${SERVICE_NAME}" -o jsonpath='{.items[0].metadata.name}')

    if [ -z "$POD" ]; then
        log_error "No pods found for ${SERVICE_NAME}"
    fi

    # Check health endpoint
    if kubectl exec -n "${NAMESPACE}" "${POD}" -- curl -f http://localhost:3000/health &> /dev/null; then
        log_info "Health check passed."
    else
        log_error "Health check failed."
    fi

    # Check readiness
    if kubectl exec -n "${NAMESPACE}" "${POD}" -- curl -f http://localhost:3000/ready &> /dev/null; then
        log_info "Readiness check passed."
    else
        log_warn "Readiness check failed. Service may still be starting up."
    fi
}

run_security_validation() {
    log_info "Running security validation..."

    # Check if PKCE is enabled
    POD=$(kubectl get pod -n "${NAMESPACE}" -l app="${SERVICE_NAME}" -o jsonpath='{.items[0].metadata.name}')

    # Verify security settings
    kubectl exec -n "${NAMESPACE}" "${POD}" -- printenv | grep -q "PKCE_REQUIRED=true" || \
        log_warn "PKCE may not be enabled"

    kubectl exec -n "${NAMESPACE}" "${POD}" -- printenv | grep -q "ENABLE_DPOP=true" || \
        log_warn "DPoP may not be enabled"

    kubectl exec -n "${NAMESPACE}" "${POD}" -- printenv | grep -q "ENABLE_ANOMALY_DETECTION=true" || \
        log_warn "Anomaly detection may not be enabled"

    log_info "Security validation completed."
}

display_summary() {
    log_info "Deployment Summary:"
    echo "=========================="
    echo "Namespace: ${NAMESPACE}"
    echo "Service: ${SERVICE_NAME}"
    echo "Version: ${VERSION}"
    echo "Environment: ${ENVIRONMENT}"
    echo ""

    # Get service URL
    INGRESS_HOST=$(kubectl get ingress oauth-ingress -n "${NAMESPACE}" \
        -o jsonpath='{.spec.rules[0].host}' 2>/dev/null || echo "Not configured")
    echo "Service URL: https://${INGRESS_HOST}"
    echo ""

    # Get pod status
    kubectl get pods -n "${NAMESPACE}" -l app="${SERVICE_NAME}"
    echo ""

    log_info "Deployment completed successfully!"
}

rollback() {
    log_warn "Rolling back deployment..."
    kubectl rollout undo deployment/"${SERVICE_NAME}" -n "${NAMESPACE}"
    kubectl rollout status deployment/"${SERVICE_NAME}" -n "${NAMESPACE}" --timeout=300s
    log_info "Rollback completed."
}

# Main execution
main() {
    log_info "Starting OAuth service deployment..."

    # Trap errors and rollback
    trap 'rollback' ERR

    check_prerequisites
    validate_secrets
    build_and_push
    create_namespace
    create_secrets
    deploy_service
    run_health_checks
    run_security_validation
    display_summary

    # Remove error trap after successful deployment
    trap - ERR
}

# Run main function
main "$@"