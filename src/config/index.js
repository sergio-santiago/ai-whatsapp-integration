require('dotenv').config();

const config = {
    PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
    AI21_API_KEY: process.env.AI21_API_KEY,
    VERIFY_TOKEN: process.env.VERIFY_TOKEN,
    PORT: process.env.PORT || 3000
};

module.exports = config;
