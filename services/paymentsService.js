// src/services/paymentsService.js
const { connectMongo, mongoose } = require('../config/mongo');
const salesService = require('./salesService');
const customersService = require('./customersService');

let PaymentModel = null;
let mongoReady = false;
const { Schema } = mongoose;

/* ---------- Schema ---------- */
// Incluyo campos para conservar referencias antiguas (oldSaleId, oldCustomerId)
// y también oldPaymentId por si migrás ids numéricos desde sqlite.
const PaymentSchema = new Schema({
  saleRef: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
  oldSaleId: { type: Schema.Types.Mixed, default: null },

  customerRef: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  oldCustomerId: { type: Schema.Types.Mixed, default: null },

  oldPaymentId: { type: Schema.Types.Mixed, default: null }, // opcional para migraciones

  amount: { type: Number, required: true },
  note: { type: String, default: null },
  created_at: { type: Date, default: Date.now }
}, {
  versionKey: false
});

PaymentSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret.id || (ret._id ? String(ret._id) : null);
    delete ret._id;
    return ret;
  }
});

/* ---------- init ---------- */
const init = async () => {
  await connectMongo();
  mongoReady = true;
  PaymentModel = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);

  try {
    await PaymentModel.collection.createIndex({ saleRef: 1 });
    await PaymentModel.collection.createIndex({ oldSaleId: 1 });
    await PaymentModel.collection.createIndex({ customerRef: 1 });
    await PaymentModel.collection.createIndex({ oldCustomerId: 1 });
    await PaymentModel.collection.createIndex({ oldPaymentId: 1 });
    await PaymentModel.collection.createIndex({ created_at: -1 });
    console.log('[paymentsService] índices creados/verificados');
  } catch (err) {
    console.warn('[paymentsService] fallo creando índices (quizá ya existían):', err.message || err);
  }
};

/* ---------- Helpers ---------- */
const isObjectId = v => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);

const normalize = (doc) => {
  if (!doc) return null;
  return {
    id: doc.id || (doc._id ? String(doc._id) : null),
    saleRef: doc.saleRef || null,
    oldSaleId: doc.oldSaleId ?? null,
    customerRef: doc.customerRef || null,
    oldCustomerId: doc.oldCustomerId ?? null,
    oldPaymentId: doc.oldPaymentId ?? null,
    amount: typeof doc.amount === 'number' ? doc.amount : Number(doc.amount || 0),
    note: doc.note || null,
    created_at: doc.created_at || doc.createdAt || null
  };
};

/* ---------- createPayment ---------- */
/**
 * createPayment({ saleId, customerId = null, amount, note = null, oldPaymentId = null })
 * - Valida venta vía salesService.getSaleById
 * - Valida que la venta sea a crédito
 * - Actualiza la venta (salesService.updateSalePayment)
 * - Crea documento Payment en Mongo
 */
const createPayment = async ({ saleId, customerId = null, amount, note = null, oldPaymentId = null } = {}) => {
  if (!saleId) throw new Error('saleId requerido');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('amount inválido');

  // Verificar que la venta exista
  const sale = await salesService.getSaleById(saleId);
  if (!sale) throw new Error('Venta no encontrada');

  // Solo permitimos pagos para ventas a crédito
  if (!sale.on_credit) throw new Error('Esta venta no es a crédito');

  // Actualizar montos en la venta (salesService se encarga de su transaction)
  const updated = await salesService.updateSalePayment(saleId, amt);

  // Insertar payment en Mongo (asumimos init() ya fue llamado)
  if (!mongoReady || !PaymentModel) throw new Error('paymentsService: MongoDB no inicializado. Llamá a init() primero.');

  // Determinar saleRef / oldSaleId
  let saleRef = null;
  let oldSaleId = null;

  // salesService.getSaleById puede devolver un objeto con _id (si es mongo) o id numérico (old)
  if (sale && (sale._id || (sale.id && isObjectId(String(sale.id))))) {
    saleRef = sale._id ? String(sale._id) : String(sale.id);
  } else {
    // preferir sale.id si existe (puede ser numérico o string no ObjectId)
    oldSaleId = (typeof sale.id !== 'undefined' && sale.id !== null) ? sale.id : saleId;
  }

  // Determinar customerRef / oldCustomerId
  let customerRef = null;
  let oldCustomerId = null;
  if (customerId) {
    if (typeof customerId === 'string' && isObjectId(customerId)) customerRef = customerId;
    else if (!isNaN(Number(customerId))) oldCustomerId = Number(customerId);
    else customerRef = customerId;
  } else if (sale && sale.customer_id) {
    // si sale trae customer_id
    if (typeof sale.customer_id === 'string' && isObjectId(String(sale.customer_id))) customerRef = String(sale.customer_id);
    else if (!isNaN(Number(sale.customer_id))) oldCustomerId = Number(sale.customer_id);
  }

  const doc = await PaymentModel.create({
    saleRef: saleRef ? mongoose.Types.ObjectId(saleRef) : null,
    oldSaleId: oldSaleId != null ? oldSaleId : null,
    customerRef: customerRef ? mongoose.Types.ObjectId(customerRef) : null,
    oldCustomerId: oldCustomerId != null ? oldCustomerId : null,
    oldPaymentId: oldPaymentId != null ? oldPaymentId : null,
    amount: amt,
    note: note || null
  });

  const payment = normalize(doc.toObject ? doc.toObject() : doc);

  // obtener estado actualizado de la venta (puede ser mongo o legacy)
  const saleAfter = await salesService.getSaleById(saleId);

  return { payment, sale: saleAfter, updated };
};

/* ---------- getPaymentById ---------- */
/**
 * Busca por _id (mongo) o por oldPaymentId (campo opcional),
 * si no encuentra intenta heurísticas sobre oldSaleId/oldCustomerId.
 */
const getPaymentById = async (id) => {
  if (!mongoReady || !PaymentModel) throw new Error('paymentsService: MongoDB no inicializado. Llamá a init() primero.');
  if (!id) return null;

  // si es ObjectId
  if (typeof id === 'string' && isObjectId(id)) {
    const doc = await PaymentModel.findById(id).lean().exec();
    if (!doc) return null;
    const p = normalize(doc);
    const cust = p.oldCustomerId != null ? await customersService.getCustomerById(p.oldCustomerId) : (p.customerRef ? await customersService.getCustomerById(p.customerRef) : null);
    return { ...p, customer_nombre: cust?.nombre ?? null };
  }

  // si es numérico -> buscar por oldPaymentId
  if (!isNaN(Number(id))) {
    const doc = await PaymentModel.findOne({ oldPaymentId: Number(id) }).lean().exec();
    if (doc) {
      const p = normalize(doc);
      const cust = p.oldCustomerId != null ? await customersService.getCustomerById(p.oldCustomerId) : (p.customerRef ? await customersService.getCustomerById(p.customerRef) : null);
      return { ...p, customer_nombre: cust?.nombre ?? null };
    }
    // si no existe oldPaymentId, podemos intentar buscar por oldSaleId/oldCustomerId heurísticamente (opcional)
    // pero no asumimos existencia; devolvemos null
    return null;
  }

  // fallback: intentar buscar por alguna coincidencia de campo
  const doc = await PaymentModel.findOne({ $or: [{ oldPaymentId: id }, { oldSaleId: id }, { oldCustomerId: id }] }).lean().exec();
  if (!doc) return null;
  const p = normalize(doc);
  const cust = p.oldCustomerId != null ? await customersService.getCustomerById(p.oldCustomerId) : (p.customerRef ? await customersService.getCustomerById(p.customerRef) : null);
  return { ...p, customer_nombre: cust?.nombre ?? null };
};

/* ---------- listPayments ---------- */
/**
 * listPayments({ saleId = null, customerId = null, limit = 200, offset = 0 })
 * Devuelve payments + info básica de venta y cliente.
 */
const listPayments = async ({ saleId = null, customerId = null, limit = 200, offset = 0 } = {}) => {
  if (!mongoReady || !PaymentModel) throw new Error('paymentsService: MongoDB no inicializado. Llamá a init() primero.');

  const filter = {};
  if (saleId) {
    if (typeof saleId === 'string' && isObjectId(saleId)) filter.saleRef = mongoose.Types.ObjectId(saleId);
    else if (!isNaN(Number(saleId))) filter.oldSaleId = Number(saleId);
    else filter.saleRef = saleId;
  }
  if (customerId) {
    if (typeof customerId === 'string' && isObjectId(customerId)) filter.customerRef = mongoose.Types.ObjectId(customerId);
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
    // intentar enriquecer con sale y customer (salesService/customersService deben aceptar mongo id o oldId)
    const saleLookupId = p.oldSaleId != null ? p.oldSaleId : (p.saleRef ? String(p.saleRef) : null);
    const custLookupId = p.oldCustomerId != null ? p.oldCustomerId : (p.customerRef ? String(p.customerRef) : null);

    const saleObj = saleLookupId ? await salesService.getSaleById(saleLookupId) : null;
    const custObj = custLookupId ? await customersService.getCustomerById(custLookupId) : null;

    out.push({
      ...p,
      sale_total: saleObj?.total ?? null,
      sale_on_credit: saleObj?.on_credit ?? null,
      customer_nombre: custObj?.nombre ?? null
    });
  }

  return out.map(r => ({ ...r, amount: r.amount != null ? Number(r.amount) : 0 }));
};

module.exports = {
  init,
  createPayment,
  listPayments,
  getPaymentById
};