@RestController
@RequestMapping("/api")
public class AmoCrmController {
    private final AmoCrmService amoService;

    public AmoCrmController(AmoCrmService amoService) {
        this.amoService = amoService;
    }

    @PostMapping("/lead-step1")
    public ResponseEntity<?> step1(@RequestBody Map<String, String> body) {
        String phone = body.get("phone");
        if (phone == null || phone.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Номер телефона обязателен"));
        }
        return amoService.handleStep1(phone);
    }

    @PostMapping("/lead-step2")
    public ResponseEntity<?> step2(@RequestBody Map<String, String> body) {
        return amoService.handleStep2(body);
    }

    @GetMapping("/oauth")
    public ResponseEntity<?> auth(@RequestParam String code) {
        return amoService.handleOauth(code);
    }
}
