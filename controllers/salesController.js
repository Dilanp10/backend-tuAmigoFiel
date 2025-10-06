// src/controllers/salesController.js
const salesService = require('../services/salesService');

/**
 * Listar ventas
 * GET /api/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=&offset=&customerId=&creditOnly=true
 */
async function listarVentas(req, res) {
  try {
    const { from, to } = req.query;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
    const customerId = req.query.customerId || null;
    const creditOnly = req.query.creditOnly === 'true' || req.query.creditOnly === '1';

    const ventas = await salesService.listSales({
      from,
      to,
      limit,
      offset,
      customerId,
      creditOnly
    });

    return res.json(ventas);
  } catch (error) {
    console.error('[salesController.listarVentas] Error al listar ventas:', error);
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
}

/**
 * Crear venta
 * POST /api/sales
 * Body: { cart: [{id, qty, precio?, type?}], customerId?, onCredit?, paidAmount? }
 */
async function crearVenta(req, res) {
  try {
    const body = req.body || {};
    const cart = body.cart;
    const customerId = (body.customerId !== undefined) ? body.customerId : null;
    const onCredit = !!body.onCredit;
    const paidAmount = body.paidAmount != null ? Number(body.paidAmount) : 0;

    // Validaciones simples
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ message: 'Carrito vacío' });
    }
    if (isNaN(paidAmount) || Number(paidAmount) < 0) {
      return res.status(400).json({ message: 'paidAmount inválido' });
    }

    const venta = await salesService.createSale(cart, {
      customerId,
      onCredit,
      paidAmount
    });

    return res.status(201).json(venta);
  } catch (error) {
    console.error('[salesController.crearVenta] Error al crear venta:', error);
    const msg = error?.message || 'Error al crear venta';

    // errores predecibles de validación -> 400
    if (/Carrito vacío|Cantidad inválida|Stock insuficiente|Producto no encontrado|Venta no encontrada/i.test(msg)) {
      return res.status(400).json({ message: msg });
    }

    // fallback 500
    return res.status(500).json({ message: msg });
  }
}

/**
 * Detalle venta
 * GET /api/sales/:id
 */
async function detalleVenta(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'ID es requerido' });

    const venta = await salesService.getSaleById(id);
    if (!venta) return res.status(404).json({ message: 'Venta no encontrada' });

    return res.json(venta);
  } catch (error) {
    console.error('[salesController.detalleVenta] Error al obtener venta:', error);
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
}

/**
 * Exportar con los nombres EXACTOS que usan las rutas
 */
module.exports = {
  listarVentas,
  crearVenta,
  detalleVenta
};