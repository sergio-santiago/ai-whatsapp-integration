const express = require("express");
const config = require("./src/config");
const webhookRoutes = require("./src/routes/webhookRoutes");

const app = express();

// Middleware configuration
app.use(express.json());

// Routes
app.use(webhookRoutes);

// Start server
app.listen(config.PORT, () => {
    console.log(`Server listening on port ${config.PORT}`);
});
