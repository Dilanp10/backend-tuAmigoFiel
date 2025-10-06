// src/services/salesService.js
const { connectMongo, mongoose } = require('./config/mongo');
const { all: sqliteAll, get: sqliteGet, run: sqliteRun, db: sqliteDB } = require('./config/db.js');
const productosService = require('./productosService');
const customersService = require('./customersService');

const USE_SELL_PRICE_AS_COST = (process.env.USE_SELL_PRICE_AS_COST === 'true');

let mongoReady = false;
let SaleModel = null;

const { Schema } = mongoose;

/* ---------- Mongoose Schemas (inline) ---------- */
const SaleItemSchema = new Schema({
  productRef: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  oldProductId: { type: Schema.Types.Mixed, default: null },
  serviceRef: { type: Schema.Types.ObjectId, ref: 'Service', default: null },
  oldServiceId: { type: Schema.Types.Mixed, default: null },

  qty: { type: Number, required: true },
  unit_price: { type: Number, default: 0 },
  unit_cost: { type: Number, default: 0 },
  line_total: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
});

const SaleSchema = new Schema({
  oldId: { type: Schema.Types.Mixed, default: null },
  items: { type: [SaleItemSchema], default: [] },
  customerRef: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  oldCustomerId: { type: Schema.Types.Mixed, default: null },

  total: { type: Number, default: 0 },
  total_items: { type: Number, default: 0 },
  paid_amount: { type: Number, default: 0 },
  outstanding_amount: { type: Number, default: 0 },
  on_credit: { type: Boolean, default: false },
  status: { type: String, default: 'pending' },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

SaleSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret.id || (ret._id ? String(ret._id) : (ret.oldId != null ? String(ret.oldId) : null));
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

/* ---------- init() ---------- */
const init = async () => {
  try {
    await connectMongo();
    mongoReady = true;
    SaleModel = mongoose.models.Sale || mongoose.model('Sale', SaleSchema);

    // índices
    try {
      await SaleModel.collection.createIndex({ oldId: 1 });
      await SaleModel.collection.createIndex({ customerRef: 1 });
      await SaleModel.collection.createIndex({ oldCustomerId: 1 });
      await SaleModel.collection.createIndex({ created_at: -1 });
      console.log('[salesService] índices creados/verificados');
    } catch (err) {
      console.warn('[salesService] fallo creando índices (quizá ya existían):', err.message || err);
    }
  } catch (err) {
    mongoReady = false;
    console.warn('[salesService] init: Mongo no disponible, usando sqlite como fallback:', err.message || err);
  }
};

/* ---------- SQLite helpers (existing logic) ---------- */
async function getTableInfo(table) {
  try {
    const info = await sqliteAll(`PRAGMA table_info(${table})`);
    return Array.isArray(info) ? info : [];
  } catch (err) {
    console.error('[salesService.getTableInfo] Error', err);
    return [];
  }
}

async function tableHasColumn(table, column) {
  const info = await getTableInfo(table);
  return info.some(c => String(c.name) === String(column));
}

async function columnIsNotNull(table, column) {
  const info = await getTableInfo(table);
  const col = info.find(c => String(c.name) === String(column));
  return !!(col && Number(col.notnull) === 1);
}

async function runSafe(sql, params = []) {
  try {
    const res = await sqliteRun(sql, params);
    if (res && (res.lastID != null || res.lastid != null)) {
      return { lastID: res.lastID ?? res.lastid };
    }
    try {
      const row = await sqliteGet('SELECT last_insert_rowid() as id');
      return { lastID: row?.id ?? null };
    } catch (e) {
      return { lastID: null };
    }
  } catch (err) {
    err._origSql = sql;
    err._origParams = params;
    throw err;
  }
}

/* ---------- createSale ---------- */
/**
 * cart: [{ id, qty, precio?, type?: 'product'|'service' }]
 * options: { customerId, onCredit, paidAmount }
 */
const createSale = async (cart = [], options = {}) => {
  if (!Array.isArray(cart) || cart.length === 0) throw new Error('Carrito vacío');

  const {
    customerId = null,
    onCredit = false,
    paidAmount = 0
  } = options;

  const paid = Number(paidAmount) || 0;
  if (onCredit && paid < 0) throw new Error('Monto pagado no puede ser negativo');

  // If mongo available, we'll use its transaction; otherwise operate on sqlite
  // For sqlite we re-use original logic (BEGIN/COMMIT, updates, inserts)
  // First, validate items and compute lines
  const itemsToSave = [];
  let total = 0;
  let totalItems = 0;

  // Validate & prepare lines (uses productosService for product checks; productsService handles mongo/sqlite)
  for (const it of cart) {
    const qty = Number(it.qty || 0);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Cantidad inválida para item id=${it.id}`);

    const type = it.type || 'product';
    let product = null;
    let service = null;

    if (type === 'product') {
      product = await productosService.obtenerProductoPorId(it.id);
      if (!product) throw new Error(`Producto no encontrado (id=${it.id})`);
      const stock = Number(product.stock ?? 0);
      if (stock != null && stock < qty) throw new Error(`Stock insuficiente para ${product.nombre || ('id='+product.id)}`);
    } else if (type === 'service') {
      // you may have a servicesService in the future; for now we keep the id as provided
      // services can be validated later if you implement servicesService
      service = { id: it.id };
    }

    const unitPrice = (it.precio != null) ? Number(it.precio) : (product ? Number(product.precio || 0) : 0);
    if (!Number.isFinite(unitPrice)) throw new Error(`Precio inválido para item id=${it.id}`);

    const unitCost = product && (product.cost != null) ? Number(product.cost) : (USE_SELL_PRICE_AS_COST ? unitPrice : 0);

    const line_total = unitPrice * qty;
    itemsToSave.push({
      type,
      id: it.id,
      product,
      service,
      qty,
      unitPrice,
      unitCost,
      line_total
    });

    total += line_total;
    totalItems += qty;
  }

  const outstanding = onCredit ? Math.max(0, total - paid) : 0;
  const finalPaidAmount = onCredit ? Math.min(paid, total) : total;

  // ---------- MONGO path (transaction) ----------
  if (mongoReady && SaleModel) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const saleDoc = await SaleModel.create([{
        oldId: null,
        items: itemsToSave.map(it => ({
          productRef: (it.product && it.product.id && String(it.product.id).match(/^[0-9a-fA-F]{24}$/)) ? mongoose.Types.ObjectId(String(it.product.id)) : null,
          oldProductId: (it.product && it.product.id && !String(it.product.id).match(/^[0-9a-fA-F]{24}$/)) ? it.product.id : null,
          serviceRef: null,
          oldServiceId: (it.service && it.service.id && !String(it.service.id).match(/^[0-9a-fA-F]{24}$/)) ? it.service.id : null,
          qty: it.qty,
          unit_price: it.unitPrice,
          unit_cost: it.unitCost,
          line_total: it.line_total
        })),
        customerRef: (customerId && mongoose.Types.ObjectId.isValid(String(customerId))) ? mongoose.Types.ObjectId(String(customerId)) : null,
        oldCustomerId: (!customerId || mongoose.Types.ObjectId.isValid(String(customerId))) ? null : customerId,
        total,
        total_items: totalItems,
        paid_amount: finalPaidAmount,
        outstanding_amount: outstanding,
        on_credit: !!onCredit,
        status: outstanding <= 0 ? 'paid' : (finalPaidAmount > 0 ? 'partially_paid' : 'pending')
      }], { session });

      // update product stocks if applicable
      for (const ln of itemsToSave) {
        if (ln.type === 'product' && ln.product && ln.product.id) {
          // if product.id is an old sqlite id -> try productosService.actualizarProducto
          if (!String(ln.product.id).match(/^[0-9a-fA-F]{24}$/)) {
            try {
              const current = await productosService.obtenerProductoPorId(ln.product.id);
              const newStock = current && current.stock != null ? Math.max(0, Number(current.stock) - ln.qty) : null;
              if (newStock != null) {
                await productosService.actualizarProducto(ln.product.id, { stock: newStock });
              }
            } catch (e) { /* ignore */ }
          } else {
            // mongo product id -> update collection directly in session
            try {
              await mongoose.connection.collection('products').updateOne(
                { _id: mongoose.Types.ObjectId(String(ln.product.id)), stock: { $ne: null } },
                { $inc: { stock: -ln.qty } },
                { session }
              );
            } catch (e) { /* ignore */ }
          }
        }
      }

      await session.commitTransaction();
      session.endSession();

      const saved = await SaleModel.findById(saleDoc[0]._id).lean().exec();
      return await normalizeSale(saved);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  // ---------- SQLITE fallback ----------
  try {
    await sqliteRun('BEGIN TRANSACTION');

    // determine which columns exist
    const hasCustomerId = await tableHasColumn('sales', 'customer_id');
    const hasOnCredit = await tableHasColumn('sales', 'on_credit');
    const hasPaidAmount = await tableHasColumn('sales', 'paid_amount');
    const hasOutstandingAmount = await tableHasColumn('sales', 'outstanding_amount');
    const hasServiceId = await tableHasColumn('sale_items', 'service_id');
    const hasUnitCost = await tableHasColumn('sale_items', 'unit_cost');
    const hasCreatedAt = await tableHasColumn('sale_items', 'created_at');
    const productIdExists = await tableHasColumn('sale_items', 'product_id');
    const productIdNotNull = productIdExists ? await columnIsNotNull('sale_items', 'product_id') : false;

    const salesColumns = ['total'];
    const salesPlaceholders = ['?'];
    const salesParams = [total];

    if (hasCustomerId) { salesColumns.push('customer_id'); salesPlaceholders.push('?'); salesParams.push(customerId); }
    if (hasOnCredit) { salesColumns.push('on_credit'); salesPlaceholders.push('?'); salesParams.push(onCredit ? 1 : 0); }
    if (hasPaidAmount) { salesColumns.push('paid_amount'); salesPlaceholders.push('?'); salesParams.push(finalPaidAmount); }
    if (hasOutstandingAmount) { salesColumns.push('outstanding_amount'); salesPlaceholders.push('?'); salesParams.push(outstanding); }

    salesColumns.push('created_at');
    salesPlaceholders.push('CURRENT_TIMESTAMP');

    const salesSql = `INSERT INTO sales (${salesColumns.join(', ')}) VALUES (${salesPlaceholders.join(', ')})`;
    const saleRes = await runSafe(salesSql, salesParams);
    const saleId = saleRes.lastID;
    if (!saleId) throw new Error('No se pudo obtener saleId');

    // insert sale_items
    for (const it of itemsToSave) {
      let unitCost = it.unitCost;

      if (it.type === 'product' && it.product) {
        // update stock if applicable
        try {
          if (it.product.stock != null) {
            const newStock = Math.max(0, Number(it.product.stock) - Number(it.qty));
            await sqliteRun('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStock, it.product.id]);
          }
        } catch (e) { /* ignore */ }
      }

      const columns = ['sale_id'];
      const placeholders = ['?'];
      const params = [saleId];

      if (productIdExists) {
        columns.push('product_id');
        placeholders.push('?');
        if (it.type === 'product') params.push(it.id); else params.push(productIdNotNull ? 0 : null);
      }

      if (hasServiceId) {
        columns.push('service_id');
        placeholders.push('?');
        params.push(it.type === 'service' ? it.id : null);
      }

      columns.push('qty', 'price');
      placeholders.push('?', '?');
      params.push(it.qty, it.unitPrice);

      if (hasUnitCost) {
        columns.push('unit_cost');
        placeholders.push('?');
        params.push(unitCost);
      }

      if (hasCreatedAt) {
        columns.push('created_at');
        placeholders.push('CURRENT_TIMESTAMP');
      }

      const sql = `INSERT INTO sale_items (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
      await runSafe(sql, params);
    }

    await sqliteRun('COMMIT');

    const sale = await getSaleById(saleId);
    return sale;
  } catch (err) {
    try { await sqliteRun('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('[salesService.createSale] Error durante createSale:', err);
    if (err && err._origSql) console.error('[salesService.createSale] Query que falló:', err._origSql, err._origParams);
    throw err;
  }
};

/* ---------- normalizeSale (mongo) ---------- */
const normalizeSale = async (doc) => {
  if (!doc) return null;
  const sale = {
    id: doc.id || (doc._id ? String(doc._id) : (doc.oldId != null ? String(doc.oldId) : null)),
    items: (doc.items || []).map(it => ({
      productRef: it.productRef || null,
      oldProductId: it.oldProductId ?? null,
      serviceRef: it.serviceRef || null,
      oldServiceId: it.oldServiceId ?? null,
      qty: it.qty,
      unit_price: it.unit_price,
      unit_cost: it.unit_cost,
      line_total: it.line_total,
      created_at: it.created_at || it.createdAt || null
    })),
    total: doc.total,
    total_items: doc.total_items,
    paid_amount: doc.paid_amount,
    outstanding_amount: doc.outstanding_amount,
    on_credit: !!doc.on_credit,
    status: doc.status || 'pending',
    created_at: doc.created_at || doc.createdAt || null,
    updated_at: doc.updated_at || doc.updatedAt || null,
    customer: null,
    raw: doc
  };

  // populate customer if possible
  try {
    const cid = doc.oldCustomerId != null ? doc.oldCustomerId : (doc.customerRef ? String(doc.customerRef) : null);
    if (cid) {
      const c = await customersService.getCustomerById(cid);
      sale.customer = c || null;
    }
  } catch (e) { /* ignore */ }

  return sale;
};

/* ---------- listSales ---------- */
const listSales = async ({ from, to, limit = 100, offset = 0, customerId, creditOnly = false } = {}) => {
  if (mongoReady && SaleModel) {
    const match = {};
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) match.created_at = { ...(match.created_at || {}), $gte: fromDate };
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        const toInclusive = new Date(toDate.getTime()); toInclusive.setHours(23, 59, 59, 999);
        match.created_at = { ...(match.created_at || {}), $lte: toInclusive };
      }
    }

    if (customerId) {
      if (typeof customerId === 'string' && mongoose.Types.ObjectId.isValid(customerId)) match.customerRef = mongoose.Types.ObjectId(customerId);
      else if (!isNaN(Number(customerId))) match.oldCustomerId = Number(customerId);
      else match.customerRef = customerId;
    }

    if (creditOnly) match.on_credit = true;

    const docs = await SaleModel.find(match)
      .sort({ created_at: -1 })
      .skip(Number(offset) || 0)
      .limit(Number(limit) || 100)
      .lean()
      .exec();

    const out = [];
    for (const d of docs) {
      out.push(await normalizeSale(d));
    }
    return out;
  }

  // SQLite fallback (original behavior)
  const params = [];
  const where = [];
  if (from) { where.push('DATE(s.created_at) >= DATE(?)'); params.push(from); }
  if (to) { where.push('DATE(s.created_at) <= DATE(?)'); params.push(to); }
  if (customerId) { where.push('s.customer_id = ?'); params.push(customerId); }
  if (creditOnly) { where.push('s.on_credit = 1 AND s.outstanding_amount > 0'); }

  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const sql = `
    SELECT
      s.*,
      c.nombre AS customer_nombre,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items_count
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    ${whereSql}
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), Number(offset));

  const rows = await sqliteAll(sql, params);

  const salesWithItems = await Promise.all(
    rows.map(async (sale) => {
      const items = await sqliteAll(`
        SELECT 
          CASE
            WHEN si.product_id IS NOT NULL AND si.product_id != 0 THEN p.nombre
            WHEN si.service_id IS NOT NULL THEN srv.nombre
            ELSE 'Ítem #' || si.id
          END as item_name
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN services srv ON srv.id = si.service_id
        WHERE si.sale_id = ?
      `, [sale.id]);

      const itemsNames = items.map(item => item.item_name).filter(Boolean);

      return {
        ...sale,
        items_names: itemsNames,
        items_count: Number(sale.items_count || 0),
        total: sale.total != null ? Number(sale.total) : 0,
        paid_amount: sale.paid_amount != null ? Number(sale.paid_amount) : 0,
        outstanding_amount: sale.outstanding_amount != null ? Number(sale.outstanding_amount) : 0,
        on_credit: Boolean(sale.on_credit),
        customer_name: sale.customer_nombre || null
      };
    })
  );

  return salesWithItems;
};

/* ---------- getSaleById ---------- */
const getSaleById = async (id) => {
  if (!id) return null;

  if (mongoReady && SaleModel) {
    if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
      const doc = await SaleModel.findById(id).lean().exec();
      return await normalizeSale(doc);
    }
    if (!isNaN(Number(id))) {
      const doc = await SaleModel.findOne({ oldId: Number(id) }).lean().exec();
      return await normalizeSale(doc);
    }
    const doc = await SaleModel.findOne({ _id: id }).lean().exec();
    return await normalizeSale(doc);
  }

  // SQLite fallback
  try {
    let customerFields = 'c.nombre AS customer_nombre, c.email AS customer_email, c.telefono AS customer_telefono';
    try {
      const tableExists = await sqliteGet("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'");
      if (tableExists) {
        const customerColumns = await sqliteAll(`PRAGMA table_info(customers)`);
        const addressColumn = customerColumns.find(col =>
          col.name.toLowerCase().includes('direccion') ||
          col.name.toLowerCase().includes('address') ||
          col.name.toLowerCase().includes('dir')
        );
        if (addressColumn) {
          customerFields += `, c.${addressColumn.name} AS customer_direccion`;
        }
      }
    } catch (error) {
      // ignore
    }

    const sale = await sqliteGet(`
      SELECT s.*, ${customerFields}
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = ?
    `, [id]);

    if (!sale) return null;

    const items = await sqliteAll(
      `SELECT si.*, p.nombre AS product_nombre, p.precio AS product_precio, p.cost AS product_cost,
              srv.nombre AS service_nombre, srv.precio AS service_precio
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN services srv ON srv.id = si.service_id
       WHERE si.sale_id = ? ORDER BY si.id`,
      [id]
    );

    const normalized = (items || []).map(it => {
      const isProduct = (it.product_id !== null && it.product_id !== undefined && Number(it.product_id) !== 0);
      const isService = !!it.service_id;
      const display_name = isProduct
        ? (it.product_nombre || `Producto #${it.product_id}`)
        : (isService ? (it.service_nombre || `Servicio #${it.service_id}`) : (`Ítem #${it.id}`));
      const item_type = isProduct ? 'product' : (isService ? 'service' : 'unknown');
      const qty = Number(it.qty || 0);
      const price = (it.price != null) ? Number(it.price) : 0;
      const unit_cost = (it.unit_cost != null) ? Number(it.unit_cost) : (it.product_cost != null ? Number(it.product_cost) : 0);
      const subtotal = qty * price;
      return { ...it, display_name, item_type, qty, price, unit_cost, subtotal };
    });

    return {
      ...sale,
      items: normalized,
      total: sale.total != null ? Number(sale.total) : 0,
      paid_amount: sale.paid_amount != null ? Number(sale.paid_amount) : 0,
      outstanding_amount: sale.outstanding_amount != null ? Number(sale.outstanding_amount) : 0,
      on_credit: Boolean(sale.on_credit)
    };
  } catch (err) {
    console.error('[salesService.getSaleById] Error:', err);
    throw err;
  }
};

/* ---------- updateSalePayment ---------- */
const updateSalePayment = async (saleId, paidAmount) => {
  const amt = Number(paidAmount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('amount inválido');

  if (mongoReady && SaleModel) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      let saleDoc = null;
      if (typeof saleId === 'string' && mongoose.Types.ObjectId.isValid(saleId)) {
        saleDoc = await SaleModel.findById(saleId).session(session).exec();
      }
      if (!saleDoc && !isNaN(Number(saleId))) {
        saleDoc = await SaleModel.findOne({ oldId: Number(saleId) }).session(session).exec();
      }
      if (!saleDoc) throw new Error('Venta no encontrada');
      if (!saleDoc.on_credit) throw new Error('Esta venta no es a crédito');

      saleDoc.paid_amount = (saleDoc.paid_amount || 0) + amt;
      saleDoc.outstanding_amount = Math.max(0, (saleDoc.outstanding_amount || saleDoc.total || 0) - amt);

      saleDoc.status = saleDoc.outstanding_amount <= 0 ? 'paid' : 'partially_paid';

      await saleDoc.save({ session });
      await session.commitTransaction();
      session.endSession();
      return { ok: true, sale: await getSaleById(saleDoc._id) };
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  // SQLITE fallback
  try {
    await sqliteRun('BEGIN TRANSACTION');
    const s = await sqliteGet('SELECT total, paid_amount, outstanding_amount, on_credit FROM sales WHERE id = ?', [saleId]);
    if (!s) throw new Error('Venta no encontrada');
    if (!s.on_credit) throw new Error('Esta venta no es a crédito');

    const currentPaid = Number(s.paid_amount) || 0;
    const total = Number(s.total) || 0;
    const newPaid = Math.min(total, currentPaid + amt);
    const newOutstanding = Math.max(0, total - newPaid);

    await sqliteRun('UPDATE sales SET paid_amount = ?, outstanding_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newPaid, newOutstanding, saleId]);
    await sqliteRun('COMMIT');
    return { ok: true, sale: await getSaleById(saleId) };
  } catch (err) {
    try { await sqliteRun('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  }
};

/* ---------- getCustomerOutstanding ---------- */
const getCustomerOutstanding = async (customerId) => {
  if (mongoReady && SaleModel) {
    // try to sum outstanding in mongo
    try {
      const match = {};
      if (typeof customerId === 'string' && mongoose.Types.ObjectId.isValid(customerId)) match.customerRef = mongoose.Types.ObjectId(customerId);
      else if (!isNaN(Number(customerId))) match.oldCustomerId = Number(customerId);
      else match.customerRef = customerId;

      const agg = await SaleModel.aggregate([
        { $match: { ...match, on_credit: true, outstanding_amount: { $gt: 0 } } },
        { $group: { _id: null, total_outstanding: { $sum: '$outstanding_amount' }, pending_sales: { $sum: 1 } } }
      ]).exec();
      const row = agg && agg[0] ? agg[0] : null;
      return {
        total_outstanding: Number(row?.total_outstanding || 0),
        pending_sales: Number(row?.pending_sales || 0)
      };
    } catch (err) {
      console.warn('[salesService.getCustomerOutstanding] mongo agg failed, falling back to sqlite:', err.message || err);
    }
  }

  const result = await sqliteGet(`
    SELECT 
      SUM(outstanding_amount) as total_outstanding,
      COUNT(*) as pending_sales
    FROM sales 
    WHERE customer_id = ? AND on_credit = 1 AND outstanding_amount > 0
  `, [customerId]);

  return {
    total_outstanding: Number(result?.total_outstanding || 0),
    pending_sales: Number(result?.pending_sales || 0)
  };
};

/* ---------- deleteSalesByCustomerId ---------- */
const deleteSalesByCustomerId = async (customerId) => {
  if (mongoReady && SaleModel) {
    try {
      // delete sale_items embedded in sale doc by removing the documents
      const filter = {};
      if (typeof customerId === 'string' && mongoose.Types.ObjectId.isValid(customerId)) filter.customerRef = mongoose.Types.ObjectId(customerId);
      else if (!isNaN(Number(customerId))) filter.oldCustomerId = Number(customerId);
      else filter.customerRef = customerId;

      const res = await SaleModel.deleteMany(filter).exec();
      return res.deletedCount;
    } catch (err) {
      console.warn('[salesService.deleteSalesByCustomerId] mongo delete failed, falling back to sqlite:', err.message || err);
    }
  }

  try {
    await sqliteRun('BEGIN TRANSACTION');
    await sqliteRun(
      `DELETE FROM sale_items
       WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = ?)`,
      [customerId]
    );
    const result = await sqliteRun('DELETE FROM sales WHERE customer_id = ?', [customerId]);
    await sqliteRun('COMMIT');
    return result.changes;
  } catch (err) {
    try { await sqliteRun('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('[salesService.deleteSalesByCustomerId] Error:', err);
    throw new Error('Error al borrar ventas del cliente');
  }
};

module.exports = {
  init,
  createSale,
  listSales,
  getSaleById,
  updateSalePayment,
  getCustomerOutstanding,
  deleteSalesByCustomerId
};