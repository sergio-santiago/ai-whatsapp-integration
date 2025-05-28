const axios = require("axios");
const config = require("../config");

async function sendWhatsAppMessage(to, message) {
    try {
        await axios.post(
            `https://graph.facebook.com/v18.0/${config.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                text: { body: message },
            },
            {
                headers: {
                    Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        );
        console.log("✅ AI Response sent:", message);
        return true;
    } catch (error) {
        console.log("Error sending WhatsApp message:", error.message);
        return false;
    }
}

module.exports = {
    sendWhatsAppMessage
};
