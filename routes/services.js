// src/routes/services.js
const express = require('express');
const { 
  listar, 
  crear, 
  detalle, 
  actualizar,  // ← Agregar esta función
  eliminar     // ← Y esta si también quieres eliminar
} = require('../controllers/servicesController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', listar);
router.post('/', authMiddleware, crear);
router.get('/:id', detalle);
router.put('/:id', authMiddleware, actualizar); // ← Agregar esta línea
router.delete('/:id', authMiddleware, eliminar); // ← Opcional: para eliminar

module.exports = router;