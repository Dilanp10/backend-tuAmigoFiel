// routes/sales.js
const express = require('express');
const router = express.Router();

// Importa el controlador correctamente desde la raíz
const salesController = require('../controllers/salesController');

// Verifica que las funciones existan
console.log('listarVentas:', typeof salesController.listarVentas);
console.log('crearVenta:', typeof salesController.crearVenta);
console.log('detalleVenta:', typeof salesController.detalleVenta);

// Usa las funciones del controlador
router.get('/', salesController.listarVentas);
router.post('/', salesController.crearVenta);
router.get('/:id', salesController.detalleVenta);

module.exports = router;