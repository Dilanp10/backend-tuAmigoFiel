// src/services/reportsService.js
const { connectMongo, mongoose } = require('../config/mongo');

let mongoReady = false;

/**
 * init(): conectar a Mongo (usa process.env.MONGO_URI desde config/mongo.js)
 */
const init = async () => {
  console.log('[DEBUG] reportsService.init() llamado');
  try {
    await connectMongo();
    mongoReady = true;
    console.log('[reportsService] Mongo disponible para reports');
  } catch (err) {
    mongoReady = false;
    console.warn('[reportsService] Mongo no disponible:', err.message || err);
    throw err; // preferible fallar temprano si querés operar solo con Mongo
  }
};

/**
 * Helpers
 */
const ensureMongoReady = async () => {
  if (!mongoReady) {
    console.log('🔄 Auto-inicializando reportsService...');
    await init();
  }
};

/**
 * salesByMonth(fromDate, toDate)
 * fromDate/toDate: strings parseables por Date (ej. '2024-01-01')
 */
const salesByMonth = async (fromDate, toDate) => {
  await ensureMongoReady();

  // Validar fechas
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Fechas inválidas');
  }
  const toInclusive = new Date(to.getTime());
  toInclusive.setHours(23, 59, 59, 999);

  try {
    const salesColl = mongoose.connection.collection('sales');
    const pipeline = [
      { $match: { created_at: { $gte: from, $lte: toInclusive } } },

      // traer items relacionados (tolerante a distintos nombres)
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

      { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },

      // calcular precio unitario y qty
      {
        $addFields: {
          __unitPrice: { $ifNull: ['$items.unit_price', '$items.price'] },
          __qty: { $ifNull: ['$items.qty', 0] }
        }
      },

      // agrupar por mes YYYY-MM
      {
        $group: {
          _id: { month: { $dateToString: { format: '%Y-%m', date: '$created_at' } } },
          ordersSet: { $addToSet: '$_id' },
          total_sales: { $sum: { $multiply: ['$__qty', { $ifNull: ['$__unitPrice', 0] }] } },
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

    const agg = await salesColl.aggregate(pipeline).toArray();
    return (agg || []).map(r => ({
      month: r.month,
      orders: Number(r.orders || 0),
      total_sales: r.total_sales != null ? Number(r.total_sales) : 0,
      total_items: r.total_items != null ? Number(r.total_items) : 0
    }));
  } catch (err) {
    console.error('[reportsService.salesByMonth] Error en agregación:', err);
    throw err;
  }
};

/**
 * profitByMonth(fromDate, toDate)
 */
const profitByMonth = async (fromDate, toDate) => {
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

    const pipeline = [
      { $match: { created_at: { $gte: from, $lte: toInclusive } } },

      // lookup sale_items
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
            { $project: { productRef: 1, product_id: 1, qty: 1, unit_price: 1, price: 1 } }
          ],
          as: 'items'
        }
      },

      { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },

      // lookup products to get cost (tolerant match)
      {
        $lookup: {
          from: 'products',
          let: { prodRef: '$items.productRef', oldPid: '$items.product_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $and: [{ $ne: ['$$prodRef', null] }, { $eq: ['$_id', '$$prodRef'] }] },
                    { $and: [{ $ne: ['oldId', null] }, { $eq: ['$oldId', '$$oldPid'] }] },
                    { $and: [{ $ne: ['oldId', null] }, { $eq: ['$oldId', { $toInt: '$$oldPid' }] }] }
                  ]
                }
              }
            },
            { $project: { cost: 1, unit_cost: 1 } }
          ],
          as: 'product'
        }
      },

      // flatten product cost + unit price + qty
      {
        $addFields: {
          __unitPrice: { $ifNull: ['$items.unit_price', '$items.price'] },
          __qty: { $ifNull: ['$items.qty', 0] },
          __productCost: {
            $let: {
              vars: { p: { $arrayElemAt: ['$product', 0] } },
              in: { $ifNull: ['$$p.cost', '$$p.unit_cost', 0] }
            }
          }
        }
      },

      // group by month
      {
        $group: {
          _id: { month: { $dateToString: { format: '%Y-%m', date: '$created_at' } } },
          revenue: { $sum: { $multiply: ['$__qty', { $ifNull: ['$__unitPrice', 0] }] } },
          cogs: { $sum: { $multiply: ['$__qty', { $ifNull: ['$__productCost', 0] }] } }
        }
      },

      {
        $project: {
          month: '$_id.month',
          revenue: 1,
          cogs: 1,
          profit: { $subtract: ['$revenue', '$cogs'] }
        }
      },

      { $sort: { month: 1 } }
    ];

    const agg = await salesColl.aggregate(pipeline).toArray();
    return (agg || []).map(r => ({
      month: r.month,
      revenue: r.revenue != null ? Number(r.revenue) : 0,
      cogs: r.cogs != null ? Number(r.cogs) : 0,
      profit: r.profit != null ? Number(r.profit) : 0
    }));
  } catch (err) {
    console.error('[reportsService.profitByMonth] Error en agregación:', err);
    throw err;
  }
};

module.exports = { init, salesByMonth, profitByMonth };