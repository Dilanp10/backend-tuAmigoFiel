// src/controllers/paymentsController.js
const paymentsService = require('../services/paymentsService');

const crear = async (req, res) => {
  try {
    const { saleId, customerId, amount, note } = req.body || {};
    if (!saleId || amount == null) return res.status(400).json({ message: 'saleId y amount son requeridos' });

    const result = await paymentsService.createPayment({ saleId, customerId, amount, note });
    return res.status(201).json(result);
  } catch (err) {
    console.error('[paymentsController.crear]', err);
    const msg = err?.message || 'Error al crear pago';
    // errores de validación conocidos devolver 400
    if (/no encontrada|no es a crédito|inválid/i.test(msg)) {
      return res.status(400).json({ message: msg });
    }
    return res.status(500).json({ message: msg });
  }
};

const listar = async (req, res) => {
  try {
    const { saleId, customerId, limit, offset } = req.query;
    const rows = await paymentsService.listPayments({ saleId, customerId, limit: limit || 200, offset: offset || 0 });
    res.json(rows);
  } catch (err) {
    console.error('[paymentsController.listar]', err);
    res.status(500).json({ message: 'Error al listar pagos' });
  }
};

module.exports = { crear, listar };