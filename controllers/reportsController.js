// controllers/reportsController.js
const reportsService = require('../services/reportsService');

const getDefaultRange = () => {
  const now = new Date();
  const to = now.toISOString().slice(0,10);
  const past = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const from = past.toISOString().slice(0,10);
  return { from, to };
};

const salesByMonth = async (req, res) => {
  try {
    let { from, to } = req.query;
    if (!from || !to) {
      const def = getDefaultRange();
      from = from || def.from;
      to = to || def.to;
    }
    const data = await reportsService.salesByMonth(from, to);
    return res.json({ from, to, data });
  } catch (err) {
    console.error('[reportsController.salesByMonth]', err);
    return res.status(500).json({ message: 'Error generando reporte de ventas por mes' });
  }
};

const profitByMonth = async (req, res) => {
  try {
    let { from, to } = req.query;
    if (!from || !to) {
      const def = getDefaultRange();
      from = from || def.from;
      to = to || def.to;
    }
    const data = await reportsService.profitByMonth(from, to);
    return res.json({ from, to, data });
  } catch (err) {
    console.error('[reportsController.profitByMonth]', err);
    return res.status(500).json({ message: 'Error generando reporte de ganancias por mes' });
  }
};

module.exports = { salesByMonth, profitByMonth };