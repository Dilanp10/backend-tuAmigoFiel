// src/routes/payments.js
const express = require('express');
const { crear, listar } = require('../controllers/paymentsController');
const { authMiddleware } = require('../middleware/auth'); // opcional: proteger con auth

const router = express.Router();

// listar pagos (puedes filtrar por saleId o customerId)
router.get('/', authMiddleware, listar);

// crear pago (body: { saleId, customerId?, amount, note? })
router.post('/', authMiddleware, crear);

module.exports = router;