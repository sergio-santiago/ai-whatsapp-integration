const axios = require("axios");
const config = require("../config");

async function consultarAI21(userText) {
    let IA_CONTEXT = "Es un asistente de moda. Debe recomendar como vestir adecuadamente"
    const data = {
        model: "jamba-large-1.6",
        messages: [
            {
                role: "system",
                content: IA_CONTEXT
            },
            {
                role: "user",
                content: userText
            }
        ],
        max_tokens: 300,
        temperature: 0.7,
        top_p: 1,
        n: 1,
        response_format: { type: "text" },
    };

    try {
        const response = await axios.post(
            "https://api.ai21.com/studio/v1/chat/completions",
            data,
            {
                headers: {
                    Authorization: `Bearer ${config.AI21_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("Error AI21:", error.response?.data || error.message);
        return null;
    }
}

module.exports = {
    consultarAI21
};
