const express = require('express');
const HealthController = require('../controllers/healthController');

const router = express.Router();

// Basic health check
router.get('/', HealthController.checkHealth);

// Readiness probe (for Kubernetes/container orchestration)
router.get('/ready', HealthController.checkReadiness);

// Liveness probe (for Kubernetes/container orchestration)
router.get('/live', HealthController.checkLiveness);

// WebSocket health check
router.get('/websocket', HealthController.checkWebSocket);

module.exports = router;