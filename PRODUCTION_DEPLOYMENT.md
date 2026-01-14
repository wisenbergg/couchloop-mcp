# Production Deployment Guide

## 🚀 OAuth Service Production Deployment

This guide covers deploying the production-ready OAuth service with complete security implementation.

## Prerequisites

- Kubernetes cluster (1.24+)
- kubectl configured
- Helm 3.x
- Docker registry access
- SSL certificates (or cert-manager)
- PostgreSQL database
- Redis cache

## 📋 Pre-Deployment Checklist

### Security Requirements

- [ ] Generate cryptographic secrets (64-character hex strings)
  ```bash
  openssl rand -hex 32  # For JWT_SECRET
  openssl rand -hex 32  # For ENCRYPTION_KEY
  openssl rand -hex 32  # For STATE_SECRET
  ```

- [ ] Configure OAuth providers
  - Google OAuth credentials
  - GitHub OAuth credentials
  - Redirect URIs configured

- [ ] Database setup
  ```sql
  CREATE DATABASE couchloop_oauth;
  CREATE USER oauth_service WITH ENCRYPTED PASSWORD 'strong_password';
  GRANT ALL PRIVILEGES ON DATABASE couchloop_oauth TO oauth_service;
  ```

- [ ] Redis configuration
  ```bash
  redis-cli CONFIG SET requirepass "strong_redis_password"
  redis-cli CONFIG SET maxmemory 2gb
  redis-cli CONFIG SET maxmemory-policy allkeys-lru
  ```

### Infrastructure Requirements

- [ ] Load balancer configured
- [ ] DNS records created (auth.couchloop.com)
- [ ] SSL certificates provisioned
- [ ] Monitoring stack deployed (Prometheus/Grafana)
- [ ] Log aggregation configured (ELK/Fluentd)

## 🏗️ Deployment Steps

### 1. Build and Push Docker Image

```bash
# Build the OAuth service image
docker build -f Dockerfile.oauth -t couchloop/oauth-service:v1.0.0 .

# Tag for production
docker tag couchloop/oauth-service:v1.0.0 couchloop/oauth-service:latest
docker tag couchloop/oauth-service:v1.0.0 couchloop/oauth-service:production

# Push to registry
docker push couchloop/oauth-service:v1.0.0
docker push couchloop/oauth-service:latest
docker push couchloop/oauth-service:production
```

### 2. Create Kubernetes Namespace

```bash
kubectl create namespace couchloop
kubectl label namespace couchloop name=couchloop
kubectl label namespace couchloop environment=production
```

### 3. Configure Secrets

```bash
# Create secrets from environment variables
kubectl create secret generic oauth-secrets \
  --namespace=couchloop \
  --from-literal=jwt-secret="${JWT_SECRET}" \
  --from-literal=encryption-key="${ENCRYPTION_KEY}" \
  --from-literal=state-secret="${STATE_SECRET}" \
  --from-literal=database-url="${DATABASE_URL}" \
  --from-literal=redis-url="${REDIS_URL}" \
  --from-literal=security-webhook-url="${SECURITY_WEBHOOK_URL}"

kubectl create secret generic oauth-providers \
  --namespace=couchloop \
  --from-literal=google-client-id="${GOOGLE_CLIENT_ID}" \
  --from-literal=google-client-secret="${GOOGLE_CLIENT_SECRET}" \
  --from-literal=github-client-id="${GITHUB_CLIENT_ID}" \
  --from-literal=github-client-secret="${GITHUB_CLIENT_SECRET}"
```

### 4. Apply Configuration

```bash
# Apply ConfigMap
kubectl apply -f k8s/oauth/config.yaml

# Apply Deployment and Services
kubectl apply -f k8s/oauth/deployment.yaml

# Apply Ingress
kubectl apply -f k8s/oauth/ingress.yaml
```

### 5. Verify Deployment

```bash
# Check pod status
kubectl get pods -n couchloop -l app=oauth-service

# Check service endpoints
kubectl get endpoints -n couchloop oauth-service

# Check ingress
kubectl get ingress -n couchloop oauth-ingress

# Check logs
kubectl logs -n couchloop -l app=oauth-service --tail=100

# Test health endpoint
curl https://auth.couchloop.com/health
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NODE_ENV` | Environment mode | Yes | production |
| `JWT_SECRET` | JWT signing secret (64 chars) | Yes | - |
| `ENCRYPTION_KEY` | Token encryption key (64 chars) | Yes | - |
| `STATE_SECRET` | State token secret (64 chars) | Yes | - |
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | - |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes | - |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | Yes | - |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | Yes | - |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret | Yes | - |

### Security Settings

| Setting | Production Value | Description |
|---------|-----------------|-------------|
| `PKCE_REQUIRED` | true | Enforce PKCE for all flows |
| `ENABLE_DPOP` | true | Enable DPoP token binding |
| `ENABLE_ANOMALY_DETECTION` | true | Enable anomaly detection |
| `REFRESH_TOKEN_ROTATION` | true | Rotate refresh tokens |
| `GDPR_ENABLED` | true | Enable GDPR compliance |
| `ACCESS_TOKEN_TTL` | 900 | 15 minutes |
| `REFRESH_TOKEN_TTL` | 2592000 | 30 days |

## 📊 Monitoring

### Prometheus Metrics

The service exposes metrics at `http://oauth-service:9090/metrics`:

```yaml
# ServiceMonitor for Prometheus Operator
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: oauth-service
  namespace: couchloop
spec:
  selector:
    matchLabels:
      app: oauth-service
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
```

### Key Metrics to Monitor

- `oauth_login_success_total` - Successful logins
- `oauth_login_failure_total` - Failed login attempts
- `oauth_token_issued_total` - Tokens issued
- `oauth_token_revoked_total` - Tokens revoked
- `oauth_anomaly_detected_total` - Anomalies detected
- `oauth_request_duration_seconds` - Request latency

### Alerting Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: oauth-alerts
  namespace: couchloop
spec:
  groups:
  - name: oauth.rules
    rules:
    - alert: HighFailureRate
      expr: rate(oauth_login_failure_total[5m]) > 0.1
      annotations:
        summary: High login failure rate detected

    - alert: TokenTheftDetected
      expr: increase(oauth_token_theft_total[1h]) > 0
      annotations:
        summary: Potential token theft detected

    - alert: AnomalySpike
      expr: rate(oauth_anomaly_detected_total[5m]) > 0.05
      annotations:
        summary: Spike in anomalies detected
```

## 🔒 Security Hardening

### 1. Network Policies

```bash
kubectl apply -f k8s/oauth/ingress.yaml  # Includes NetworkPolicy
```

### 2. Pod Security Policy

```yaml
apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
  name: oauth-restricted
spec:
  privileged: false
  allowPrivilegeEscalation: false
  requiredDropCapabilities:
    - ALL
  volumes:
    - configMap
    - emptyDir
    - secret
  runAsUser:
    rule: MustRunAsNonRoot
  seLinux:
    rule: RunAsAny
  fsGroup:
    rule: RunAsAny
```

### 3. RBAC Configuration

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: oauth-service-role
  namespace: couchloop
rules:
- apiGroups: [""]
  resources: ["configmaps"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get"]
```

## 🔄 Rolling Updates

### Zero-Downtime Deployment

```bash
# Update image
kubectl set image deployment/oauth-service \
  oauth-service=couchloop/oauth-service:v1.1.0 \
  -n couchloop

# Monitor rollout
kubectl rollout status deployment/oauth-service -n couchloop

# Rollback if needed
kubectl rollout undo deployment/oauth-service -n couchloop
```

### Blue-Green Deployment

```bash
# Deploy green version
kubectl apply -f k8s/oauth/deployment-green.yaml

# Switch traffic
kubectl patch service oauth-service -n couchloop \
  -p '{"spec":{"selector":{"version":"green"}}}'

# Remove blue version
kubectl delete deployment oauth-service-blue -n couchloop
```

## 🚨 Incident Response

### Token Compromise

1. Revoke all affected tokens:
   ```bash
   kubectl exec -n couchloop oauth-service-xxx -- \
     node scripts/revoke-tokens.js --user-id=USER_ID
   ```

2. Force re-authentication:
   ```bash
   kubectl exec -n couchloop oauth-service-xxx -- \
     node scripts/force-reauth.js --user-id=USER_ID
   ```

### Data Breach Response

1. Enable breach mode:
   ```bash
   kubectl set env deployment/oauth-service \
     BREACH_MODE=true -n couchloop
   ```

2. Generate audit report:
   ```bash
   kubectl exec -n couchloop oauth-service-xxx -- \
     node scripts/breach-audit.js --start-date=2024-01-01
   ```

## 📈 Scaling

### Horizontal Pod Autoscaling

The HPA is configured to scale between 3-10 replicas based on CPU/memory:

```bash
# Check HPA status
kubectl get hpa oauth-service-hpa -n couchloop

# Manual scaling
kubectl scale deployment oauth-service --replicas=5 -n couchloop
```

### Vertical Pod Autoscaling

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: oauth-service-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: oauth-service
  updatePolicy:
    updateMode: "Auto"
```

## 🔧 Troubleshooting

### Common Issues

1. **Database Connection Issues**
   ```bash
   kubectl exec -n couchloop oauth-service-xxx -- \
     psql $DATABASE_URL -c "SELECT 1"
   ```

2. **Redis Connection Issues**
   ```bash
   kubectl exec -n couchloop oauth-service-xxx -- \
     redis-cli -u $REDIS_URL ping
   ```

3. **Certificate Issues**
   ```bash
   kubectl describe certificate oauth-tls-cert -n couchloop
   ```

4. **Memory Issues**
   ```bash
   kubectl top pods -n couchloop -l app=oauth-service
   ```

### Debug Mode

Enable debug logging:
```bash
kubectl set env deployment/oauth-service \
  LOG_LEVEL=debug -n couchloop
```

## 📝 Maintenance

### Database Migrations

```bash
kubectl create job --from=cronjob/oauth-migration oauth-migration-manual -n couchloop
```

### Backup and Restore

```bash
# Backup
kubectl exec -n couchloop postgres-0 -- \
  pg_dump -U oauth_service couchloop_oauth > backup.sql

# Restore
kubectl exec -i -n couchloop postgres-0 -- \
  psql -U oauth_service couchloop_oauth < backup.sql
```

### Certificate Renewal

Using cert-manager:
```bash
kubectl delete certificate oauth-tls-cert -n couchloop
kubectl apply -f k8s/oauth/certificate.yaml
```

## 📚 Additional Resources

- [OAuth 2.1 Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-07)
- [Kubernetes Security Best Practices](https://kubernetes.io/docs/concepts/security/)
- [GDPR Compliance Guide](https://gdpr.eu/)
- [OWASP OAuth Security](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)

## 🆘 Support

For production issues:
- Slack: #oauth-service-alerts
- Email: security@couchloop.com
- On-call: PagerDuty escalation

## 📅 Maintenance Schedule

- **Security patches**: Applied immediately
- **Feature updates**: Tuesday 2-4 AM UTC
- **Database maintenance**: Sunday 3-5 AM UTC
- **Certificate renewal**: 30 days before expiry