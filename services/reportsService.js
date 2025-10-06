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

// Funciones de debug
const debugSalesStructure = async () => {
  try {
    const salesColl = mongoose.connection.collection('sales');
    const sampleSales = await salesColl.find().limit(2).toArray();
    
    console.log('🔍 [DEBUG] Estructura de ventas:');
    sampleSales.forEach((sale, index) => {
      console.log(`Venta ${index + 1}:`, JSON.stringify({
        _id: sale._id,
        oldId: sale.oldId,
        created_at: sale.created_at,
        items: sale.items,
        sale_items: sale.sale_items,
        total: sale.total,
        amount: sale.amount,
        // Campos adicionales que puedan existir
        ...Object.keys(sale).reduce((acc, key) => {
          if (key.includes('item') || key.includes('total') || key.includes('price') || key.includes('amount')) {
            acc[key] = sale[key];
          }
          return acc;
        }, {})
      }, null, 2));
    });
    
    return sampleSales;
  } catch (err) {
    console.error('[DEBUG] Error en debugSalesStructure:', err);
  }
};

const debugCollectionNames = async () => {
  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    console.log('[DEBUG] Todas las colecciones:', collectionNames);
    
    // Buscar colecciones que puedan contener items de venta
    const possibleItemCollections = collectionNames.filter(name => 
      name.includes('item') || name.includes('line') || name.includes('detail') || name.includes('sale')
    );
    console.log('[DEBUG] Posibles colecciones de items:', possibleItemCollections);
    
    // Verificar si estas colecciones tienen datos
    for (const collName of possibleItemCollections) {
      const count = await db.collection(collName).countDocuments();
      console.log(`[DEBUG] Colección ${collName}: ${count} documentos`);
      if (count > 0) {
        const sample = await db.collection(collName).findOne();
        console.log(`[DEBUG] Muestra de ${collName}:`, JSON.stringify(sample, null, 2));
      }
    }
    
    return possibleItemCollections;
  } catch (err) {
    console.error('[DEBUG] Error en debugCollectionNames:', err);
    return [];
  }
};

const salesByMonth = async (fromDate, toDate) => {
  console.log(`[SALES] Iniciando con fechas: ${fromDate} a ${toDate}`);
  await ensureMongoReady();

  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Fechas inválidas');
  }
  
  const toInclusive = new Date(to.getTime());
  toInclusive.setHours(23, 59, 59, 999);

  try {
    // Debug primero
    const sampleSales = await debugSalesStructure();
    await debugCollectionNames();
    
    const salesColl = mongoose.connection.collection('sales');
    const salesInRange = await salesColl.find({
      created_at: { $gte: from, $lte: toInclusive }
    }).count();
    
    console.log(`[SALES] Ventas en rango: ${salesInRange}`);
    
    if (salesInRange === 0) {
      return [];
    }

    // Verificar si hay items embebidos
    const hasEmbeddedItems = sampleSales && sampleSales.some(sale => 
      sale.items || sale.sale_items || sale.line_items
    );

    let pipeline;

    if (hasEmbeddedItems) {
      console.log('[SALES] Usando items embebidos en ventas');
      // Pipeline para items embebidos
      pipeline = [
        { $match: { created_at: { $gte: from, $lte: toInclusive } } },
        { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            __unitPrice: { 
              $ifNull: [
                '$items.unit_price', 
                '$items.price', 
                '$items.unitPrice',
                '$items.precio',
                0
              ] 
            },
            __qty: { 
              $ifNull: [
                '$items.qty', 
                '$items.quantity', 
                '$items.cantidad',
                1
              ] 
            }
          }
        },
        {
          $group: {
            _id: { 
              month: { 
                $dateToString: { 
                  format: '%Y-%m', 
                  date: '$created_at' 
                } 
              } 
            },
            ordersSet: { $addToSet: '$_id' },
            total_sales: { 
              $sum: { 
                $multiply: ['$__qty', '$__unitPrice'] 
              } 
            },
            total_items: { $sum: '$__qty' }
          }
        },
        {
          $project: {
            month: '$_id.month',
            orders: { $size: '$ordersSet' },
            total_sales: 1,
            total_items: 1
          }
        },
        { $sort: { month: 1 } }
      ];
    } else {
      console.log('[SALES] Usando ventas sin items embebidos - calculando desde total');
      // Pipeline simple basado en el total de la venta
      pipeline = [
        { $match: { created_at: { $gte: from, $lte: toInclusive } } },
        {
          $group: {
            _id: { 
              month: { 
                $dateToString: { 
                  format: '%Y-%m', 
                  date: '$created_at' 
                } 
              } 
            },
            ordersSet: { $addToSet: '$_id' },
            total_sales: { 
              $sum: { 
                $ifNull: [
                  '$total',
                  '$amount',
                  '$total_amount',
                  '$monto',
                  0
                ]
              } 
            },
            total_items: { $sum: { $ifNull: ['$total_items', '$items_count', 1] } }
          }
        },
        {
          $project: {
            month: '$_id.month',
            orders: { $size: '$ordersSet' },
            total_sales: 1,
            total_items: 1
          }
        },
        { $sort: { month: 1 } }
      ];
    }

    console.log('[SALES] Ejecutando pipeline...');
    const agg = await salesColl.aggregate(pipeline).toArray();
    console.log(`[SALES] Pipeline completado. Resultados: ${agg.length} meses`);
    
    const result = (agg || []).map(r => ({
      month: r.month,
      orders: Number(r.orders || 0),
      total_sales: r.total_sales != null ? Number(r.total_sales) : 0,
      total_items: r.total_items != null ? Number(r.total_items) : 0
    }));
    
    console.log('[SALES] Resultado final:', JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error('[SALES] Error en agregación:', err);
    throw err;
  }
};

const profitByMonth = async (fromDate, toDate) => {
  console.log(`[PROFIT] Iniciando con fechas: ${fromDate} a ${toDate}`);
  await ensureMongoReady();

  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Fechas inválidas');
  }
  
  const toInclusive = new Date(to.getTime());
  toInclusive.setHours(23, 59, 59, 999);

  try {
    const salesColl = mongoose.connection.collection('sales');
    const salesInRange = await salesColl.find({
      created_at: { $gte: from, $lte: toInclusive }
    }).count();
    
    console.log(`[PROFIT] Ventas en rango: ${salesInRange}`);
    
    if (salesInRange === 0) {
      return [];
    }

    // Por ahora, usamos un cálculo simplificado
    // Profit = 80% del revenue (asumiendo 20% de costo)
    const pipeline = [
      { $match: { created_at: { $gte: from, $lte: toInclusive } } },
      {
        $group: {
          _id: { 
            month: { 
              $dateToString: { 
                format: '%Y-%m', 
                date: '$created_at' 
              } 
            } 
          },
          revenue: { 
            $sum: { 
              $ifNull: [
                '$total',
                '$amount', 
                '$total_amount',
                '$monto',
                0
              ]
            } 
          },
          orderCount: { $sum: 1 }
        }
      },
      {
        $project: {
          month: '$_id.month',
          revenue: 1,
          // Estimación: COGS = 20% del revenue, Profit = 80% del revenue
          cogs: { $multiply: ['$revenue', 0.2] },
          profit: { $multiply: ['$revenue', 0.8] }
        }
      },
      { $sort: { month: 1 } }
    ];

    console.log('[PROFIT] Ejecutando pipeline simplificado...');
    const agg = await salesColl.aggregate(pipeline).toArray();
    console.log(`[PROFIT] Pipeline completado. Resultados: ${agg.length} meses`);
    
    // Debug detallado
    agg.forEach((r, i) => {
      console.log(`[PROFIT] Mes ${i + 1}:`, {
        month: r.month,
        revenue: r.revenue,
        cogs: r.cogs,
        profit: r.profit
      });
    });
    
    const result = (agg || []).map(r => ({
      month: r.month,
      revenue: r.revenue != null ? Number(r.revenue) : 0,
      cogs: r.cogs != null ? Number(r.cogs) : 0,
      profit: r.profit != null ? Number(r.profit) : 0
    }));
    
    console.log('[PROFIT] Resultado final:', JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error('[PROFIT] Error en agregación:', err);
    throw err;
  }
};

module.exports = { 
  init, 
  salesByMonth, 
  profitByMonth,
  debugSalesStructure,
  debugCollectionNames
};