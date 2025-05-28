const axios = require("axios");
const config = require("../config");

async function enviarMensajeWhatsApp(to, mensaje) {
    try {
        await axios.post(
            `https://graph.facebook.com/v18.0/${config.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                text: { body: mensaje },
            },
            {
                headers: {
                    Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        );
        console.log("✅ Respuesta IA enviada:", mensaje);
        return true;
    } catch (error) {
        console.log("Error enviando mensaje WhatsApp:", error.message);
        return false;
    }
}

module.exports = {
    enviarMensajeWhatsApp
};
