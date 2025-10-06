const { loginService } = require('../services/authService');

const login = async (req, res) => {
  try {
    const { user, pass } = req.body;
    
    if (!user || !pass) {
      return res.status(400).json({ message: 'Usuario y contraseña requeridos' });
    }

    const token = await loginService(user, pass);

    if (!token) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    res.json({ token });
  } catch (err) {
    console.error('[authController] Error:', err);
    res.status(500).json({ message: 'Error en el servidor' });
  }
};

module.exports = { login };