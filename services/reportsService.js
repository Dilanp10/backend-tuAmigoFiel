// src/services/reportsService.js
const { connectMongo, mongoose } = require('../config/mongo');

let mongoReady = false;

const init = async () => {
  console.log('[DEBUG] reportsService.init() llamado');
  try {
    await connectMongo();
    mongoReady = true;
    console.log('[reportsService] Mongo disponible para reports');
  } catch (err) {
    mongoReady = false;
    console.warn('[reportsService] Mongo no disponible:', err.message || err);
    throw err;
  }
};

const ensureMongoReady = async () => {
  if (!mongoReady) {
    console.log('🔄 Auto-inicializando reportsService...');
    await init();
  }
};

// DEBUG: Función para verificar datos en la base de datos
const debugDataCheck = async (from, to) => {
  try {
    const salesColl = mongoose.connection.collection('sales');
    const saleItemsColl = mongoose.connection.collection('sale_items');
    
    // Contar documentos en cada colección
    const salesCount = await salesColl.countDocuments();
    const saleItemsCount = await saleItemsColl.countDocuments();
    
    console.log(`[DEBUG] Total ventas: ${salesCount}, Total items: ${saleItemsCount}`);
    
    // Verificar ventas en el rango de fechas
    const salesInRange = await salesColl.find({
      created_at: { $gte: from, $lte: to }
    }).count();
    
    console.log(`[DEBUG] Ventas en rango ${from} a ${to}: ${salesInRange}`);
    
    // Verificar estructura de algunos documentos
    if (salesInRange > 0) {
      const sampleSale = await salesColl.findOne({
        created_at: { $gte: from, $lte: to }
      });
      console.log('[DEBUG] Ejemplo de venta:', JSON.stringify(sampleSale, null, 2));
    }
    
    return { salesCount, saleItemsCount, salesInRange };
  } catch (err) {
    console.error('[DEBUG] Error en verificación de datos:', err);
    throw err;
  }
};

const salesByMonth = async (fromDate, toDate) => {
  console.log(`[DEBUG] salesByMonth llamado con: ${fromDate} a ${toDate}`);
  
  await ensureMongoReady();

  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    console.error('[DEBUG] Fechas inválidas:', fromDate, toDate);
    throw new Error('Fechas inválidas');
  }
  
  const toInclusive = new Date(to.getTime());
  toInclusive.setHours(23, 59, 59, 999);

  console.log(`[DEBUG] Fechas procesadas: ${from} a ${toInclusive}`);

  try {
    // DEBUG: Verificar datos primero
    await debugDataCheck(from, toInclusive);
    
    const salesColl = mongoose.connection.collection('sales');
    
    console.log('[DEBUG] Ejecutando pipeline de agregación...');
    
    const pipeline = [
      { 
        $match: { 
          created_at: { $gte: from, $lte: toInclusive } 
        } 
      },

      // DEBUG: Verificar documentos que pasan el match
      {
        $addFields: {
          __debug_match: true
        }
      },

      {
        $lookup: {
          from: 'sale_items',
          let: { saleId: '$_id', oldId: '$oldId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $and: [{ $ne: ['$saleRef', null] }, { $eq: ['$saleRef', '$$saleId'] }] },
                    { $and: [{ $ne: ['$oldSaleId', null] }, { $eq: ['$oldSaleId', '$$oldId'] }] },
                    { $and: [{ $ne: ['$sale_id', null] }, { $eq: ['$sale_id', '$$oldId'] }] },
                    { $and: [{ $ne: ['$sale_id', null] }, { $eq: ['$sale_id', { $toString: '$$saleId' }] }] }
                  ]
                }
              }
            },
            { $project: { qty: 1, unit_price: 1, price: 1 } }
          ],
          as: 'items'
        }
      },

      // DEBUG: Verificar resultados del lookup
      {
        $addFields: {
          __debug_items_count: { $size: '$items' },
          __debug_has_items: { $gt: [{ $size: '$items' }, 0] }
        }
      },

      { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },

      {
        $addFields: {
          __unitPrice: { $ifNull: ['$items.unit_price', '$items.price'] },
          __qty: { $ifNull: ['$items.qty', 0] },
          __debug_unitPrice: { $ifNull: ['$items.unit_price', '$items.price'] },
          __debug_qty: { $ifNull: ['$items.qty', 0] }
        }
      },

      // DEBUG: Etapa para ver datos antes de agrupar
      {
        $addFields: {
          __debug_lineTotal: { $multiply: ['$__qty', { $ifNull: ['$__unitPrice', 0] }] }
        }
      },

      {
        $group: {
          _id: { month: { $dateToString: { format: '%Y-%m', date: '$created_at' } } },
          ordersSet: { $addToSet: '$_id' },
          total_sales: { $sum: { $multiply: ['$__qty', { $ifNull: ['$__unitPrice', 0] }] } },
          total_items: { $sum: '$__qty' },
          // DEBUG: Métricas adicionales
          __debug_docCount: { $sum: 1 },
          __debug_avgLineTotal: { $avg: '$__debug_lineTotal' }
        }
      },

      {
        $project: {
          month: '$_id.month',
          orders: { $size: '$ordersSet' },
          total_sales: 1,
          total_items: 1,
          // DEBUG: Incluir métricas de debug
          __debug_docCount: 1,
          __debug_avgLineTotal: 1
        }
      },

      { $sort: { month: 1 } }
    ];

    const agg = await salesColl.aggregate(pipeline).toArray();
    
    console.log(`[DEBUG] Resultados de agregación: ${agg.length} meses`);
    console.log('[DEBUG] Resultados detallados:', JSON.stringify(agg, null, 2));
    
    const result = (agg || []).map(r => ({
      month: r.month,
      orders: Number(r.orders || 0),
      total_sales: r.total_sales != null ? Number(r.total_sales) : 0,
      total_items: r.total_items != null ? Number(r.total_items) : 0
    }));
    
    console.log('[DEBUG] Resultado final:', JSON.stringify(result, null, 2));
    
    return result;
  } catch (err) {
    console.error('[reportsService.salesByMonth] Error en agregación:', err);
    throw err;
  }
};

// profitByMonth function would get similar debug additions...

module.exports = { 
  init, 
  salesByMonth, 
  profitByMonth,
  // Exportar para testing
  debugDataCheck
};