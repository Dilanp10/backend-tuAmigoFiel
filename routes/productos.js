// src/routes/productos.js
const express = require('express');
const { listar, crear, actualizar, eliminar } = require('../controllers/productosController');
const productoService = require('../services/productosService');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Nueva ruta: Productos más vendidos
router.get('/top', async (req, res) => {
  try {
    const limit = req.query.limit || 12;
    const rows = await productoService.topProductos(limit);
    res.json(rows);
  } catch (err) {
    console.error('[products/top]', err);
    res.status(500).json({ message: 'Error al obtener productos destacados' });
  }
});

// Nueva ruta: Búsqueda avanzada
router.get('/search', async (req, res) => {
  try {
    const { q, categoria, limit, offset } = req.query;
    const rows = await productoService.searchProductos({ 
      q, 
      categoria, 
      limit: limit || 50, 
      offset: offset || 0 
    });
    res.json(rows);
  } catch (err) {
    console.error('[products/search]', err);
    res.status(500).json({ message: 'Error en la búsqueda' });
  }
});

// Rutas existentes
router.get('/', listar);
router.post('/', authMiddleware, crear);
router.put('/:id', authMiddleware, actualizar);
router.delete('/:id', authMiddleware, eliminar);

module.exports = router;