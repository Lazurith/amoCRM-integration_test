public class TokenStorage {
    private final File file = new File("tokens.json");
    private final ObjectMapper mapper = new ObjectMapper();

    public void saveTokens(Map<String, Object> tokens) throws IOException {
        long expiresAt = System.currentTimeMillis() + ((Number) tokens.get("expires_in")).longValue() * 1000;
        tokens.put("expires_at", expiresAt);
        mapper.writerWithDefaultPrettyPrinter().writeValue(file, tokens);
    }

    public Map<String, Object> loadTokens() throws IOException {
        if (!file.exists()) throw new FileNotFoundException("Файл токенов не найден");
        return mapper.readValue(file, new TypeReference<>() {});
    }

    public Map<String, Object> refreshTokensIfNeeded(String clientId, String clientSecret, String redirectUri, String domain) throws IOException {
        Map<String, Object> tokens = loadTokens();
        if (System.currentTimeMillis() >= ((Number) tokens.get("expires_at")).longValue() - 60000) {
            RestTemplate rest = new RestTemplate();
            Map<String, Object> payload = Map.of(
                "client_id", clientId,
                "client_secret", clientSecret,
                "grant_type", "refresh_token",
                "refresh_token", tokens.get("refresh_token"),
                "redirect_uri", redirectUri
            );
            ResponseEntity<Map> response = rest.postForEntity("https://" + domain + "/oauth2/access_token", payload, Map.class);
            saveTokens(response.getBody());
            return response.getBody();
        }
        return tokens;
    }
}
