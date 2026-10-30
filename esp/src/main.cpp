#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ESP32QRCodeReader.h>

/* ================================================================
 *  EDIT THE 3 LINES BELOW
 * ================================================================ */
const char* WIFI_SSID  = "opporeno6";                          // ← EDIT #1
const char* WIFI_PASS  = "parikshit";                          // ← EDIT #2
const char* SERVER_URL = "http://10.68.253.166:3000/api/scan"; // ← EDIT #3 (Make sure this is your Mac's IP!)
/* ================================================================ */

const char* ESP32_KEY = "esp32-shared-secret";

// The library handles all camera pins internally with this macro.
ESP32QRCodeReader reader(CAMERA_MODEL_AI_THINKER);

// Background task for reading QR codes
void onQrCodeTask(void *pvParameters) {
  struct QRCodeData qrCodeData;
  while (true) {
    if (reader.receiveQrCode(&qrCodeData, 100)) {
      if (qrCodeData.valid) {
        String token((const char*)qrCodeData.payload);
        Serial.print("QR token: ");
        Serial.println(token);
        
        // Send the token to your Node.js server
        if (WiFi.status() == WL_CONNECTED) {
          HTTPClient http;
          http.setTimeout(8000);
          http.begin(SERVER_URL);
          http.addHeader("Content-Type", "application/json");
          
          String body = "{\"key\":\"" + String(ESP32_KEY) + "\",\"token\":\"" + token + "\"}";
          int code = http.POST(body);
          String resp = http.getString();
          http.end();
          
          Serial.printf("POST %d: %s\n", code, resp.c_str());
        } else {
          Serial.println("WiFi disconnected, skipping POST");
        }
        
      } else {
        Serial.println("Invalid QR code");
      }
      delay(800); // Debounce so it doesn't scan the same QR 100 times a second
    }
    vTaskDelay(100 / portTICK_PERIOD_MS); // Yield to system
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== ESP32-CAM Attendance Scanner ===");

  // 1. Initialize Camera and QR Reader
  reader.setup();
  Serial.println("QR reader ready. Point at a student's QR.");

  // 2. Connect to Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");
  
  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 20000) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nConnected. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nWiFi connection FAILED. Check SSID/password.");
  }

  // 3. Start the QR reading task on core 1
  reader.beginOnCore(1);
  xTaskCreate(onQrCodeTask, "onQrCode", 8 * 1024, NULL, 4, NULL);
}

void loop() {
  // The task handles everything, so the loop can be empty.
  delay(1000);
}