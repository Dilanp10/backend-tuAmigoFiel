// src/controllers/alertsController.js
const alertsService = require('../services/alertsService');

const listar = async (req, res) => {
  try {
    const { all } = req.query;
    const rows = await alertsService.listAlerts({ onlyUnresolved: !(all === 'true') });
    return res.json(rows);
  } catch (err) {
    console.error('[alertsController.listar]', err);
    return res.status(500).json({ message: 'Error al listar alertas' });
  }
};

const resolver = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await alertsService.resolveAlert(id);
    return res.json(updated);
  } catch (err) {
    console.error('[alertsController.resolver]', err);
    return res.status(500).json({ message: 'Error al resolver alerta' });
  }
};

module.exports = { listar, resolver };