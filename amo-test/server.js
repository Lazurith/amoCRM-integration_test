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
const REDIRECT_URI = 'https://15909ddf1b6e.ngrok-free.app/oauth';
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

async function findContactByPhone(phone, headers) {
    const query = phone.replace(/\D/g, '');

    const response = await axios.get(`https://${AMO_DOMAIN}/api/v4/contacts`, {
        headers,
        params: { query }
    });

    const contacts = response.data._embedded?.contacts || [];

    for (const contact of contacts) {
        const phones = (contact.custom_fields_values || [])
            .filter(f => f.field_code === 'PHONE')
            .flatMap(f => f.values.map(v => v.value.replace(/\D/g, '')));

        if (phones.includes(query)) {
            return contact;
        }
    }

    return null;
}

async function findActiveLeadForContact(contactId, headers) {
    const response = await axios.get(`https://${AMO_DOMAIN}/api/v4/contacts/${contactId}/links`, {
        headers,
        params: { with: 'leads' }
    });

    const links = response.data._embedded?.links || [];
    const leadLinks = links.filter(link => link.to_entity_type === 'leads');
    if (leadLinks.length === 0) return null;

    const leadIds = leadLinks.map(link => link.to_entity_id);

    const leadsResp = await axios.get(`https://${AMO_DOMAIN}/api/v4/leads`, {
        headers,
        params: { id: leadIds.join(',') }
    });

    const leads = leadsResp.data._embedded?.leads || [];
    return leads.find(lead => ![142, 143].includes(lead.status_id)) || null;
}

// Шаг 1
app.post('/api/lead-step1', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Номер телефона обязателен' });

    try {
        const tokens = await refreshTokensIfNeeded();
        const headers = {
            Authorization: `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
        };

        let contact = await findContactByPhone(phone, headers);
        let contactId;

        if (contact) {
            const hasName = contact.name && contact.name !== 'Без имени';
            const emailField = (contact.custom_fields_values || []).find(f => f.field_code === 'EMAIL');
            const courseField = (contact.custom_fields_values || []).find(f => f.field_id === 2306677);
            const hasEmail = emailField?.values?.[0]?.value;
            const hasCourse = courseField?.values?.[0]?.value;

            if (hasName && hasEmail && hasCourse) {
                return res.status(400).json({ error: 'По этому номеру уже зарегистрирован учащийся' });
            }

            contactId = contact.id;
        } else {
            const contactResp = await axios.post(`https://${AMO_DOMAIN}/api/v4/contacts`, [{
                name: 'Без имени',
                custom_fields_values: [{
                    field_code: 'PHONE',
                    values: [{ value: phone, enum_code: 'WORK' }]
                }]
            }], { headers });

            contactId = contactResp.data._embedded.contacts[0].id;
        }

        // Проверка на существующую активную сделку
        let leadId;
        const existingLead = await findActiveLeadForContact(contactId, headers);

        if (existingLead) {
            leadId = existingLead.id;
        } else {
            const leadResp = await axios.post(`https://${AMO_DOMAIN}/api/v4/leads`, [{
                name: 'Новый интерес',
                status_id: 78254394,
            }], { headers });

            leadId = leadResp.data._embedded.leads[0].id;

            // Привязка контакта к сделке
            await axios.post(`https://${AMO_DOMAIN}/api/v4/leads/${leadId}/link`, [{
                to_entity_id: contactId,
                to_entity_type: 'contacts'
            }], { headers });
        }

        temporaryStorage[phone] = { leadId, contactId };
        res.json({ status: 'ok', leadId });

    } catch (error) {
        console.error('Ошибка на шаге 1:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.detail || 'Ошибка на шаге 1' });
    }
});

// Шаг 2
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
        await axios.patch(`https://${AMO_DOMAIN}/api/v4/leads`, [{
            id: entry.leadId,
            name: `Заявка: курс ${course}`,
            status_id: 78254398
        }], { headers });

        // Обновляем контакт
        const contactUpdatePayload = [
            {
                field_code: 'PHONE',
                values: [{ value: phone, enum_code: 'WORK' }]
            },
            {
                field_code: 'EMAIL',
                values: [{ value: email, enum_code: 'WORK' }]
            },
            {
                field_id: 2306677,
                values: [{ value: course }]
            }
        ];

        await axios.patch(`https://${AMO_DOMAIN}/api/v4/contacts`, [{
            id: entry.contactId,
            name,
            custom_fields_values: contactUpdatePayload
        }], { headers });

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

// Авторизация
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
