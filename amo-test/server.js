const express = require('express');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

const CLIENT_ID = '0c026147-bf5f-4157-9ae3-6f7ad1ef7a68';
const CLIENT_SECRET = '5aOpt8J5JWOZwH3B0t2l7ZQaU3ZxFKmHlcupvb1OPlY0zoyuAVcKs207jP1p8Suq';
const REDIRECT_URI = 'https://aecbf1f9b56a.ngrok-free.app/oauth';
const AMO_DOMAIN = 'lazizkhamrakulov.amocrm.ru';
const TOKEN_PATH = './tokens.json';

let temporaryStorage = {};

function saveTokens(tokens) {
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...tokens, expires_at: expiresAt }, null, 2));
}

function loadTokens() {
    if (!fs.existsSync(TOKEN_PATH)) throw new Error('Файл токенов не найден');
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
}

async function refreshTokensIfNeeded() {
    let tokens = loadTokens();
    if (Date.now() >= tokens.expires_at - 60000) {
        const response = await axios.post(`https://${AMO_DOMAIN}/oauth2/access_token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            redirect_uri: REDIRECT_URI,
        });
        tokens = response.data;
        saveTokens(tokens);
    }
    return tokens;
}

app.post('/api/lead-step1', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Номер телефона обязателен' });

    try {
        const tokens = await refreshTokensIfNeeded();
        const headers = {
            Authorization: `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
        };

        const leadResp = await axios.post(`https://${AMO_DOMAIN}/api/v4/leads`, [{
            name: 'Новый интерес',
            status_id: 78254394,
        }], { headers });

        const leadId = leadResp.data._embedded.leads[0].id;

        const contactResp = await axios.post(`https://${AMO_DOMAIN}/api/v4/contacts`, [{
            name: 'Без имени',
            custom_fields_values: [{
                field_code: 'PHONE',
                values: [{ value: phone }],
            }],
            _embedded: { leads: [{ id: leadId }] },
        }], { headers });

        const contactId = contactResp.data._embedded.contacts[0].id;

        temporaryStorage[phone] = { leadId, contactId };

        res.json({ status: 'ok', leadId });
    } catch (error) {
        console.error('Ошибка на шаге 1:', error.response?.data || error.message);
        res.status(500).json({ error: 'Ошибка на шаге 1' });
    }
});

app.post('/api/lead-step2', async (req, res) => {
    const { name, email, course, phone } = req.body;
    const entry = temporaryStorage[phone];

    if (!entry) return res.status(404).json({ error: 'Сначала выполните шаг 1' });

    try {
        const tokens = await refreshTokensIfNeeded();
        const headers = {
            Authorization: `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
        };

        // Обновляем сделку
        await axios.patch(`https://${AMO_DOMAIN}/api/v4/leads`, [
            {
                id: entry.leadId,
                name: `Заявка: курс ${course}`,
                status_id: 78254398,
            }
        ], { headers });

        // Обновляем контакт
        const contactUpdatePayload = {
            id: entry.contactId,
            name,
            custom_fields_values: [
                {
                    field_code: 'PHONE',
                    values: [{ value: phone }]
                },
                {
                    field_code: 'EMAIL',
                    values: [{ value: email }]
                }
            ]
        };

        await axios.patch(`https://${AMO_DOMAIN}/api/v4/contacts`, [contactUpdatePayload], { headers });

        res.json({ status: 'ok', message: 'Данные успешно обновлены' });
    } catch (error) {
        console.error('Ошибка на шаге 2:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Message:', error.message);
        }
        res.status(500).json({ error: 'Ошибка на шаге 2' });
    }
});


app.get('/oauth', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Нет кода авторизации');

    try {
        const response = await axios.post(`https://${AMO_DOMAIN}/oauth2/access_token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        });

        saveTokens(response.data);
        res.send('✅ Токены сохранены, интеграция работает!');
    } catch (err) {
        console.error('Ошибка при получении токенов:', err.response?.data || err.message);
        res.status(500).send('Ошибка при авторизации');
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
