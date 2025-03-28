// Copyright (c) 2017, Intel Corporation.

var devicesNode = document.getElementById('devices');
var statusNode = document.getElementById('status');
var historyNode = document.getElementById('history');

device = null;

packetsRead = 0;
packetsWritten = 0;
bytesRead = 0;
bytesWritten = 0;

async function autoConnect(dev) {
    if (dev.manufacturerName == 'Espressif Systems' || dev.manufacturerName == 'Intel') {
	    devicesNode.innerHTML = dev.manufacturerName + ' ' +
	        dev.productName;
        try {
	        statusNode.innerHTML = "CONNECTED";
            await dev.open();
       // await device.selectConfiguration(1);
        await device.claimInterface(0);
            device = dev;
            //await ctrlTransfer();
            // setTimeout(sendReceiveLoop, 250);
        }
        catch (e) {
            console.log("Exception:", e.message);
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    let devices = await navigator.usb.getDevices();
    devices.forEach(async dev => {
        autoConnect(dev);
    });
});

function updateHistory() {
    historyNode.innerHTML =
        packetsWritten + ' packets sent (' + bytesWritten + ' bytes)<br>\n' +
        packetsRead + ' packets received (' + bytesRead + ' bytes)';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connect(dev) {
    console.log('opening device...');
    try {
	    await device.open();
    }
    catch (e) {
        console.log('open failed');
        return;
    }
	statusNode.innerHTML = "Connected";
    await device.selectConfiguration(1);
   console.log('opened');

    // TODO: could split out
	if (device.configuration == null) {
        console.log('configuring device...');
	    device.selectConfiguration(1);
	}
}

async function claim() {
	console.log('claiming interface...');
    try {
        // print all claimed interfaces
        let interfaces = device.configuration.interfaces;
        for (let i = 0; i < interfaces.length; i++) {
            let iface = interfaces[i];
            console.log('interface:', iface.interfaceNumber, 'claimed:',
                        iface.claimed);
        
                    }
                //    await device.selectAlternateInterface(1, 0);
        await device.selectConfiguration(1);
        await device.claimInterface(0);
        console.log('claim 0 success');
	statusNode.innerHTML = "Connected";
	    //await device.claimInterface(1)
        //console.log('claim 1 success');
        
        //console.log('claim success');
    }
    catch (e) {
        console.log('claim failed');
	statusNode.innerHTML = "Failed ";
        return;
    }        
}

async function ctrlTransfer() {
	console.log('control transfer...');
	await device.controlTransferOut({
	    requestType: 'class',
	    recipient: 'interface',
	    request: 0x22,
	    value: 0x01,
	    index: 0x02
	});
}

async function sendReceiveLoop() {
    let maxlen = 32;
    let buf = new Uint8Array(maxlen);
    var count = 0;
    //while (true)
         {
        count += 1;
        buf[0] = count % 256;
	    let result = await device.transferOut(1, buf);
        packetsWritten += 1;
        bytesWritten += result.bytesWritten;
        updateHistory();

        // NOTE: if this is not big enough to handle a message, call blocks
        //   forever, which seems like a Chrome bug
	    result = await device.transferIn(1, maxlen);
        packetsRead += 1;
        bytesRead += result.data.byteLength;
        updateHistory();

        await sleep(100)
    }
}

document.getElementById('disconnect').addEventListener('click', async () => {
    let devices = await navigator.usb.getDevices();
    devices.forEach(device => {
	    device.close();
    });
    devicesNode.innerHTML = '';
    statusNode.innerHTML = 'Disconnected';
});

document.getElementById('connect').addEventListener('click', async () => {
    try {
        console.log('requesting device...');
	    device = await navigator.usb.requestDevice({filters: []});
	    devicesNode.innerHTML += 'Added: ' + device.manufacturerName + ' ' +
	        device.productName + '<br>\n';
	    connect(device);
        //await device.selectConfiguration(1);
    }
    catch (e) {
	    console.log('no device selected');
    }
});

document.getElementById('claim').addEventListener('click', claim);
document.getElementById('ctrlTransfer').addEventListener('click', ctrlTransfer);
document.getElementById('sendReceive').addEventListener('click',
                                                        sendReceiveLoop);

document.getElementById('auto').addEventListener('click', async () => {
    try {
	    console.log("requesting device...");
	    let dev = await navigator.usb.requestDevice({filters: []});
        await autoConnect(dev);
    }
    catch (e) {
	    console.log('no device selected');
    }

    // seems to start failing around 150
    setTimeout(sendReceiveLoop, 250);
});
