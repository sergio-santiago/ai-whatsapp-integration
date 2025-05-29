const express = require("express");
const router = express.Router();
const config = require("../config");
const { queryAI21 } = require("../services/ai21Service");
const { sendWhatsAppMessage } = require("../services/whatsappService");

// Endpoint for Facebook to verify your webhook
router.get("/webhook", (req, res) => {
    console.log("🔑 Verifying webhook");

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === config.VERIFY_TOKEN) {
        console.log("✅ Webhook verified successfully");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Endpoint that receives WhatsApp messages (POST)
router.post("/webhook", async (req, res) => {
    try {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!message) return res.sendStatus(200);

        const text = message.text?.body || "";
        const from = message.from;

        console.log("💬 Message received:", text);

        const aiResponse = await queryAI21(text);
        const response = aiResponse || "Sorry, I can't answer right now..";

        await sendWhatsAppMessage(from, response);

        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook error:", error.message);
        res.sendStatus(500);
    }
});

module.exports = router;
