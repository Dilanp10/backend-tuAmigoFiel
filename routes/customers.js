// src/routes/customers.js
const express = require('express');
const { listar, detalle, crear, actualizar, eliminar } = require('../controllers/customersController');
const { authMiddleware } = require('../middleware/auth');


const router = express.Router();

router.get('/', listar);
router.post('/', authMiddleware, crear);
router.get('/:id', detalle);
router.put('/:id', authMiddleware, actualizar);
router.delete('/:id', authMiddleware, eliminar);

module.exports = router;