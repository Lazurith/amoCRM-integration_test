const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔐 Данные интеграции
const CLIENT_ID = '0c026147-bf5f-4157-9ae3-6f7ad1ef7a68';
const CLIENT_SECRET = '5aOpt8J5JWOZwH3B0t2l7ZQaU3ZxFKmHlcupvb1OPlY0zoyuAVcKs207jP1p8Suq';
const REDIRECT_URI = 'https://aecbf1f9b56a.ngrok-free.app/oauth';
const AMO_DOMAIN = 'lazizkhamrakulov.amocrm.ru';
const TOKEN_PATH = './tokens.json';

// 💾 Сохраняем токены в файл
function saveTokens(tokens) {
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...tokens, expires_at: expiresAt }, null, 2));
}

// 📤 Загружаем токены
function loadTokens() {
    if (!fs.existsSync(TOKEN_PATH)) throw new Error('Файл токенов не найден');
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
}

// 🔁 Обновление access_token при необходимости
async function refreshTokensIfNeeded() {
    let tokens = loadTokens();

    if (Date.now() >= tokens.expires_at - 60000) {
        console.log('🔄 Токен устарел, обновляем...');
        const response = await axios.post(`https://${AMO_DOMAIN}/oauth2/access_token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            redirect_uri: REDIRECT_URI
        });

        tokens = response.data;
        saveTokens(tokens);
        console.log('✅ Токен успешно обновлён');
    }

    return tokens;
}

// 📥 Обработка формы: создаём сделку и контакт
app.post('/api/lead', async (req, res) => {
    const data = req.body;
    console.log('📩 Получена заявка от студента:', data);

    const tokens = await refreshTokensIfNeeded();
    const accessToken = tokens.access_token;

    const statusId = parseInt(data.stage); // Получаем выбранный этап

    try {
        // Создание сделки
        const leadResponse = await axios.post(
            `https://${AMO_DOMAIN}/api/v4/leads`,
            [
                {
                    name: `Заявка: ${data.name}`,
                    status_id: statusId
                }
            ],
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const leadId = leadResponse.data._embedded.leads[0].id;

        // Создание контакта
        await axios.post(
            `https://${AMO_DOMAIN}/api/v4/contacts`,
            [
                {
                    name: data.name,
                    custom_fields_values: [
                        {
                            field_code: 'PHONE',
                            values: [{ value: data.phone }]
                        },
                        {
                            field_code: 'EMAIL',
                            values: [{ value: data.email }]
                        }
                    ],
                    _embedded: {
                        leads: [{ id: leadId }]
                    }
                }
            ],
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({ status: 'ok', message: 'Контакт и сделка созданы в выбранном этапе воронки' });

    } catch (error) {
        console.error('❌ Ошибка при создании лида/контакта:', error.response?.data || error.message);
        res.status(500).json({ error: 'Ошибка при отправке в amoCRM' });
    }
});


// 🌐 OAuth редирект от amoCRM
app.get('/oauth', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('Нет кода авторизации');
    }

    try {
        const response = await axios.post(`https://${AMO_DOMAIN}/oauth2/access_token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI
        });

        const tokens = response.data;
        saveTokens(tokens);
        console.log('🎉 Токены получены и сохранены:', tokens);
        res.send('✅ Интеграция успешна! Можешь закрыть окно.');
    } catch (err) {
        console.error('❌ Ошибка при получении токенов:', err.response?.data || err.message);
        res.status(500).send('❌ Ошибка при авторизации');
    }
});

// 🚀 Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});

app.get('/pipeline-statuses', async (req, res) => {
    const tokens = await refreshTokensIfNeeded();
    try {
        const response = await axios.get(`https://${AMO_DOMAIN}/api/v4/leads/pipelines`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });

        res.json(response.data);
    } catch (err) {
        console.error('Ошибка при получении стадий:', err.response?.data || err.message);
        res.status(500).json({ error: 'Не удалось получить стадии' });
    }
});

