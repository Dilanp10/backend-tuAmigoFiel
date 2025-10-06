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

// Función para debug de colecciones
const debugCollections = async () => {
  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log('[DEBUG] Colecciones disponibles:', collections.map(c => c.name));
    
    // Contar documentos en cada colección relevante
    const salesCount = await db.collection('sales').countDocuments();
    const saleItemsCount = await db.collection('sale_items').countDocuments();
    const productsCount = await db.collection('products').countDocuments();
    
    console.log(`[DEBUG] Conteo: sales=${salesCount}, sale_items=${saleItemsCount}, products=${productsCount}`);
    
    return { salesCount, saleItemsCount, productsCount };
  } catch (err) {
    console.error('[DEBUG] Error en debugCollections:', err);
    return null;
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
    // Debug de colecciones primero
    await debugCollections();
    
    const salesColl = mongoose.connection.collection('sales');
    
    // Verificar si hay ventas en el rango
    const salesInRange = await salesColl.find({
      created_at: { $gte: from, $lte: toInclusive }
    }).count();
    
    console.log(`[SALES] Ventas en rango: ${salesInRange}`);
    
    if (salesInRange === 0) {
      console.log('[SALES] No hay ventas en el rango especificado');
      return [];
    }

    const pipeline = [
      { 
        $match: { 
          created_at: { $gte: from, $lte: toInclusive } 
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
      { 
        $unwind: { 
          path: '$items', 
          preserveNullAndEmptyArrays: true 
        } 
      },
      {
        $addFields: {
          __unitPrice: { $ifNull: ['$items.unit_price', '$items.price', 0] },
          __qty: { $ifNull: ['$items.qty', 0] }
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
    
    // Verificar si hay ventas en el rango
    const salesInRange = await salesColl.find({
      created_at: { $gte: from, $lte: toInclusive }
    }).count();
    
    console.log(`[PROFIT] Ventas en rango: ${salesInRange}`);
    
    if (salesInRange === 0) {
      console.log('[PROFIT] No hay ventas en el rango especificado');
      return [];
    }

    const pipeline = [
      { 
        $match: { 
          created_at: { $gte: from, $lte: toInclusive } 
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
            { 
              $project: { 
                productRef: 1, 
                product_id: 1, 
                qty: 1, 
                unit_price: 1, 
                price: 1 
              } 
            }
          ],
          as: 'items'
        }
      },
      { 
        $unwind: { 
          path: '$items', 
          preserveNullAndEmptyArrays: true 
        } 
      },
      {
        $lookup: {
          from: 'products',
          let: { 
            prodRef: '$items.productRef', 
            oldPid: '$items.product_id' 
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $and: [{ $ne: ['$$prodRef', null] }, { $eq: ['$_id', '$$prodRef'] }] },
                    { $and: [{ $ne: ['$oldId', null] }, { $eq: ['$oldId', '$$oldPid'] }] },
                    { $and: [{ $ne: ['$oldId', null] }, { $eq: ['$oldId', { $toInt: '$$oldPid' }] }] },
                    { $and: [{ $ne: ['$oldId', null] }, { $eq: ['$oldId', '$$oldPid'] }] }
                  ]
                }
              }
            },
            { 
              $project: { 
                cost: 1, 
                unit_cost: 1,
                name: 1
              } 
            }
          ],
          as: 'product'
        }
      },
      {
        $addFields: {
          __unitPrice: { $ifNull: ['$items.unit_price', '$items.price', 0] },
          __qty: { $ifNull: ['$items.qty', 0] },
          __productCost: {
            $cond: {
              if: { $gt: [{ $size: '$product' }, 0] },
              then: {
                $let: {
                  vars: { p: { $arrayElemAt: ['$product', 0] } },
                  in: { $ifNull: ['$$p.unit_cost', '$$p.cost', 0] }
                }
              },
              else: 0
            }
          },
          __debug: {
            hasProduct: { $gt: [{ $size: '$product' }, 0] },
            productName: {
              $cond: {
                if: { $gt: [{ $size: '$product' }, 0] },
                then: { $arrayElemAt: ['$product.name', 0] },
                else: 'No product'
              }
            }
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
          revenue: { 
            $sum: { 
              $multiply: ['$__qty', '$__unitPrice'] 
            } 
          },
          cogs: { 
            $sum: { 
              $multiply: ['$__qty', '$__productCost'] 
            } 
          },
          debug_matched_products: { 
            $sum: { 
              $cond: [{ $gt: [{ $size: '$product' }, 0] }, 1, 0] 
            } 
          },
          debug_total_items: { $sum: '$__qty' }
        }
      },
      {
        $project: {
          month: '$_id.month',
          revenue: 1,
          cogs: 1,
          profit: { $subtract: ['$revenue', '$cogs'] },
          debug_matched_products: 1,
          debug_total_items: 1
        }
      },
      { $sort: { month: 1 } }
    ];

    console.log('[PROFIT] Ejecutando pipeline...');
    const agg = await salesColl.aggregate(pipeline).toArray();
    console.log(`[PROFIT] Pipeline completado. Resultados: ${agg.length} meses`);
    
    // Debug detallado de los resultados
    agg.forEach((r, i) => {
      console.log(`[PROFIT] Mes ${i + 1}:`, {
        month: r.month,
        revenue: r.revenue,
        cogs: r.cogs,
        profit: r.profit,
        debug: {
          matched_products: r.debug_matched_products,
          total_items: r.debug_total_items
        }
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
  debugCollections 
};