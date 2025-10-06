// routes/reports.js
const express = require('express');
const { salesByMonth, profitByMonth } = require('../controllers/reportsController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/sales-by-month', authMiddleware, salesByMonth);
router.get('/profit-by-month', authMiddleware, profitByMonth);

module.exports = router;