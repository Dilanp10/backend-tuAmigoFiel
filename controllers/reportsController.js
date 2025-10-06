// controllers/reportsController.js
const reportsService = require('../services/reportsService');

// Inicializar el servicio
reportsService.init().catch(err => {
  console.error('Failed to initialize reports service:', err);
});

const getDefaultRange = () => {
  const now = new Date();
  const to = now.toISOString().slice(0,10);
  const past = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const from = past.toISOString().slice(0,10);
  return { from, to };
};

const salesByMonth = async (req, res) => {
  try {
    console.log('📊 [CONTROLLER] GET /sales-by-month llamado');
    
    let { from, to } = req.query;
    if (!from || !to) {
      const def = getDefaultRange();
      from = from || def.from;
      to = to || def.to;
      console.log('📅 [CONTROLLER] Usando rango por defecto:', { from, to });
    } else {
      console.log('📅 [CONTROLLER] Parámetros recibidos:', { from, to });
    }

    console.log('🔄 [CONTROLLER] Llamando a reportsService.salesByMonth...');
    const data = await reportsService.salesByMonth(from, to);
    
    console.log('✅ [CONTROLLER] Reporte de ventas generado:', {
      rango: { from, to },
      meses: data.length,
      datos: data
    });
    
    return res.json({ 
      success: true,
      from, 
      to, 
      data 
    });
  } catch (err) {
    console.error('❌ [CONTROLLER] Error en salesByMonth:', err);
    return res.status(500).json({ 
      success: false,
      message: 'Error generando reporte de ventas por mes',
      error: err.message 
    });
  }
};

const profitByMonth = async (req, res) => {
  try {
    console.log('💰 [CONTROLLER] GET /profit-by-month llamado');
    
    let { from, to } = req.query;
    if (!from || !to) {
      const def = getDefaultRange();
      from = from || def.from;
      to = to || def.to;
      console.log('📅 [CONTROLLER] Usando rango por defecto:', { from, to });
    } else {
      console.log('📅 [CONTROLLER] Parámetros recibidos:', { from, to });
    }

    console.log('🔄 [CONTROLLER] Llamando a reportsService.profitByMonth...');
    const data = await reportsService.profitByMonth(from, to);
    
    console.log('✅ [CONTROLLER] Reporte de profit generado:', {
      rango: { from, to },
      meses: data.length,
      datos: data
    });
    
    return res.json({ 
      success: true,
      from, 
      to, 
      data 
    });
  } catch (err) {
    console.error('❌ [CONTROLLER] Error en profitByMonth:', err);
    return res.status(500).json({ 
      success: false,
      message: 'Error generando reporte de ganancias por mes',
      error: err.message 
    });
  }
};

module.exports = { 
  salesByMonth, 
  profitByMonth 
};