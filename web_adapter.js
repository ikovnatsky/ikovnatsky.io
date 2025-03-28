// WebUSB to WebSocket Adapter
class WebUSBAdapter {
    constructor(url) {
        this.url = url;
        this.device = null;
        this.interfaceNumber = 0;
        this.endpointIn = 0;
        this.endpointOut = 0;
        this.readyState = WebSocket.CONNECTING;
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        this.messageQueue = [];
        this.isReading = false;

        // Connect to the WebUSB device
        //this.connect();
    }



    async auto_device() {
        console.log('auto reconnect');
        let devices = await navigator.usb.getDevices();
        // loop through devices and connect to the first one that matches the filter
        for (const dev of devices) {
            if (dev.manufacturerName == "Dilon") {
                return dev;
            }
        }
        return null;
    }

    async select_device() {
        // Request the device that matches our requirements
        this.device = await navigator.usb.requestDevice({
            filters: [
                // Add filters specific to your device here
                // For example: { vendorId: 0x1234, productId: 0x5678 }
                // Leave empty to show all available USB devices
                {}
            ]
        });

        console.log('Selected device:', this.device);
        return this.device;
    }
    async connect() {
        try {
            // Try to get already-paired devices first
            const devices = await navigator.usb.getDevices();

            // Check if we have any "blabla" devices already paired
            let device = devices.find(d => d.manufacturerName === "Dilon");

            // If no paired "Dilon" device found, request one
            if (!device) {
                log('No pre-authorized "Dilon" device found, requesting device selection...');
                device = await navigator.usb.requestDevice({
                    filters: [
                        // Filter for "Dilon" manufacturer
                        { manufacturerName: "Dilon" }
                    ]
                });
            }

            this.device = device;
            log(`Selected device: ${this.device.productName || 'Unknown'} from manufacturer "Dilon"`);

            // Open the device
            // Handle case where device might already be open
            try {
                await this.device.open();
            } catch (openError) {
                if (openError.name === 'InvalidStateError') {
                    console.log('Device appears to be already open, continuing...');
                    // Continue with the connection process
                } else {
                    // Re-throw other errors
                    throw openError;
                }
            }

            // If the device has no configuration selected, select the first one
            if (this.device.configuration === null) {
                await this.device.selectConfiguration(1);
            }

            // Log device configuration
            console.log('Device configuration:', this.device.configuration);
            console.log('Interfaces:', this.device.configuration.interfaces);

            // Find the interface with bulk transfer endpoints
            const interfaces = this.device.configuration.interfaces;
            let foundSuitableInterface = false;

            // Look for an interface with both in and out bulk endpoints 
            // but backwards because the device I'm using has the endpoints in the second interface
            for (let i = interfaces.length - 1; i >= 0; i--) {
                const iface = interfaces[i];
                for (const alternate of iface.alternates) {
                    let inEndpoint = null;
                    let outEndpoint = null;

                    // Look for bulk transfer endpoints
                    for (const endpoint of alternate.endpoints) {
                        if (endpoint.type === 'bulk') {
                            if (endpoint.direction === 'in') {
                                inEndpoint = endpoint;
                            } else if (endpoint.direction === 'out') {
                                outEndpoint = endpoint;
                            }
                        }
                    }

                    if (inEndpoint && outEndpoint) {
                        // Found a suitable interface with both in and out bulk endpoints
                        this.interfaceNumber = iface.interfaceNumber;
                        this.endpointIn = inEndpoint.endpointNumber;
                        this.endpointOut = outEndpoint.endpointNumber;
                        foundSuitableInterface = true;

                        console.log(`Found suitable interface: ${this.interfaceNumber}`);
                        console.log(`IN endpoint: ${this.endpointIn}, OUT endpoint: ${this.endpointOut}`);
                        break;
                    }
                }

                if (foundSuitableInterface) break;
            }

            // If we couldn't find a suitable interface with bulk endpoints,
            // fall back to any interface with at least two endpoints
            if (!foundSuitableInterface) {
                console.log('No bulk transfer endpoints found, trying fallback method...');

                for (let i = 0; i < interfaces.length; i++) {
                    const iface = interfaces[i];
                    for (const alternate of iface.alternates) {
                        if (alternate.endpoints.length >= 2) {
                            // Found an interface with at least two endpoints
                            this.interfaceNumber = iface.interfaceNumber;

                            for (const endpoint of alternate.endpoints) {
                                if (endpoint.direction === 'in') {
                                    this.endpointIn = endpoint.endpointNumber;
                                } else if (endpoint.direction === 'out') {
                                    this.endpointOut = endpoint.endpointNumber;
                                }
                            }

                            foundSuitableInterface = true;
                            console.log(`Using fallback interface: ${this.interfaceNumber}`);
                            console.log(`IN endpoint: ${this.endpointIn}, OUT endpoint: ${this.endpointOut}`);
                            break;
                        }
                    }

                    if (foundSuitableInterface) break;
                }
            }

            if (!foundSuitableInterface || this.endpointIn === 0 || this.endpointOut === 0) {
                throw new Error('Could not find appropriate endpoints for communication');
            }



            // Claim the interface
            try {
                await this.device.claimInterface(this.interfaceNumber);
                console.log(`Successfully claimed interface ${this.interfaceNumber}`);
            } catch (claimError) {
                // Check if error indicates interface is already claimed
                if (claimError.message.includes('interface already claimed') ||
                    claimError.name === 'InvalidStateError') {
                    console.log(`Interface ${this.interfaceNumber} appears to be already claimed, continuing...`);
                    // Continue with the connection process
                } else {
                    console.error('Error claiming interface:', claimError);
                    // If claiming fails for other reasons, try to reset the device and try again
                    try {
                        await this.device.reset();
                        await this.device.claimInterface(this.interfaceNumber);
                        console.log('Successfully claimed interface after reset');
                    } catch (resetError) {
                        throw new Error(`Failed to claim interface: ${resetError.message}`);
                    }
                }
            }

            // Select alternate interface if needed
            try {
                // Optional: Set alternate interface if the device requires it
                // await this.device.selectAlternateInterface(this.interfaceNumber, 0);
            } catch (altError) {
                console.warn('Could not set alternate interface:', altError);
                // Continue anyway, this might not be required for all devices
            }

            // Start listening for messages
            this.readyState = WebSocket.OPEN;
            if (this.onopen) {
                this.onopen();
            }

            this.startReading();
        } catch (error) {
            console.error('WebUSB connection error:', error);
            this.readyState = WebSocket.CLOSED;
            if (this.onerror) {
                this.onerror(error);
            }
            if (this.onclose) {
                this.onclose();
            }
        }
    }

    async startReading() {
        this.isReading = true;
        let messageBuffer = '';
        const decoder = new TextDecoder();

        while (this.isReading) {
            try {
                // Use a larger buffer size (1024 bytes)
                const result = await this.device.transferIn(this.endpointIn, 1024);

                if (result.data.byteLength > 0) {
                    // Decode and add to buffer
                    const chunk = decoder.decode(result.data);
                    messageBuffer += chunk;

                    // Check if we have a complete JSON message
                    // This assumes messages are either complete JSON objects or have a delimiter
                    try {
                        // Try to parse as JSON to see if it's complete
                        const messages = this.extractCompleteMessages(messageBuffer);

                        if (messages.complete.length > 0) {
                            // Process each complete message
                            for (const message of messages.complete) {
                                if (this.onmessage) {
                                    this.onmessage({ data: message });
                                }
                            }

                            // Update buffer with any remaining incomplete data
                            messageBuffer = messages.remainder;
                        }

                        // If buffer is getting too large without valid JSON, clear it
                        // to prevent memory issues (adjust size limit as needed)
                        if (messageBuffer.length > 10000) {
                            console.warn('Message buffer exceeded size limit, clearing');
                            messageBuffer = '';
                        }
                    } catch (parseError) {
                        // Message is not complete yet, continue reading
                    }
                }

                // Small delay to prevent CPU hogging
                await new Promise(resolve => setTimeout(resolve, 5));
            } catch (error) {
                console.error('Error reading from device:', error);
                this.isReading = false;
                this.readyState = WebSocket.CLOSED;

                if (this.onerror) {
                    this.onerror(error);
                }
                if (this.onclose) {
                    this.onclose();
                }

                break;
            }
        }
    }

    // Helper method to extract complete JSON messages from buffer
    extractCompleteMessages(buffer) {
        const result = {
            complete: [],
            remainder: buffer
        };

        // Track open and closing braces to identify complete JSON objects
        let currentPos = 0;
        let startPos = -1;
        let braceCount = 0;

        // Scan through the buffer character by character
        for (let i = 0; i < buffer.length; i++) {
            const char = buffer[i];

            // Found opening brace
            if (char === '{') {
                // If this is the first opening brace, mark the start position
                if (braceCount === 0) {
                    startPos = i;
                }
                braceCount++;
            }
            // Found closing brace
            else if (char === '}') {
                braceCount--;

                // If braces are balanced and we had an opening brace before,
                // we have a complete JSON object
                if (braceCount === 0 && startPos !== -1) {
                    // Extract the JSON string (including the braces)
                    const jsonStr = buffer.substring(startPos, i + 1);

                    try {
                        // Verify it's valid JSON
                        JSON.parse(jsonStr);

                        // Add to complete messages
                        result.complete.push(jsonStr);

                        // Update the current position
                        currentPos = i + 1;
                    } catch (e) {
                        // If parsing failed, this wasn't a valid JSON object
                        // Just continue scanning
                    }

                    // Reset for the next object
                    startPos = -1;
                }
            }
        }

        // The remainder is anything after the last complete JSON object
        if (currentPos < buffer.length) {
            result.remainder = buffer.substring(currentPos);
        } else {
            result.remainder = '';
        }

        return result;
    }

    async send(data) {
        if (this.readyState !== WebSocket.OPEN) {
            throw new Error('WebUSB connection not open');
        }

        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(data);

            // Check if we need to chunk the data
            const MAX_CHUNK_SIZE = 1024; // USB packets are typically limited in size

            if (dataBuffer.byteLength <= MAX_CHUNK_SIZE) {
                // Send in one go if small enough
                await this.device.transferOut(this.endpointOut, dataBuffer);
            } else {
                // Split into chunks for larger payloads
                for (let i = 0; i < dataBuffer.byteLength; i += MAX_CHUNK_SIZE) {
                    const chunk = dataBuffer.slice(i, Math.min(i + MAX_CHUNK_SIZE, dataBuffer.byteLength));
                    await this.device.transferOut(this.endpointOut, chunk);

                    // Small delay between chunks to prevent buffer overflows on the device
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }
        } catch (error) {
            console.error('Error sending to device:', error);
            if (this.onerror) {
                this.onerror(error);
            }
        }
    }

    async close() {
        this.isReading = false;
        if (this.device) {
            try {
                await this.device.releaseInterface(this.interfaceNumber);
                await this.device.close();
                this.readyState = WebSocket.CLOSED;
                if (this.onclose) {
                    this.onclose();
                }
            } catch (error) {
                console.error('Error closing WebUSB connection:', error);
                if (this.onerror) {
                    this.onerror(error);
                }
            }
        }
    }
}

// Define WebSocket states to match the WebSocket API
if (typeof WebSocket === 'undefined') {
    window.WebSocket = {
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3
    };
}