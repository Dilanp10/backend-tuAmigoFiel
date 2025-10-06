// src/services/reportsService.js
const { all: sqliteAll } = require('../config/db.js');
const { connectMongo, mongoose } = require('../config/mongo');

let mongoReady = false;

/**
 * init(): conectar a Mongo (si MONGO_URI presente)
 */
const init = async () => {
  try {
    await connectMongo();
    mongoReady = true;
    console.log('[reportsService] Mongo disponible para reports');
  } catch (err) {
    mongoReady = false;
    console.warn('[reportsService] Mongo no disponible — usando sqlite como fallback:', err.message || err);
  }
};

/* ---------- Helper SQL (original, robust) ---------- */
const getTableColumns = async (table) => {
  try {
    const rows = await sqliteAll(`PRAGMA table_info(${table})`);
    return (rows || []).map(r => r.name);
  } catch (err) {
    console.error(`[reportsService] Error getTableColumns(${table}):`, err.message || err);
    return [];
  }
};

const resolveColumnNamesSQLite = async () => {
  const siCols = await getTableColumns('sale_items');
  const pCols = await getTableColumns('products');
  const unitPriceField = siCols.includes('unit_price') ? 'unit_price' : (siCols.includes('price') ? 'price' : null);
  const costField = pCols.includes('cost') ? 'cost' : (pCols.includes('unit_cost') ? 'unit_cost' : null);
  return { unitPriceField, costField };
};

/* ---------- Mongo implementations ---------- */

/**
 * salesByMonth(fromDate, toDate)
 * fromDate/toDate: strings parseables por Date (ej. '2024-01-01')
 */
const salesByMonth = async (fromDate, toDate) => {
  // Validate dates
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Fechas inválidas');
  }
  // include full day for `to`
  const toInclusive = new Date(to.getTime());
  toInclusive.setHours(23, 59, 59, 999);

  // Mongo path
  if (mongoReady) {
    try {
      const salesColl = mongoose.connection.collection('sales');
      const pipeline = [
        {
          $match: {
            created_at: { $gte: from, $lte: toInclusive }
          }
        },
        // Lookup sale_items that belong to this sale (many possible field names)
        {
          $lookup: {
            from: 'sale_items',
            let: { saleId: '$_id', oldId: '$oldId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      // saleRef (ObjectId) equals sale _id
                      { $and: [{ $ne: ['$saleRef', null] }, { $eq: ['$saleRef', '$$saleId'] }] },
                      // oldSaleId equals oldId
                      { $and: [{ $ne: ['$oldSaleId', null] }, { $eq: ['$oldSaleId', '$$oldId'] }] },
                      // numeric sale_id equals oldId
                      { $and: [{ $ne: ['$sale_id', null] }, { $eq: ['$sale_id', '$$oldId'] }] },
                      // fallback: sale_id equals stringified saleId
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
        // compute unitPrice and qty
        {
          $addFields: {
            __unitPrice: { $ifNull: ['$items.unit_price', '$items.price'] },
            __qty: { $ifNull: ['$items.qty', 0] }
          }
        },
        // group by month (YYYY-MM)
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
      console.warn('[reportsService.salesByMonth] Aggregation mongo falló, fallback a sqlite:', err.message || err);
      // fallthrough to sqlite version
    }
  }

  // SQLite fallback (original robust query)
  try {
    const { unitPriceField } = await resolveColumnNamesSQLite();
    if (!unitPriceField) {
      console.warn('[reportsService.salesByMonth] sale_items no tiene unit_price ni price. Devolviendo []');
      return [];
    }
    const sql = `
      SELECT
        strftime('%Y-%m', s.created_at) AS month,
        COUNT(DISTINCT s.id) AS orders,
        SUM(si.qty * si.${unitPriceField}) AS total_sales,
        SUM(si.qty) AS total_items
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      WHERE date(s.created_at) BETWEEN date(?) AND date(?)
      GROUP BY month
      ORDER BY month;
    `;
    const rows = await sqliteAll(sql, [fromDate, toDate]);
    return (rows || []).map(r => ({
      month: r.month,
      orders: Number(r.orders || 0),
      total_sales: r.total_sales != null ? Number(r.total_sales) : 0,
      total_items: r.total_items != null ? Number(r.total_items) : 0,
    }));
  } catch (err) {
    console.error('[reportsService.salesByMonth] Error fallback sqlite:', err.message || err);
    return [];
  }
};

/**
 * profitByMonth(fromDate, toDate)
 */
const profitByMonth = async (fromDate, toDate) => {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Fechas inválidas');
  }
  const toInclusive = new Date(to.getTime());
  toInclusive.setHours(23, 59, 59, 999);

  // Mongo path
  if (mongoReady) {
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
        // Lookup product to get cost (tolerant match)
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
                      { $and: [{ $ne: ['$_id', null] }, { $eq: ['$_id', '$$prodRef'] }] },
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
        // flatten product cost
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
        profit: r.profit != null ? Number(r.profit) : 0,
      }));
    } catch (err) {
      console.warn('[reportsService.profitByMonth] Aggregation mongo falló, fallback a sqlite:', err.message || err);
      // fallthrough to sqlite
    }
  }

  // SQLite fallback
  try {
    const { unitPriceField, costField } = await resolveColumnNamesSQLite();
    if (!unitPriceField) {
      console.warn('[reportsService.profitByMonth] sale_items no tiene unit_price ni price. Devolviendo []');
      return [];
    }
    const costExpr = costField ? `COALESCE(p.${costField}, 0)` : `0`;
    const sql = `
      SELECT
        strftime('%Y-%m', s.created_at) AS month,
        SUM(si.qty * si.${unitPriceField}) AS revenue,
        SUM(si.qty * ${costExpr}) AS cogs,
        SUM(si.qty * si.${unitPriceField}) - SUM(si.qty * ${costExpr}) AS profit
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE date(s.created_at) BETWEEN date(?) AND date(?)
      GROUP BY month
      ORDER BY month;
    `;
    const rows = await sqliteAll(sql, [fromDate, toDate]);
    return (rows || []).map(r => ({
      month: r.month,
      revenue: r.revenue != null ? Number(r.revenue) : 0,
      cogs: r.cogs != null ? Number(r.cogs) : 0,
      profit: r.profit != null ? Number(r.profit) : 0,
    }));
  } catch (err) {
    console.error('[reportsService.profitByMonth] Error fallback sqlite:', err.message || err);
    return [];
  }
};

module.exports = { init, salesByMonth, profitByMonth };