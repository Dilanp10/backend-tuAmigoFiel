// src/services/paymentsService.js
const { connectMongo, mongoose } = require('../config/mongo');
const { all: sqliteAll, get: sqliteGet, run: sqliteRun } = require('../config/db.js');
const salesService = require('./salesService'); // tu service existente (puede ser sqlite o mongo)
const customersService = require('./customersService'); // convertido previamente (acepta id mongo o oldId)

/* ---------- Helpers (sqlite) ---------- */
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

/* ---------- Ensure payments table (sqlite) ---------- */
const ensurePaymentsTable = async () => {
  try {
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        customer_id INTEGER,
        amount REAL NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) {
    console.warn('[paymentsService.ensurePaymentsTable] create payments table failed', e.message || e);
  }
};
ensurePaymentsTable().catch(err => console.error('[paymentsService.ensurePaymentsTable] ', err));

/* ---------- Mongoose schema/model inline ---------- */
const { Schema } = mongoose;
const PaymentSchema = new Schema({
  // referencias Mongo o conservación de ids viejos
  saleRef: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
  oldSaleId: { type: Schema.Types.Mixed, default: null },

  customerRef: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  oldCustomerId: { type: Schema.Types.Mixed, default: null },

  amount: { type: Number, required: true },
  note: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
});

// toJSON friendly
PaymentSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

let PaymentModel = null;
let mongoReady = false;

const init = async () => {
  await connectMongo();
  mongoReady = true;
  PaymentModel = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);

  // índices para consultas comunes
  try {
    await PaymentModel.collection.createIndex({ saleRef: 1 });
    await PaymentModel.collection.createIndex({ oldSaleId: 1 });
    await PaymentModel.collection.createIndex({ customerRef: 1 });
    await PaymentModel.collection.createIndex({ oldCustomerId: 1 });
    await PaymentModel.collection.createIndex({ created_at: -1 });
    console.log('[paymentsService] índices creados/verificados');
  } catch (err) {
    console.warn('[paymentsService] fallo creando índices (quizá ya existían):', err.message || err);
  }
};

/* ---------- Helpers ---------- */
const normalize = (doc) => {
  if (!doc) return null;
  return {
    id: doc.id || (doc._id ? String(doc._id) : null),
    saleRef: doc.saleRef || null,
    oldSaleId: doc.oldSaleId ?? null,
    customerRef: doc.customerRef || null,
    oldCustomerId: doc.oldCustomerId ?? null,
    amount: typeof doc.amount === 'number' ? doc.amount : Number(doc.amount || 0),
    note: doc.note || null,
    created_at: doc.created_at || doc.createdAt || null,
  };
};

/* ---------- API: createPayment ---------- */
/**
 * createPayment({ saleId, customerId = null, amount, note = null })
 * - Valida que la venta exista via salesService.getSaleById
 * - Requiere venta a credito (según tu lógica original)
 * - Llama salesService.updateSalePayment(saleId, amt)
 * - Inserta registro en payments (Mongo o SQLite según disponibilidad)
 * - Devuelve { payment, sale, updated }
 */
const createPayment = async ({ saleId, customerId = null, amount, note = null } = {}) => {
  if (!saleId) throw new Error('saleId requerido');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('amount inválido');

  // Verificar que la venta exista
  const sale = await salesService.getSaleById(saleId);
  if (!sale) throw new Error('Venta no encontrada');

  // Solo permitir pagos para ventas a crédito
  if (!sale.on_credit) throw new Error('Esta venta no es a crédito');

  // Actualizar montos en la venta (salesService.updateSalePayment puede manejar sqlite o mongo)
  const updated = await salesService.updateSalePayment(saleId, amt);

  // Insertar payment en Mongo si está listo
  if (mongoReady && PaymentModel) {
    // determinar referencias: si sale proviene de Mongo (tiene _id) usamos sale._id como saleRef,
    // si proviene de sqlite o nos pasaron id numérico, guardamos en oldSaleId.
    let saleRef = null;
    let oldSaleId = null;
    if (sale && (sale._id || (sale.id && String(sale.id).match(/^[0-9a-fA-F]{24}$/)))) {
      saleRef = sale._id ? String(sale._id) : (sale.id ? String(sale.id) : null);
    } else {
      oldSaleId = typeof sale.id !== 'undefined' ? sale.id : saleId;
    }

    // customer: si viene mongo id o numeric
    let customerRef = null;
    let oldCustomerId = null;
    if (customerId) {
      if (typeof customerId === 'string' && mongoose.Types.ObjectId.isValid(customerId)) customerRef = customerId;
      else if (!isNaN(Number(customerId))) oldCustomerId = Number(customerId);
      else customerRef = customerId;
    } else if (sale && sale.customer_id) {
      // tomar de la venta si existe
      if (typeof sale.customer_id === 'string' && mongoose.Types.ObjectId.isValid(String(sale.customer_id))) customerRef = String(sale.customer_id);
      else if (!isNaN(Number(sale.customer_id))) oldCustomerId = Number(sale.customer_id);
    }

    const doc = await PaymentModel.create({
      saleRef: saleRef ? mongoose.Types.ObjectId(saleRef) : null,
      oldSaleId: oldSaleId != null ? oldSaleId : null,
      customerRef: customerRef ? mongoose.Types.ObjectId(customerRef) : null,
      oldCustomerId: oldCustomerId != null ? oldCustomerId : null,
      amount: amt,
      note: note || null,
    });

    const payment = normalize(doc.toJSON ? doc.toJSON() : doc);
    // obtener estado actualizado de la venta y devolverlo (salesService.getSaleById puede leer sqlite o mongo)
    const saleAfter = await salesService.getSaleById(saleId);
    return { payment, sale: saleAfter, updated };
  }

  // --- fallback sqlite insertion (original behavior) ---
  const params = [saleId, customerId ?? sale.customer_id ?? null, amt, note];
  const insertSql = `INSERT INTO payments (sale_id, customer_id, amount, note, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`;
  const res = await runSafe(insertSql, params);
  const paymentId = res.lastID;
  const payment = await getPaymentById(paymentId);
  const saleAfter = await salesService.getSaleById(saleId);
  return { payment, sale: saleAfter, updated };
};

/* ---------- API: getPaymentById ---------- */
const getPaymentById = async (id) => {
  if (!id) return null;

  // Mongo path
  if (mongoReady && PaymentModel) {
    // id could be mongo _id or numeric old id
    if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
      const doc = await PaymentModel.findById(id).lean().exec();
      if (!doc) return null;
      const p = normalize(doc);
      // intentar añadir customer nombre (si customersService disponible)
      let customer_nombre = null;
      if (p.oldCustomerId != null) {
        const c = await customersService.getCustomerById(p.oldCustomerId);
        customer_nombre = c?.nombre ?? null;
      } else if (p.customerRef) {
        const c = await customersService.getCustomerById(p.customerRef);
        customer_nombre = c?.nombre ?? null;
      }
      return { ...p, customer_nombre };
    }

    // if numeric id, try to find by oldId by querying sqlite payments -> we didn't store old payment id in mongo,
    // so attempt to find the payment by old id in sqlite as fallback (common during migration).
    if (!isNaN(Number(id))) {
      // try sqlite
      const row = await sqliteGet('SELECT p.*, c.nombre AS customer_nombre FROM payments p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?', [id]);
      if (row) {
        row.amount = row.amount != null ? Number(row.amount) : 0;
        return row;
      }
      // else also try mongo fields oldSaleId/oldCustomerId match
      const doc = await PaymentModel.findOne({ oldPaymentId: Number(id) }).lean().exec();
      if (doc) {
        const p = normalize(doc);
        const c = await customersService.getCustomerById(p.oldCustomerId ?? p.customerRef);
        return { ...p, customer_nombre: c?.nombre ?? null };
      }
    }

    // fallback: try findOne by oldSaleId or other heuristics
    const doc = await PaymentModel.findOne({ _id: id }).lean().exec();
    if (!doc) return null;
    const p = normalize(doc);
    const c = await customersService.getCustomerById(p.oldCustomerId ?? p.customerRef);
    return { ...p, customer_nombre: c?.nombre ?? null };
  }

  // sqlite path (original)
  const row = await sqliteGet('SELECT p.*, c.nombre AS customer_nombre FROM payments p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?', [id]);
  return row || null;
};

/* ---------- API: listPayments ---------- */
/**
 * listPayments({ saleId = null, customerId = null, limit = 200, offset = 0 })
 * - Para mongo: busco pagos y luego completo con sale y customer usando salesService / customersService
 * - Para sqlite: mantengo query con joins original
 */
const listPayments = async ({ saleId = null, customerId = null, limit = 200, offset = 0 } = {}) => {
  // Mongo path
  if (mongoReady && PaymentModel) {
    const filter = {};
    if (saleId) {
      if (typeof saleId === 'string' && mongoose.Types.ObjectId.isValid(saleId)) filter.saleRef = mongoose.Types.ObjectId(saleId);
      else if (!isNaN(Number(saleId))) filter.oldSaleId = Number(saleId);
      else filter.saleRef = saleId;
    }
    if (customerId) {
      if (typeof customerId === 'string' && mongoose.Types.ObjectId.isValid(customerId)) filter.customerRef = mongoose.Types.ObjectId(customerId);
      else if (!isNaN(Number(customerId))) filter.oldCustomerId = Number(customerId);
      else filter.customerRef = customerId;
    }

    const docs = await PaymentModel.find(filter)
      .sort({ created_at: -1 })
      .skip(Number(offset) || 0)
      .limit(Number(limit) || 200)
      .lean()
      .exec();

    const out = [];
    for (const d of docs) {
      const p = normalize(d);
      // buscar sale y customer info via services (fallback safe)
      const saleObj = await salesService.getSaleById(p.oldSaleId != null ? p.oldSaleId : (p.saleRef || p.saleRef === null ? p.saleRef : null));
      const custObj = await customersService.getCustomerById(p.oldCustomerId != null ? p.oldCustomerId : (p.customerRef || p.customerRef === null ? p.customerRef : null));
      out.push({
        ...p,
        sale_total: saleObj?.total ?? null,
        sale_on_credit: saleObj?.on_credit ?? null,
        customer_nombre: custObj?.nombre ?? null,
      });
    }
    return out.map(r => ({ ...r, amount: r.amount != null ? Number(r.amount) : 0 }));
  }

  // sqlite path (original)
  const where = [];
  const params = [];
  if (saleId) { where.push('p.sale_id = ?'); params.push(saleId); }
  if (customerId) { where.push('p.customer_id = ?'); params.push(customerId); }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const sql = `
    SELECT p.*, s.total AS sale_total, s.on_credit AS sale_on_credit, c.nombre AS customer_nombre
    FROM payments p
    LEFT JOIN sales s ON s.id = p.sale_id
    LEFT JOIN customers c ON c.id = p.customer_id
    ${whereSql}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), Number(offset));
  const rows = await sqliteAll(sql, params);
  return rows.map(r => ({
    ...r,
    amount: r.amount != null ? Number(r.amount) : 0
  }));
};

module.exports = {
  init,
  createPayment,
  listPayments,
  getPaymentById,
};