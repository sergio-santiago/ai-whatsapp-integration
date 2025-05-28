const express = require("express");
const config = require("./src/config");
const webhookRoutes = require("./src/routes/webhookRoutes");

const app = express();

// Configuración de middleware
app.use(express.json());

// Rutas
app.use(webhookRoutes);

// Iniciar servidor
app.listen(config.PORT, () => {
    console.log(`Servidor escuchando en puerto ${config.PORT}`);
});
