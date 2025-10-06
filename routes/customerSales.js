const express = require('express');
const { deleteSalesByCustomerId } = require('../services/salesService');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// DELETE /api/customers/:id/sales - Borrar TODAS las ventas de un cliente
router.delete('/:id/sales', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'ID de cliente inválido' });
    }
    
    const customerId = parseInt(id);
    const deletedCount = await deleteSalesByCustomerId(customerId);
    
    res.json({ 
      message: `Historial de ${deletedCount} ventas borrado exitosamente`,
      deletedCount 
    });
  } catch (error) {
    console.error('Error borrando ventas del cliente:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

module.exports = router;