const express = require('express');
const { login } = require('../controllers/authController'); // ← Usa el controller real

const router = express.Router();

router.post('/login', login); // ← Ahora sí valida credenciales

router.post('/register', (req, res) => {
  res.status(501).json({ message: 'Registro no implementado' });
});

module.exports = router;