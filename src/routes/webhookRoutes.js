const express = require("express");
const router = express.Router();
const config = require("../config");
const { consultarAI21 } = require("../services/ai21Service");
const { enviarMensajeWhatsApp } = require("../services/whatsappService");

// Endpoint para que Facebook verifique tu webhook
router.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === config.VERIFY_TOKEN) {
        console.log("✅ Webhook verificado correctamente");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Endpoint que recibe los mensajes WhatsApp (POST)
router.post("/webhook", async (req, res) => {
    try {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!message) return res.sendStatus(200);

        const text = message.text?.body || "";
        const from = message.from;

        console.log("💬 Mensaje recibido:", text);

        const respuestaIA = await consultarAI21(text);
        const respuesta = respuestaIA || "Lo siento, no puedo responder ahora mismo.";

        await enviarMensajeWhatsApp(from, respuesta);

        res.sendStatus(200);
    } catch (error) {
        console.error("Error en webhook:", error.message);
        res.sendStatus(500);
    }
});

module.exports = router;
