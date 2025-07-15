@Service
public class AmoCrmService {
    private final RestTemplate rest = new RestTemplate();
    private final Map<String, Map<String, Long>> temporaryStorage = new ConcurrentHashMap<>();
    private final TokenStorage tokenStorage = new TokenStorage();

    @Value("${amo.clientId}") private String clientId;
    @Value("${amo.clientSecret}") private String clientSecret;
    @Value("${amo.redirectUri}") private String redirectUri;
    @Value("${amo.domain}") private String domain;

    public ResponseEntity<?> handleOauth(String code) {
        try {
            Map<String, String> payload = Map.of(
                "client_id", clientId,
                "client_secret", clientSecret,
                "grant_type", "authorization_code",
                "code", code,
                "redirect_uri", redirectUri
            );
            ResponseEntity<Map> response = rest.postForEntity(getUrl("/oauth2/access_token"), payload, Map.class);
            tokenStorage.saveTokens(response.getBody());
            return ResponseEntity.ok("✅ Токены сохранены, интеграция работает!");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Ошибка при авторизации: " + e.getMessage());
        }
    }

    public ResponseEntity<?> handleStep1(String phone) {
        try {
            Map<String, Object> tokens = tokenStorage.refreshTokensIfNeeded(clientId, clientSecret, redirectUri, domain);
            HttpHeaders headers = getHeaders(tokens.get("access_token").toString());

            Map<String, Object> contact = findContactByPhone(phone, headers);
            Long contactId;

            if (contact != null) {
                boolean hasName = !contact.get("name").toString().equals("Без имени");
                List<Map<String, Object>> fields = (List<Map<String, Object>>) contact.get("custom_fields_values");
                boolean hasEmail = fields.stream().anyMatch(f -> "EMAIL".equals(f.get("field_code")));
                boolean hasCourse = fields.stream().anyMatch(f -> Long.valueOf(2306677).equals(f.get("field_id")));
                if (hasName && hasEmail && hasCourse) {
                    return ResponseEntity.badRequest().body(Map.of("error", "Уже зарегистрирован учащийся"));
                }
                contactId = Long.valueOf(contact.get("id").toString());
            } else {
                Map<String, Object> contactPayload = Map.of(
                    "name", "Без имени",
                    "custom_fields_values", List.of(Map.of(
                        "field_code", "PHONE",
                        "values", List.of(Map.of("value", phone, "enum_code", "WORK"))
                    ))
                );
                ResponseEntity<Map> response = rest.exchange(
                    getUrl("/api/v4/contacts"),
                    HttpMethod.POST,
                    new HttpEntity<>(List.of(contactPayload), headers),
                    Map.class
                );
                List<Map<String, Object>> contacts = (List<Map<String, Object>>) ((Map) response.getBody().get("_embedded")).get("contacts");
                contactId = Long.valueOf(contacts.get(0).get("id").toString());
            }

            Long leadId = findOrCreateLead(contactId, headers);

            temporaryStorage.put(phone, Map.of("leadId", leadId, "contactId", contactId));
            return ResponseEntity.ok(Map.of("status", "ok", "leadId", leadId));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Ошибка на шаге 1: " + e.getMessage()));
        }
    }

    public ResponseEntity<?> handleStep2(Map<String, String> body) {
        String phone = body.get("phone");
        var entry = temporaryStorage.get(phone);
        if (entry == null) {
            return ResponseEntity.status(404).body(Map.of("error", "Сначала выполните шаг 1"));
        }

        try {
            Map<String, Object> tokens = tokenStorage.refreshTokensIfNeeded(clientId, clientSecret, redirectUri, domain);
            HttpHeaders headers = getHeaders(tokens.get("access_token").toString());

            // Update lead
            Map<String, Object> leadPayload = Map.of(
                "id", entry.get("leadId"),
                "name", "Заявка: курс " + body.get("course"),
                "status_id", 78254398
            );
            rest.exchange(getUrl("/api/v4/leads"), HttpMethod.PATCH, new HttpEntity<>(List.of(leadPayload), headers), Void.class);

            // Update contact
            List<Map<String, Object>> fields = List.of(
                Map.of("field_code", "PHONE", "values", List.of(Map.of("value", phone, "enum_code", "WORK"))),
                Map.of("field_code", "EMAIL", "values", List.of(Map.of("value", body.get("email"), "enum_code", "WORK"))),
                Map.of("field_id", 2306677, "values", List.of(Map.of("value", body.get("course"))))
            );

            Map<String, Object> contactPayload = Map.of(
                "id", entry.get("contactId"),
                "name", body.get("name"),
                "custom_fields_values", fields
            );
            rest.exchange(getUrl("/api/v4/contacts"), HttpMethod.PATCH, new HttpEntity<>(List.of(contactPayload), headers), Void.class);

            return ResponseEntity.ok(Map.of("status", "ok", "message", "Данные обновлены"));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Ошибка на шаге 2: " + e.getMessage()));
        }
    }

    private HttpHeaders getHeaders(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        h.setContentType(MediaType.APPLICATION_JSON);
        return h;
    }

    private String getUrl(String path) {
        return "https://" + domain + path;
    }

    // Найти контакт и сделку (вспомогательные методы см. ниже)
    private Map<String, Object> findContactByPhone(String phone, HttpHeaders headers) {
        // Подобная логика как в JS — через /contacts?query=
        // Можно реализовать аналогично
        return null; // ← реализуем при необходимости
    }

    private Long findOrCreateLead(Long contactId, HttpHeaders headers) {
        // Аналогично findActiveLeadForContact и создание сделки
        return 123L; // ← условный ID
    }
}
