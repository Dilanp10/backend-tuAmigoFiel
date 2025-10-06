// src/routes/alerts.js
const express = require('express');
const { listar, resolver } = require('../controllers/alertsController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, listar);         // GET /api/alerts
router.put('/:id/resolve', authMiddleware, resolver); // PUT /api/alerts/:id/resolve

module.exports = router;